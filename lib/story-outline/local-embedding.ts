import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import {
  LocalEmbeddingModelOption,
  PersistedAppSettings,
} from "@/lib/persistence/types";
import { safeRecordAiUsageEvent } from "@/lib/model-usage/service";
import {
  getDefaultLocalEmbeddingModelDirectory,
  resolveBundledPythonExecutable,
  resolveBundledPythonScriptPath,
} from "@/lib/runtime/resource-paths";

const activeLocalEmbeddingProcesses = new Set<ChildProcessWithoutNullStreams>();

let hasInstalledLocalEmbeddingShutdownHandlers = false;

const terminateTrackedLocalEmbeddingProcesses = (signal: NodeJS.Signals) => {
  activeLocalEmbeddingProcesses.forEach((child) => {
    if (child.killed) {
      return;
    }

    try {
      child.kill(signal);
    } catch {
      // Ignore cleanup errors during shutdown.
    }
  });
};

const ensureLocalEmbeddingShutdownHandlers = () => {
  if (hasInstalledLocalEmbeddingShutdownHandlers) {
    return;
  }

  hasInstalledLocalEmbeddingShutdownHandlers = true;

  process.once("beforeExit", () => {
    terminateTrackedLocalEmbeddingProcesses("SIGTERM");
  });
  process.once("exit", () => {
    terminateTrackedLocalEmbeddingProcesses("SIGKILL");
  });
  process.once("SIGINT", () => {
    terminateTrackedLocalEmbeddingProcesses("SIGTERM");
  });
  process.once("SIGTERM", () => {
    terminateTrackedLocalEmbeddingProcesses("SIGTERM");
  });
};

const isValidModelDirectory = (absolutePath: string) => {
  if (!existsSync(absolutePath) || !statSync(absolutePath).isDirectory()) {
    return false;
  }

  const requiredFiles = ["config.json", "tokenizer.json"];
  const hasRequiredFiles = requiredFiles.every((candidate) =>
    existsSync(join(absolutePath, candidate))
  );
  const hasWeights =
    existsSync(join(absolutePath, "model.safetensors")) ||
    existsSync(join(absolutePath, "pytorch_model.bin")) ||
    existsSync(join(absolutePath, "onnx", "model.onnx")) ||
    existsSync(join(absolutePath, "model.onnx"));

  return hasRequiredFiles && hasWeights;
};

const scanModelRoot = (
  rootPath: string,
  source: LocalEmbeddingModelOption["source"]
): LocalEmbeddingModelOption[] => {
  if (!rootPath.trim() || !existsSync(rootPath) || !statSync(rootPath).isDirectory()) {
    return [];
  }

  return readdirSync(rootPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const absolutePath = join(rootPath, entry.name);
      if (!isValidModelDirectory(absolutePath)) {
        return null;
      }

      return {
        id: `${source}:${entry.name}`,
        name: entry.name,
        directoryName: entry.name,
        absolutePath,
        source,
      } satisfies LocalEmbeddingModelOption;
    })
    .filter((model): model is LocalEmbeddingModelOption => model !== null)
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
};

export const listLocalEmbeddingModels = (
  customModelDirectory?: string
): LocalEmbeddingModelOption[] => {
  const effectiveModelDirectory =
    customModelDirectory?.trim() || getDefaultLocalEmbeddingModelDirectory();
  const custom = scanModelRoot(effectiveModelDirectory, "custom");

  const deduped = new Map<string, LocalEmbeddingModelOption>();

  custom.forEach((model) => {
    deduped.set(model.id, model);
  });

  return [...deduped.values()];
};

export const resolveLocalEmbeddingModel = (
  settings: Pick<
    PersistedAppSettings,
    "localEmbeddingModelDirectory" | "localEmbeddingModelName"
  >
) => {
  const normalizedSelectedId = settings.localEmbeddingModelName.trim();
  const availableModels = listLocalEmbeddingModels(settings.localEmbeddingModelDirectory);

  if (!normalizedSelectedId) {
    throw new Error("请先在设置中选择本地 Embedding 模型。");
  }

  const directMatch = availableModels.find((model) => model.id === normalizedSelectedId);
  if (directMatch) {
    return directMatch;
  }

  const legacyMatch = availableModels.find(
    (model) => model.directoryName === normalizedSelectedId || model.name === normalizedSelectedId
  );
  if (legacyMatch) {
    return legacyMatch;
  }

  throw new Error("未找到可用的本地 Embedding 模型，请检查模型目录是否包含权重文件。");
};

