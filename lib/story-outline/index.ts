import { resolveSearchProviderByLicense } from "@/lib/license/service";
import {
  PersistedAppSettings,
  PersistedMaterial,
  PersistedProject,
} from "@/lib/persistence/types";
import {
  countProjectOutlineVectors,
  getMaterialById,
  getProjectById,
  lockProjectEmbeddingConfig,
  listMaterialsByProjectId,
  listOutlineSegmentsByProjectId,
  replaceOutlineSegmentsForAsset,
  replaceProjectOutlineVectorsForAsset,
  searchOutlineSegmentsByVector,
} from "@/lib/persistence/repository";
import { generateEmbeddings } from "@/lib/story-outline/embedding";
import {
  generateLocalEmbeddings,
  resolveLocalEmbeddingModel,
} from "@/lib/story-outline/local-embedding";
import { canUseLlmStorySearch, rankStorySegmentsWithLlm } from "@/lib/story-outline/llm-search";
import {
  buildStoryOutlineSearchSegments,
  searchStoryOutlineSegments,
  StoryOutlineSearchResult,
} from "@/lib/story-outline/search";

const createKeywordFallback = (
  segments: ReturnType<typeof listOutlineSegmentsByProjectId>,
  query: string,
  limit: number
) => ({
  mode: "keyword" as const,
  results: searchStoryOutlineSegments(segments, query, limit),
});

const hasRemoteEmbeddingConfig = (settings: PersistedAppSettings) =>
  Boolean(
    settings.aiApiBaseUrl.trim() &&
      settings.aiApiKey.trim()
  );

const canUseLocalEmbeddingModel = (
  settings: PersistedAppSettings,
  modelId: string
) => {
  try {
    resolveLocalEmbeddingModel({
      localEmbeddingModelDirectory: settings.localEmbeddingModelDirectory,
      localEmbeddingModelName: modelId,
    });
    return true;
  } catch {
    return false;
  }
};

const buildSegmentsForMaterial = (material: PersistedMaterial) =>
  buildStoryOutlineSearchSegments([
    {
      id: material.id,
      title: material.title,
      synopsis: material.synopsis,
      storyOutline: material.storyOutline,
    },
  ]);

const buildProjectScopedSettings = (
  settings: PersistedAppSettings,
  project: PersistedProject
) => ({
  ...settings,
  storySearchProvider: project.storySearchProvider,
  aiEmbeddingModelName:
    project.embeddingModelSource === "remote"
      ? project.embeddingModelId
      : settings.aiEmbeddingModelName,
  localEmbeddingModelName:
    project.embeddingModelSource === "local"
      ? project.embeddingModelId
      : settings.localEmbeddingModelName,
});

const ensureOutlineSegmentsForMaterial = (material: PersistedMaterial) => {
  const baseSegments = buildSegmentsForMaterial(material);

  replaceOutlineSegmentsForAsset(
    material.id,
    baseSegments.map((segment) => ({
      ...segment,
      embeddingStatus: "idle" as const,
      embeddingModel: null,
      embeddingError: null,
    }))
  );

  return baseSegments;
};

const indexProjectMaterialOutline = async (
  material: PersistedMaterial,
  project: PersistedProject,
  settings: PersistedAppSettings
) => {
  const baseSegments = ensureOutlineSegmentsForMaterial(material);

  if (baseSegments.length === 0) {
    return { indexedCount: 0, mode: "empty" as const };
  }

  if (project.storySearchProvider === "llm") {
    return { indexedCount: baseSegments.length, mode: "keyword_only" as const };
  }

  if (project.storySearchProvider === "local_embedding") {
    if (!canUseLocalEmbeddingModel(settings, project.embeddingModelId)) {
      throw new Error("当前项目选择的本地 Embedding 模型不可用，请检查模型目录是否包含权重文件。");
    }

    const scopedSettings = buildProjectScopedSettings(settings, project);
    const localModel = resolveLocalEmbeddingModel(scopedSettings);
    const embeddings = await generateLocalEmbeddings(
      baseSegments.map((segment) => segment.searchableText),
      scopedSettings
    );

    replaceProjectOutlineVectorsForAsset({
      projectId: project.id,
      assetId: material.id,
      embeddingModel: localModel.id,
      segments: baseSegments.map((segment, index) => ({
        segmentId: segment.id,
        startSeconds: segment.startSeconds,
        embedding: embeddings[index],
      })),
    });
    lockProjectEmbeddingConfig(project.id);

    return { indexedCount: baseSegments.length, mode: "embedding" as const };
  }

  if (!hasRemoteEmbeddingConfig(settings)) {
    return { indexedCount: baseSegments.length, mode: "keyword_only" as const };
  }

  const embeddings = await generateEmbeddings(
    baseSegments.map((segment) => segment.searchableText),
    {
      baseUrl: settings.aiApiBaseUrl,
      apiKey: settings.aiApiKey,
      model: project.embeddingModelId,
    }
  );

  replaceProjectOutlineVectorsForAsset({
    projectId: project.id,
    assetId: material.id,
    embeddingModel: project.embeddingModelId,
    segments: baseSegments.map((segment, index) => ({
      segmentId: segment.id,
      startSeconds: segment.startSeconds,
      embedding: embeddings[index],
    })),
  });
  lockProjectEmbeddingConfig(project.id);

  return { indexedCount: baseSegments.length, mode: "embedding" as const };
};

