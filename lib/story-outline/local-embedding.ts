import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import {
  LocalEmbeddingModelOption,
  PersistedAppSettings,
} from "@/lib/persistence/types";

const getElectronResourcesPath = () =>
  (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? null;

const getBundledModelRoots = () => {
  const roots = [
    join(process.cwd(), "models", "embeddings"),
    join(process.cwd(), "..", "models", "embeddings"),
  ];
  const electronResourcesPath = getElectronResourcesPath();

  if (electronResourcesPath) {
    roots.push(join(electronResourcesPath, "models", "embeddings"));
    roots.push(join(electronResourcesPath, "app", "models", "embeddings"));
  }

  return roots.filter((root, index, list) => list.indexOf(root) === index);
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
  const bundled = getBundledModelRoots().flatMap((rootPath) =>
    scanModelRoot(rootPath, "bundled")
  );
  const custom = customModelDirectory?.trim()
    ? scanModelRoot(customModelDirectory.trim(), "custom")
    : [];

  const deduped = new Map<string, LocalEmbeddingModelOption>();

  [...bundled, ...custom].forEach((model) => {
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
  >
) => {
  if (inputs.length === 0) {
    return [] as number[][];
  }

  const model = resolveLocalEmbeddingModel(settings);
  const scriptPath = join(process.cwd(), "scripts", "local_embedding_service.py");

  return new Promise<number[][]>((resolve, reject) => {
    const child = spawn("python3", [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || "本地 Embedding Python 服务执行失败。"));
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
          reject(new Error("本地 Embedding 模型返回的向量格式无效。"));
          return;
        }

        resolve(embeddings);
      } catch (error) {
        reject(error);
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
