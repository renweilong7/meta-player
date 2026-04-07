import { PersistedProjectClip } from "@/lib/persistence/types";

export interface ProjectClipVersionGroup {
  scriptItemId: string;
  scriptContent: string;
  versions: PersistedProjectClip[];
}

export const groupProjectClipsByScriptItem = (
  projectClips: PersistedProjectClip[],
  projectScriptItemOrder: string[]
): ProjectClipVersionGroup[] => {
  const groups = new Map<string, ProjectClipVersionGroup>();

  projectClips.forEach((clip) => {
    const existing = groups.get(clip.scriptItemId);
    if (existing) {
      existing.versions.push(clip);
      return;
    }

    groups.set(clip.scriptItemId, {
      scriptItemId: clip.scriptItemId,
      scriptContent: clip.scriptContent,
      versions: [clip],
    });
  });

  const orderMap = new Map(projectScriptItemOrder.map((id, index) => [id, index]));

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      versions: [...group.versions].sort(
        (left, right) =>
          new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
      ),
    }))
    .sort((left, right) => {
      const leftOrder = orderMap.get(left.scriptItemId) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = orderMap.get(right.scriptItemId) ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder;
    });
};

export const resolveSelectedProjectClip = (
  group: ProjectClipVersionGroup,
  selectedClipVersionByItemId: Record<string, string>
) =>
  group.versions.find(
    (clip) => clip.id === selectedClipVersionByItemId[group.scriptItemId]
  ) ?? group.versions[0] ?? null;

export const getSelectedProjectClipSequence = (
  projectClips: PersistedProjectClip[],
  projectScriptItemOrder: string[],
  selectedClipVersionByItemId: Record<string, string>
) =>
  groupProjectClipsByScriptItem(projectClips, projectScriptItemOrder)
    .map((group) => resolveSelectedProjectClip(group, selectedClipVersionByItemId))
    .filter((clip): clip is PersistedProjectClip => clip !== null);
