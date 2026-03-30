import { resolveSearchProviderByLicense } from "@/lib/license/service";
import { PersistedAppSettings, PersistedMaterial } from "@/lib/persistence/types";
import {
  getMaterialById,
  listMaterialsByProjectId,
  listOutlineSegmentsByProjectId,
  replaceOutlineSegmentsForAsset,
} from "@/lib/persistence/repository";
import { generateEmbeddings } from "@/lib/story-outline/embedding";
import { canUseLlmStorySearch, rankStorySegmentsWithLlm } from "@/lib/story-outline/llm-search";
import {
  buildStoryOutlineSearchSegments,
  cosineSimilarity,
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

const hasEmbeddingConfig = (settings: PersistedAppSettings) =>
  Boolean(
    settings.aiApiBaseUrl.trim() &&
      settings.aiApiKey.trim() &&
      settings.aiEmbeddingModelName.trim()
  );

const buildSegmentsForMaterial = (material: PersistedMaterial) =>
  buildStoryOutlineSearchSegments([
    {
      id: material.id,
      title: material.title,
      synopsis: material.synopsis,
      storyOutline: material.storyOutline,
    },
  ]);

export const indexMaterialOutline = async (
  material: PersistedMaterial,
  settings: PersistedAppSettings
) => {
  const effectiveProvider = resolveSearchProviderByLicense(
    settings.storySearchProvider
  );
  const baseSegments = buildSegmentsForMaterial(material);

  if (baseSegments.length === 0) {
    replaceOutlineSegmentsForAsset(material.id, []);
    return { indexedCount: 0, mode: "empty" as const };
  }

  if (effectiveProvider !== "remote_embedding" || !hasEmbeddingConfig(settings)) {
    replaceOutlineSegmentsForAsset(
      material.id,
      baseSegments.map((segment) => ({
        ...segment,
        embeddingStatus: "idle" as const,
        embeddingModel: null,
        embeddingError: null,
      }))
    );

    return { indexedCount: baseSegments.length, mode: "keyword_only" as const };
  }

  try {
    const embeddings = await generateEmbeddings(
      baseSegments.map((segment) => segment.searchableText),
      {
        baseUrl: settings.aiApiBaseUrl,
        apiKey: settings.aiApiKey,
        model: settings.aiEmbeddingModelName,
      }
    );

    replaceOutlineSegmentsForAsset(
      material.id,
      baseSegments.map((segment, index) => ({
        ...segment,
        embedding: embeddings[index],
        embeddingModel: settings.aiEmbeddingModelName,
        embeddingStatus: "success" as const,
        embeddingError: null,
      }))
    );

    return { indexedCount: baseSegments.length, mode: "embedding" as const };
  } catch (error) {
    replaceOutlineSegmentsForAsset(
      material.id,
      baseSegments.map((segment) => ({
        ...segment,
        embeddingStatus: "error" as const,
        embeddingModel: settings.aiEmbeddingModelName,
        embeddingError:
          error instanceof Error ? error.message : "剧情向量索引生成失败",
      }))
    );

    throw error;
  }
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
  const effectiveSettings: PersistedAppSettings = {
    ...input.settings,
    storySearchProvider: resolveSearchProviderByLicense(
      input.settings.storySearchProvider
    ),
  };
  const limit = input.limit ?? 20;
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
    return createKeywordFallback(segments, input.query, limit);
  }

  const embeddedSegments = segments.filter(
    (segment): segment is typeof segment & { embedding: number[] } =>
      Array.isArray(segment.embedding) && segment.embedding.length > 0
  );

  if (embeddedSegments.length > 0 && hasEmbeddingConfig(effectiveSettings)) {
    try {
      const [queryEmbedding] = await generateEmbeddings([input.query], {
        baseUrl: effectiveSettings.aiApiBaseUrl,
        apiKey: effectiveSettings.aiApiKey,
        model: effectiveSettings.aiEmbeddingModelName,
      });

      const ranked = embeddedSegments
        .map((segment) => ({
          ...segment,
          score: cosineSimilarity(queryEmbedding, segment.embedding),
        }))
        .filter((segment) => segment.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, limit);

      if (ranked.length > 0) {
        return { mode: "embedding", results: ranked };
      }
    } catch {
      // Embedding 查询失败时退回关键词检索，避免中断搜索能力。
    }
  }

  return createKeywordFallback(segments, input.query, limit);
};