export const generateLocalEmbeddings = async (
  inputs: string[],
  settings: Pick<
    PersistedAppSettings,
    "localEmbeddingModelDirectory" | "localEmbeddingModelName"
  >,
  context?: {
    projectId?: string;
    materialId?: string;
    action?: "story_outline_embedding_index" | "story_outline_embedding_search";
  }
) => {
  if (inputs.length === 0) {
    return [] as number[][];
  }

  const model = resolveLocalEmbeddingModel(settings);
  const scriptPath = resolveBundledPythonScriptPath("local_embedding_service");
  const pythonExecutable = resolveBundledPythonExecutable();
  const action = context?.action ?? "story_outline_embedding_index";

  ensureLocalEmbeddingShutdownHandlers();

  if (!scriptPath) {
    throw new Error("未找到本地 Embedding Python 脚本，请重新打包应用。");
  }

  if (!pythonExecutable) {
    throw new Error("未找到内置 Python 运行环境，请重新打包应用。");
  }

  return new Promise<number[][]>((resolve, reject) => {
    const child = spawn(pythonExecutable, [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    activeLocalEmbeddingProcesses.add(child);

    let stdout = "";
    let stderr = "";
    let handled = false;

    const finishWithError = (error: Error) => {
      if (handled) {
        return;
      }

      handled = true;
      reject(error);
    };

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      activeLocalEmbeddingProcesses.delete(child);
      safeRecordAiUsageEvent({
        action,
        provider: "local_embedding",
        model: model.name,
        endpoint: scriptPath,
        status: "error",
        errorMessage: error.message,
        inputCount: inputs.length,
        projectId: context?.projectId,
        materialId: context?.materialId,
      });
      finishWithError(error);
    });

    child.on("close", (code) => {
      activeLocalEmbeddingProcesses.delete(child);

      if (handled) {
        return;
      }

      if (code !== 0) {
        safeRecordAiUsageEvent({
          action,
          provider: "local_embedding",
          model: model.name,
          endpoint: scriptPath,
          status: "error",
          errorMessage: stderr.trim() || "本地 Embedding Python 服务执行失败。",
          inputCount: inputs.length,
          projectId: context?.projectId,
          materialId: context?.materialId,
        });
        finishWithError(new Error(stderr.trim() || "本地 Embedding Python 服务执行失败。"));
        return;
      }

      try {
        const payload = JSON.parse(stdout) as {
          embeddings?: number[][];
          count?: number;
          dimension?: number;
        };
        const embeddings = payload.embeddings ?? [];

        if (
          !Array.isArray(embeddings) ||
          embeddings.length !== inputs.length ||
          embeddings.some(
            (item) => !Array.isArray(item) || item.some((value) => typeof value !== "number")
          )
        ) {
          safeRecordAiUsageEvent({
            action,
            provider: "local_embedding",
            model: model.name,
            endpoint: scriptPath,
            status: "error",
            errorMessage: "本地 Embedding 模型返回的向量格式无效。",
            inputCount: inputs.length,
            projectId: context?.projectId,
            materialId: context?.materialId,
          });
          finishWithError(new Error("本地 Embedding 模型返回的向量格式无效。"));
          return;
        }

        safeRecordAiUsageEvent({
          action,
          provider: "local_embedding",
          model: model.name,
          endpoint: scriptPath,
          status: "success",
          inputCount: inputs.length,
          projectId: context?.projectId,
          materialId: context?.materialId,
          metadata: {
            vectorCount: embeddings.length,
            dimension:
              typeof payload.dimension === "number" ? payload.dimension : embeddings[0]?.length ?? 0,
          },
        });
        handled = true;
        resolve(embeddings);
      } catch (error) {
        safeRecordAiUsageEvent({
          action,
          provider: "local_embedding",
          model: model.name,
          endpoint: scriptPath,
          status: "error",
          errorMessage:
            error instanceof Error ? error.message : "本地 Embedding 结果解析失败。",
          inputCount: inputs.length,
          projectId: context?.projectId,
          materialId: context?.materialId,
        });
        finishWithError(error instanceof Error ? error : new Error(String(error)));
      }
    });

    child.stdin.write(
      JSON.stringify({
        model_path: model.absolutePath,
        inputs,
      })
    );
    child.stdin.end();
  });
};
