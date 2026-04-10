"use client";

import {
  buildClientDiagnosticHeaders,
  reportClientDiagnosticEvent,
} from "@/lib/observability/client";
import {
  PersistedAiUsageRecord,
  PersistedAiUsageSnapshot,
  LocalEmbeddingModelOption,
  MaterialImportInput,
  MaterialMarkerCreateInput,
  MaterialMarkerUpdateInput,
  MaterialPatchInput,
  PersistedAppSettings,
  PersistedLibrarySnapshot,
  PersistedMaterial,
  PersistedProject,
  PersistedProjectClipCompilation,
  ProjectCreateInput,
  ProjectUpdateInput,
} from "@/lib/persistence/types";
import { AuthorizationSnapshot } from "@/lib/license/types";
import { StoryOutlineSearchResult } from "@/lib/story-outline/search";

const getRequestUrlLabel = (input: RequestInfo | URL) =>
  typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;

const fetchWithDiagnostics = async (input: RequestInfo | URL, init?: RequestInit) => {
  const method = (init?.method ?? "GET").toUpperCase();
  const url = getRequestUrlLabel(input);

  try {
    const response = await fetch(input, {
      ...init,
      headers: buildClientDiagnosticHeaders(init?.headers),
    });

    if (!response.ok) {
      void reportClientDiagnosticEvent({
        level: response.status >= 500 ? "error" : "warn",
        event: "api.response_error",
        details: {
          method,
          url,
          status: response.status,
          serverRequestId: response.headers.get("x-meta-player-request-id") ?? undefined,
        },
      });
    }

    return response;
  } catch (error) {
    void reportClientDiagnosticEvent({
      level: "error",
      event: "api.network_error",
      details: {
        method,
        url,
      },
      error,
    });
    throw error;
  }
};

const assertOk = async (response: Response) => {
  if (response.ok) {
    return response;
  }

  const clonedResponse = response.clone();
  let message = "请求失败。";

  try {
    const data = (await response.json()) as { message?: string };
    message = data.message ?? message;
  } catch {
    try {
      const text = await clonedResponse.text();
      if (text.trim()) {
        message = text;
      }
  } catch {
      // 忽略非 JSON 错误体，使用默认错误文案。
    }
  }

  const requestId = response.headers.get("x-meta-player-request-id");
  if (requestId) {
    message = `${message}（诊断 ID: ${requestId}）`;
  }

  throw new Error(message);
};

export const fetchLibrarySnapshot = async (): Promise<PersistedLibrarySnapshot> => {
  const response = await assertOk(
    await fetchWithDiagnostics("/api/bootstrap", { cache: "no-store" })
  );
  return (await response.json()) as PersistedLibrarySnapshot;
};

export const fetchAiUsageSnapshot = async (): Promise<PersistedAiUsageSnapshot> => {
  const response = await assertOk(
    await fetchWithDiagnostics("/api/usage", { cache: "no-store" })
  );
  return (await response.json()) as PersistedAiUsageSnapshot;
};

