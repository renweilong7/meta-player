"use client";

import {
  MaterialImportInput,
  MaterialMarkerCreateInput,
  MaterialMarkerUpdateInput,
  MaterialPatchInput,
  PersistedAppSettings,
  PersistedLibrarySnapshot,
  PersistedMaterial,
  PersistedProject,
  ProjectCreateInput,
  ProjectUpdateInput,
} from "@/lib/persistence/types";
import { StoryOutlineSearchResult } from "@/lib/story-outline/search";

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

  throw new Error(message);
};

export const fetchLibrarySnapshot = async (): Promise<PersistedLibrarySnapshot> => {
  const response = await assertOk(await fetch("/api/bootstrap", { cache: "no-store" }));
  return (await response.json()) as PersistedLibrarySnapshot;
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
    await fetch("/api/materials/import", {
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
    await fetch(`/api/materials/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(patch),
    })
  );

  return (await response.json()) as PersistedMaterial;
};

export const postMaterialMarker = async (
  id: string,
  input: MaterialMarkerCreateInput
): Promise<PersistedMaterial> => {
  const response = await assertOk(
    await fetch(`/api/materials/${id}/markers`, {
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
    await fetch(`/api/materials/${materialId}/markers/${markerId}`, {
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
    await fetch(`/api/materials/${materialId}/markers/${markerId}`, {
      method: "DELETE",
    })
  );
};

export const removeMaterial = async (id: string) => {
  await assertOk(
    await fetch(`/api/materials/${id}`, {
      method: "DELETE",
    })
  );
};

export const putSettings = async (
  settings: PersistedAppSettings
): Promise<PersistedAppSettings> => {
  const response = await assertOk(
    await fetch("/api/settings", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(settings),
    })
  );

  return (await response.json()) as PersistedAppSettings;
};

export const postProject = async (
  input: ProjectCreateInput
): Promise<PersistedProject> => {
  const response = await assertOk(
    await fetch("/api/projects", {
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
    await fetch(`/api/projects/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(patch),
    })
  );

  return (await response.json()) as PersistedProject;
};

export const removeProject = async (id: string) => {
  await assertOk(
    await fetch(`/api/projects/${id}`, {
      method: "DELETE",
    })
  );
};

export const indexMaterialOutline = async (
  id: string
): Promise<{ indexedCount: number; mode: "embedding" | "keyword_only" | "empty" }> => {
  const response = await assertOk(
    await fetch(`/api/materials/${id}/outline-index`, {
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
    await fetch("/api/story-outline/search", {
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