export const indexMaterialOutline = async (
  material: PersistedMaterial,
  _settings: PersistedAppSettings
) => {
  const baseSegments = ensureOutlineSegmentsForMaterial(material);
  return {
    indexedCount: baseSegments.length,
    mode: baseSegments.length > 0 ? ("keyword_only" as const) : ("empty" as const),
  };
};

export const indexMaterialOutlineById = async (
  materialId: string,
  settings: PersistedAppSettings
) => {
  const material = getMaterialById(materialId);
  if (!material) {
    throw new Error("素材不存在。");
  }

  return indexMaterialOutline(material, settings);
};

export const searchProjectOutline = async (input: {
  projectId: string;
  query: string;
  settings: PersistedAppSettings;
  limit?: number;
}): Promise<{
  mode: "embedding" | "keyword" | "llm";
  results: StoryOutlineSearchResult[];
}> => {
  const project = getProjectById(input.projectId);
  if (!project) {
    throw new Error("项目不存在。");
  }
  const effectiveProject: PersistedProject = {
    ...project,
    storySearchProvider: resolveSearchProviderByLicense(project.storySearchProvider),
  };

  const effectiveSettings: PersistedAppSettings = buildProjectScopedSettings(
    input.settings,
    effectiveProject
  );
  const limit = input.limit ?? 20;
  const advancedSearchEnabled =
    resolveSearchProviderByLicense("llm") === "llm";
  let segments = listOutlineSegmentsByProjectId(input.projectId);
  if (segments.length === 0) {
    const materials = listMaterialsByProjectId(input.projectId).filter(
      (material) => (material.storyOutline ?? []).length > 0
    );

    if (materials.length > 0) {
      await Promise.allSettled(
        materials.map((material) => indexMaterialOutline(material, effectiveSettings))
      );
      segments = listOutlineSegmentsByProjectId(input.projectId);
    }
  }

  if (segments.length === 0) {
    return { mode: "keyword", results: [] };
  }

  if (!advancedSearchEnabled) {
    return createKeywordFallback(segments, input.query, limit);
  }

  if (effectiveSettings.storySearchProvider !== "llm") {
    const vectorCount = countProjectOutlineVectors(
      input.projectId,
      effectiveProject.embeddingModelId
    );
    const materials = listMaterialsByProjectId(input.projectId).filter(
      (material) => (material.storyOutline ?? []).length > 0
    );

    if (vectorCount < segments.length && materials.length > 0) {
      const indexingResults = await Promise.allSettled(
        materials.map((material) =>
          indexProjectMaterialOutline(material, effectiveProject, input.settings)
        )
      );
      const firstRejected = indexingResults.find(
        (result): result is PromiseRejectedResult => result.status === "rejected"
      );
      if (firstRejected) {
        throw firstRejected.reason;
      }
      segments = listOutlineSegmentsByProjectId(input.projectId);
    }
  }

  if (effectiveSettings.storySearchProvider === "llm") {
    if (!canUseLlmStorySearch(effectiveSettings)) {
      return createKeywordFallback(segments, input.query, limit);
    }

    if (segments.length === 0) {
      return { mode: "llm", results: [] };
    }

    try {
      const results = await rankStorySegmentsWithLlm({
        query: input.query,
        candidates: segments,
        settings: effectiveSettings,
        limit,
      });

      return { mode: "llm", results };
    } catch {
      // 大模型搜索失败时退回关键词检索，避免中断搜索能力。
    }

    return createKeywordFallback(segments, input.query, limit);
  }

  if (effectiveSettings.storySearchProvider === "local_embedding") {
    if (!canUseLocalEmbeddingModel(input.settings, effectiveProject.embeddingModelId)) {
      throw new Error("当前项目选择的本地 Embedding 模型不可用，请检查模型目录是否包含权重文件。");
    }

    try {
      const localModel = resolveLocalEmbeddingModel(effectiveSettings);
      const [queryEmbedding] = await generateLocalEmbeddings([input.query], effectiveSettings);
      const vectorMatches = searchOutlineSegmentsByVector({
        projectId: input.projectId,
        embeddingModel: localModel.id,
        queryEmbedding,
        limit,
      });

      if (vectorMatches.length > 0) {
        return { mode: "embedding", results: vectorMatches };
      }
    } catch (error) {
      throw error;
    }

    return createKeywordFallback(segments, input.query, limit);
  }

  if (hasRemoteEmbeddingConfig(input.settings)) {
    try {
      const [queryEmbedding] = await generateEmbeddings([input.query], {
        baseUrl: input.settings.aiApiBaseUrl,
        apiKey: input.settings.aiApiKey,
        model: effectiveProject.embeddingModelId,
      });

      const vectorMatches = searchOutlineSegmentsByVector({
        projectId: input.projectId,
        embeddingModel: effectiveProject.embeddingModelId,
        queryEmbedding,
        limit,
      });

      if (vectorMatches.length > 0) {
        return { mode: "embedding", results: vectorMatches };
      }
    } catch {
      // Embedding 查询失败时退回关键词检索，避免中断搜索能力。
    }
  }

  return createKeywordFallback(segments, input.query, limit);
};