export const postAiUsageRecord = async (
  input: Partial<PersistedAiUsageRecord>
): Promise<void> => {
  await assertOk(
    await fetchWithDiagnostics("/api/usage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    })
  );
};

export const fetchAuthorizationSnapshot =
  async (): Promise<AuthorizationSnapshot> => {
    const response = await assertOk(
      await fetchWithDiagnostics("/api/device-identity", { cache: "no-store" })
    );
    return (await response.json()) as AuthorizationSnapshot;
  };

/**
 * 手动刷新授权时，先触发一次服务端同步，再重新拉取用户页展示快照。
 *
 * 这样做的原因是：
 * - `/api/license` 更偏“执行同步动作”。
 * - `/api/device-identity` 返回的是给 UI 展示的完整授权快照。
 *
 * 两步串起来后，用户点击“刷新授权”时能立即看到后台最新结果。
 */
export const refreshAuthorizationSnapshot =
  async (): Promise<AuthorizationSnapshot> => {
    await assertOk(
      await fetchWithDiagnostics("/api/license", {
        method: "POST",
      })
    );

    return fetchAuthorizationSnapshot();
  };

export const importMaterials = async (
  inputs: MaterialImportInput[],
  projectId?: string
): Promise<PersistedMaterial[]> => {
  const formData = new FormData();

  inputs.forEach(({ file, originalPath }, index) => {
    formData.append("files", file);
    formData.append(`originalPath:${index}`, originalPath ?? "");
  });
  if (projectId) {
    formData.append("projectId", projectId);
  }

  const response = await assertOk(
    await fetchWithDiagnostics("/api/materials/import", {
      method: "POST",
      body: formData,
    })
  );
  const data = (await response.json()) as { materials: PersistedMaterial[] };

  return data.materials;
};

export const patchMaterial = async (
  id: string,
  patch: MaterialPatchInput
): Promise<PersistedMaterial> => {
  const response = await assertOk(
    await fetchWithDiagnostics(`/api/materials/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(patch),
    })
  );

  return (await response.json()) as PersistedMaterial;
};

export const generateMaterialSceneShotAnalysis = async (
  materialId: string,
  sceneId: string
): Promise<PersistedMaterial> => {
  const response = await assertOk(
    await fetchWithDiagnostics(`/api/materials/${materialId}/shot-analysis`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sceneId }),
    })
  );

  return (await response.json()) as PersistedMaterial;
};

export const postMaterialMarker = async (
  id: string,
  input: MaterialMarkerCreateInput
): Promise<PersistedMaterial> => {
  const response = await assertOk(
    await fetchWithDiagnostics(`/api/materials/${id}/markers`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    })
  );

  return (await response.json()) as PersistedMaterial;
};

export const patchMaterialMarker = async (
  materialId: string,
  markerId: string,
  input: MaterialMarkerUpdateInput
): Promise<PersistedMaterial> => {
  const response = await assertOk(
    await fetchWithDiagnostics(`/api/materials/${materialId}/markers/${markerId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    })
  );

  return (await response.json()) as PersistedMaterial;
};

export const removeMaterialMarker = async (
  materialId: string,
  markerId: string
) => {
  await assertOk(
    await fetchWithDiagnostics(`/api/materials/${materialId}/markers/${markerId}`, {
      method: "DELETE",
    })
  );
};

export const removeMaterial = async (id: string) => {
  await assertOk(
    await fetchWithDiagnostics(`/api/materials/${id}`, {
      method: "DELETE",
    })
  );
};

export const putSettings = async (
  settings: PersistedAppSettings
): Promise<PersistedAppSettings> => {
  const response = await assertOk(
    await fetchWithDiagnostics("/api/settings", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(settings),
    })
  );

  return (await response.json()) as PersistedAppSettings;
};

export const fetchLocalEmbeddingModels = async (
  directory?: string
): Promise<LocalEmbeddingModelOption[]> => {
  const query = directory !== undefined
    ? `?directory=${encodeURIComponent(directory)}`
    : "";
  const response = await assertOk(
    await fetchWithDiagnostics(`/api/settings/local-embedding-models${query}`, {
      cache: "no-store",
    })
  );
  const payload = (await response.json()) as {
    models?: LocalEmbeddingModelOption[];
  };

  return payload.models ?? [];
};

export const validateMediaToolExecutables = async (input: {
  ffmpegExecutablePath?: string;
  ffprobeExecutablePath?: string;
}): Promise<{
  ffmpeg: {
    ok: boolean;
    resolvedPath: string | null;
    version: string | null;
    message: string;
  };
  ffprobe: {
    ok: boolean;
    resolvedPath: string | null;
    version: string | null;
    message: string;
  };
}> => {
  const response = await assertOk(
    await fetchWithDiagnostics("/api/settings/media-tools", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    })
  );

  return (await response.json()) as {
    ffmpeg: {
      ok: boolean;
      resolvedPath: string | null;
      version: string | null;
      message: string;
    };
    ffprobe: {
      ok: boolean;
      resolvedPath: string | null;
      version: string | null;
      message: string;
    };
  };
};

