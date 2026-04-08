import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { promisify } from "node:util";
import { join } from "node:path";
import {
  getProjectScriptItemById,
  getProjectById,
  getSettings,
  listProjectScriptItemsByProjectId,
  updateProjectScriptItemTts,
} from "@/lib/persistence/repository";
import { safeRecordAiUsageEvent } from "@/lib/model-usage/service";

const execFileAsync = promisify(execFile);
const runningProjectIds = new Set<string>();
const rerunRequestedProjectIds = new Set<string>();

const ensureDirectory = (directory: string) => {
  mkdirSync(directory, { recursive: true });
};

const synthesizeWithSystemVoice = async (input: {
  text: string;
  voice: string;
  outputPath: string;
}) => {
  const args = ["-v", input.voice, "-o", input.outputPath, input.text];
  await execFileAsync("/usr/bin/say", args);
};

const generateItemAudio = async (input: {
  projectId: string;
  item: {
    id: string;
    lineIndex: number;
    content: string;
  };
  voice: string;
  outputDirectory: string;
}) => {
  await updateProjectScriptItemTts(input.item.id, {
    ttsStatus: "loading",
    ttsError: null,
    audioPath: null,
  });

  const outputPath = join(
    input.outputDirectory,
    `${input.item.lineIndex + 1}-${input.item.id}.aiff`
  );

  try {
    await synthesizeWithSystemVoice({
      text: input.item.content,
      voice: input.voice,
      outputPath,
    });

    await updateProjectScriptItemTts(input.item.id, {
      ttsStatus: "success",
      ttsError: null,
      audioPath: outputPath,
    });
    safeRecordAiUsageEvent({
      action: "project_script_tts",
      provider: "system_tts",
      model: input.voice,
      endpoint: "/usr/bin/say",
      status: "success",
      inputCount: 1,
      projectId: input.projectId,
      metadata: {
        itemId: input.item.id,
        textLength: input.item.content.length,
      },
    });
  } catch (error) {
    await updateProjectScriptItemTts(input.item.id, {
      ttsStatus: "error",
      ttsError: error instanceof Error ? error.message : "TTS 生成失败。",
      audioPath: null,
    });
    safeRecordAiUsageEvent({
      action: "project_script_tts",
      provider: "system_tts",
      model: input.voice,
      endpoint: "/usr/bin/say",
      status: "error",
      errorMessage: error instanceof Error ? error.message : "TTS 生成失败。",
      inputCount: 1,
      projectId: input.projectId,
      metadata: {
        itemId: input.item.id,
        textLength: input.item.content.length,
      },
    });
  }
};

export const startProjectScriptTtsGeneration = (projectId: string) => {
  if (runningProjectIds.has(projectId)) {
    rerunRequestedProjectIds.add(projectId);
    return;
  }

  runningProjectIds.add(projectId);

  void (async () => {
    try {
      const project = getProjectById(projectId);
      if (!project?.scriptSrtContent?.trim()) {
        return;
      }

      const settings = getSettings();
      const outputDirectory = join(
        settings.materialSavePath,
        "project-script-tts",
        projectId
      );

      ensureDirectory(outputDirectory);

      const scriptItems = listProjectScriptItemsByProjectId(projectId);

      for (const item of scriptItems) {
        await generateItemAudio({
          projectId,
          item,
          voice: settings.localTtsModelName.trim() || "Tingting",
          outputDirectory,
        });
      }
    } finally {
      runningProjectIds.delete(projectId);

      if (rerunRequestedProjectIds.has(projectId)) {
        rerunRequestedProjectIds.delete(projectId);
        startProjectScriptTtsGeneration(projectId);
      }
    }
  })();
};

export const startProjectScriptTtsGenerationForItem = async (
  projectId: string,
  itemId: string
) => {
  const project = getProjectById(projectId);
  const item = getProjectScriptItemById(itemId);

  if (!project || !item || item.project_id !== projectId) {
    return null;
  }

  const settings = getSettings();
  const outputDirectory = join(
    settings.materialSavePath,
    "project-script-tts",
    projectId
  );

  ensureDirectory(outputDirectory);

  await generateItemAudio({
    projectId,
    item: {
      id: item.id,
      lineIndex: item.line_index,
      content: item.content,
    },
    voice: settings.localTtsModelName.trim() || "Tingting",
    outputDirectory,
  });

  return getProjectScriptItemById(itemId);
};
