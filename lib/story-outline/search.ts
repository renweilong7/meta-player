import { StoryOutlineSceneRecord } from "@/lib/story-outline/types";

export interface OutlineSearchMaterial {
  id: string;
  title: string;
  synopsis?: string;
  storyOutline?: StoryOutlineSceneRecord[];
}

export interface StoryOutlineSearchSegment {
  id: string;
  assetId: string;
  assetTitle: string;
  sceneId: string;
  sceneTitle: string;
  sceneDescription: string;
  startSeconds: number;
  endSeconds: number;
  timestamp: string;
  shotAnalysisText?: string;
  searchableText: string;
}

export interface StoryOutlineSearchResult extends StoryOutlineSearchSegment {
  score: number;
}

const normalizeSearchText = (value: string) => value.trim().toLowerCase();

const buildShotAnalysisSearchText = (scene: StoryOutlineSceneRecord) =>
  (scene.shotAnalysis?.segments ?? [])
    .flatMap((segment) => [
      segment.summary,
      segment.action,
      segment.expressionAndGaze,
      segment.cinematography,
      segment.atmosphere,
      segment.commentaryHooks,
    ])
    .join(" ");

export const buildStoryOutlineSearchSegments = (
  materials: OutlineSearchMaterial[]
): StoryOutlineSearchSegment[] =>
  materials.flatMap((material) =>
    (material.storyOutline ?? []).map((scene) => ({
      id: `${material.id}:${scene.id}`,
      assetId: material.id,
      assetTitle: material.title,
      sceneId: scene.id,
      sceneTitle: scene.title,
      sceneDescription: scene.description,
      startSeconds: scene.startSeconds,
      endSeconds: scene.endSeconds,
      timestamp: `${scene.startTimecode} - ${scene.endTimecode}`,
      shotAnalysisText: buildShotAnalysisSearchText(scene),
      searchableText: normalizeSearchText(
        [
          material.title,
          material.synopsis ?? "",
          scene.title,
          scene.description,
          buildShotAnalysisSearchText(scene),
        ].join(" ")
      ),
    }))
  );

const scoreSegment = (
  segment: StoryOutlineSearchSegment,
  query: string,
  keywords: string[]
) => {
  let score = 0;

  if (normalizeSearchText(segment.sceneTitle).includes(query)) {
    score += 12;
  }

  if (normalizeSearchText(segment.sceneDescription).includes(query)) {
    score += 8;
  }

  if (normalizeSearchText(segment.assetTitle).includes(query)) {
    score += 4;
  }

  for (const keyword of keywords) {
    if (normalizeSearchText(segment.sceneTitle).includes(keyword)) {
      score += 4;
    }
    if (normalizeSearchText(segment.sceneDescription).includes(keyword)) {
      score += 2;
    }
    if (segment.searchableText.includes(keyword)) {
      score += 1;
    }
  }

  return score;
};

export const searchStoryOutlineSegments = (
  segments: StoryOutlineSearchSegment[],
  rawQuery: string,
  limit = 20
): StoryOutlineSearchResult[] => {
  const query = normalizeSearchText(rawQuery);
  if (!query) {
    return [];
  }

  const keywords = query.split(/\s+/).filter(Boolean);

  return segments
    .map((segment) => ({
      ...segment,
      score: scoreSegment(segment, query, keywords),
    }))
    .filter((segment) => segment.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.startSeconds - right.startSeconds;
    })
    .slice(0, limit);
};