export const postProject = async (
  input: ProjectCreateInput
): Promise<PersistedProject> => {
  const response = await assertOk(
    await fetchWithDiagnostics("/api/projects", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    })
  );

  return (await response.json()) as PersistedProject;
};

export const patchProject = async (
  id: string,
  patch: ProjectUpdateInput
): Promise<PersistedProject> => {
  const response = await assertOk(
    await fetchWithDiagnostics(`/api/projects/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(patch),
    })
  );

  return (await response.json()) as PersistedProject;
};

export const uploadProjectAudio = async (
  projectId: string,
  input: { file: File; originalPath?: string }
): Promise<PersistedProject> => {
  const formData = new FormData();
  formData.append("file", input.file);
  formData.append("originalPath", input.originalPath ?? "");

  const response = await assertOk(
    await fetchWithDiagnostics(`/api/projects/${projectId}/audio-upload`, {
      method: "POST",
      body: formData,
    })
  );

  return (await response.json()) as PersistedProject;
};

export const fetchProject = async (id: string): Promise<PersistedProject> => {
  const response = await assertOk(
    await fetchWithDiagnostics(`/api/projects/${id}`, {
      cache: "no-store",
    })
  );

  return (await response.json()) as PersistedProject;
};

export const generateProjectScriptItemTts = async (
  projectId: string,
  itemId: string
) => {
  const response = await assertOk(
    await fetchWithDiagnostics(`/api/projects/${projectId}/script-items/${itemId}/tts`, {
      method: "POST",
    })
  );

  return (await response.json()) as PersistedProject["scriptItems"][number];
};

export const combineProjectScriptItems = async (
  projectId: string,
  input: {
    itemIds: string[];
  }
): Promise<PersistedProject> => {
  const response = await assertOk(
    await fetchWithDiagnostics(`/api/projects/${projectId}/script-items/combine`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    })
  );

  return (await response.json()) as PersistedProject;
};

export const removeProject = async (id: string) => {
  await assertOk(
    await fetchWithDiagnostics(`/api/projects/${id}`, {
      method: "DELETE",
    })
  );
};

export const indexMaterialOutline = async (
  id: string
): Promise<{ indexedCount: number; mode: "embedding" | "keyword_only" | "empty" }> => {
  const response = await assertOk(
    await fetchWithDiagnostics(`/api/materials/${id}/outline-index`, {
      method: "POST",
    })
  );

  return (await response.json()) as {
    indexedCount: number;
    mode: "embedding" | "keyword_only" | "empty";
  };
};

export const searchProjectStoryOutline = async (
  projectId: string,
  query: string,
  limit = 20
): Promise<{
  mode: "embedding" | "keyword" | "llm";
  results: StoryOutlineSearchResult[];
}> => {
  const response = await assertOk(
    await fetchWithDiagnostics("/api/story-outline/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        projectId,
        query,
        limit,
      }),
    })
  );

  return (await response.json()) as {
    mode: "embedding" | "keyword" | "llm";
    results: StoryOutlineSearchResult[];
  };
};

export const createProjectScriptClip = async (
  projectId: string,
  input: {
    scriptItemId: string;
    scriptContent: string;
    assetId: string;
    startSeconds: number;
    audioStartSeconds: number;
    durationSeconds: number;
    label: string;
  }
): Promise<PersistedProject> => {
  const response = await assertOk(
    await fetchWithDiagnostics(`/api/projects/${projectId}/script-clips`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    })
  );

  return (await response.json()) as PersistedProject;
};

export const compileProjectClipSequence = async (
  projectId: string,
  input: {
    clipIds: string[];
    label: string;
  }
): Promise<PersistedProjectClipCompilation> => {
  const response = await assertOk(
    await fetchWithDiagnostics(`/api/projects/${projectId}/script-clip-compilations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    })
  );

  return (await response.json()) as PersistedProjectClipCompilation;
};
