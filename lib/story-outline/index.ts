import { resolveSearchProviderByLicense } from "@/lib/license/service";
import {
  PersistedAppSettings,
  PersistedMaterial,
  PersistedProject,
} from "@/lib/persistence/types";
import {
  getMaterialById,
  getProjectById,
  listMaterialsByProjectId,
  listProjectIdsByAssetId,
  listOutlineSegmentsByProjectId,
  replaceOutlineSegmentForAsset,
  replaceOutlineSegmentsForAsset,
} from "@/lib/persistence/repository";
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

const buildSegmentsForMaterial = (material: PersistedMaterial) =>
  buildStoryOutlineSearchSegments([
    {
      id: material.id,
      title: material.title,
      synopsis: material.synopsis,
      storyOutline: material.storyOutline,
    },
  ]);

const buildSegmentForMaterialScene = (
  material: PersistedMaterial,
  sceneId: string
) =>
  buildSegmentsForMaterial(material).find((segment) => segment.sceneId === sceneId) ?? null;

const ensureOutlineSegmentsForMaterial = (material: PersistedMaterial) => {
  const baseSegments = buildSegmentsForMaterial(material);
  replaceOutlineSegmentsForAsset(material.id, baseSegments);
  return baseSegments;
};

const ensureOutlineSegmentForMaterialScene = (
  material: PersistedMaterial,
  sceneId: string
) => {
  const segment = buildSegmentForMaterialScene(material, sceneId);

  if (!segment) {
    return null;
  }

  replaceOutlineSegmentForAsset(material.id, segment);
  return segment;
};

const indexProjectMaterialOutline = async (
  material: PersistedMaterial,
  _project: PersistedProject,
  _settings: PersistedAppSettings
) => {
  const baseSegments = ensureOutlineSegmentsForMaterial(material);

  return {
    indexedCount: baseSegments.length,
    mode: baseSegments.length > 0 ? ("keyword_only" as const) : ("empty" as const),
  };
};

const indexProjectMaterialOutlineScene = async (
  material: PersistedMaterial,
  sceneId: string,
  _project: PersistedProject,
  _settings: PersistedAppSettings
) => {
  const baseSegment = ensureOutlineSegmentForMaterialScene(material, sceneId);

  return {
    indexedCount: baseSegment ? 1 : 0,
    mode: baseSegment ? ("keyword_only" as const) : ("empty" as const),
  };
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

export const reindexMaterialOutlineForAttachedProjects = async (
  materialId: string,
  settings: PersistedAppSettings
) => {
  const material = getMaterialById(materialId);
  if (!material) {
    throw new Error("素材不存在。");
  }

  const projectIds = listProjectIdsByAssetId(materialId);
  if (projectIds.length === 0) {
    return [];
  }

  const results = await Promise.all(
    projectIds.map(async (projectId) => {
      const project = getProjectById(projectId);
      if (!project) {
        return null;
      }

      return indexProjectMaterialOutline(material, project, settings);
    })
  );

  return results.filter((result) => result !== null);
};

export const indexMaterialOutlineSceneById = async (
  materialId: string,
  sceneId: string,
  settings: PersistedAppSettings
) => {
  const material = getMaterialById(materialId);
  if (!material) {
    throw new Error("素材不存在。");
  }

  const segment = ensureOutlineSegmentForMaterialScene(material, sceneId);

  return {
    indexedCount: segment ? 1 : 0,
    mode: segment ? ("keyword_only" as const) : ("empty" as const),
  };
};

export const reindexMaterialOutlineSceneForAttachedProjects = async (
  materialId: string,
  sceneId: string,
  settings: PersistedAppSettings
) => {
  const material = getMaterialById(materialId);
  if (!material) {
    throw new Error("素材不存在。");
  }

  const projectIds = listProjectIdsByAssetId(materialId);
  if (projectIds.length === 0) {
    return [];
  }

  const results = await Promise.all(
    projectIds.map(async (projectId) => {
      const project = getProjectById(projectId);
      if (!project) {
        return null;
      }

      return indexProjectMaterialOutlineScene(material, sceneId, project, settings);
    })
  );

  return results.filter((result) => result !== null);
};

export const searchProjectOutline = async (input: {
  projectId: string;
  query: string;
  settings: PersistedAppSettings;
  limit?: number;
}): Promise<{
  mode: "keyword" | "llm";
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
  const limit = input.limit ?? 20;
  const advancedSearchEnabled = resolveSearchProviderByLicense("llm") === "llm";
  let segments = listOutlineSegmentsByProjectId(input.projectId);

  if (segments.length === 0) {
    const materials = listMaterialsByProjectId(input.projectId).filter(
      (material) => (material.storyOutline ?? []).length > 0
    );

    if (materials.length > 0) {
      await Promise.allSettled(
        materials.map((material) => indexMaterialOutline(material, input.settings))
      );
      segments = listOutlineSegmentsByProjectId(input.projectId);
    }
  }

  if (segments.length === 0) {
    return { mode: "keyword", results: [] };
  }

  if (!advancedSearchEnabled || effectiveProject.storySearchProvider !== "llm") {
    return createKeywordFallback(segments, input.query, limit);
  }

  if (!canUseLlmStorySearch(input.settings)) {
    return createKeywordFallback(segments, input.query, limit);
  }

  try {
    const results = await rankStorySegmentsWithLlm({
      query: input.query,
      candidates: segments,
      settings: input.settings,
      limit,
      projectId: input.projectId,
    });

    return { mode: "llm", results };
  } catch {
    return createKeywordFallback(segments, input.query, limit);
  }
};
