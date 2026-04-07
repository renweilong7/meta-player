import { PersistedProjectScriptMatchResult } from "@/lib/persistence/types";

export type ProjectScriptBlockSource = "srt" | "line";

export interface ProjectScriptBlock {
  id: string;
  index: number;
  source: ProjectScriptBlockSource;
  startSeconds: number;
  endSeconds: number | null;
  durationSeconds: number;
  timeline: string;
  content: string;
}

export interface CombinedProjectScriptState {
  scriptSrtContent: string;
  scriptMatchResults: Record<string, PersistedProjectScriptMatchResult>;
  itemIdMap: Record<string, string | null>;
  combinedItemId: string;
  combinedContent: string;
}

const areConsecutiveIndexes = (indexes: number[]) =>
  indexes.every((index, offset) => offset === 0 || index === indexes[offset - 1] + 1);

const parseSrtTimeToSeconds = (value: string) => {
  const normalized = value.replace(",", ".");
  const [hours, minutes, seconds] = normalized.split(":");
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
};

const formatSecondsToSrtTimestamp = (value: number) => {
  const safeValue = Math.max(value, 0);
  const hours = Math.floor(safeValue / 3600);
  const minutes = Math.floor((safeValue % 3600) / 60);
  const seconds = Math.floor(safeValue % 60);
  const milliseconds = Math.floor((safeValue - Math.floor(safeValue)) * 1000);

  return [
    hours.toString().padStart(2, "0"),
    minutes.toString().padStart(2, "0"),
    seconds.toString().padStart(2, "0"),
  ].join(":") + `,${milliseconds.toString().padStart(3, "0")}`;
};

const getProjectScriptBlockId = (source: ProjectScriptBlockSource, index: number) =>
  `${source}:${index}`;

export const parseProjectScriptBlocks = (raw: string): ProjectScriptBlock[] => {
  const normalized = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  const srtBlocks = normalized
    .split(/\n\s*\n/)
    .map((block, index) => {
      const lines = block
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      if (lines.length < 2) {
        return null;
      }

      const timelineIndex = lines[0].includes("-->") ? 0 : 1;
      const timeline = lines[timelineIndex];
      if (!timeline?.includes("-->")) {
        return null;
      }

      const [startRaw, endRaw] = timeline.split("-->").map((part) => part.trim());
      const content = lines.slice(timelineIndex + 1).join(" ").trim();
      if (!content) {
        return null;
      }

      const startSeconds = parseSrtTimeToSeconds(startRaw);
      const endSeconds = endRaw ? parseSrtTimeToSeconds(endRaw) : null;

      return {
        id: getProjectScriptBlockId("srt", index),
        index,
        source: "srt" as const,
        startSeconds,
        endSeconds,
        durationSeconds:
          endSeconds !== null ? Math.max(endSeconds - startSeconds, 0) : 0,
        timeline: `${startRaw} - ${endRaw}`,
        content,
      };
    })
    .filter((item): item is ProjectScriptBlock => item !== null);

  if (srtBlocks.length > 0) {
    return srtBlocks;
  }

  return normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => ({
      id: getProjectScriptBlockId("line", index),
      index,
      source: "line" as const,
      startSeconds: 0,
      endSeconds: null,
      durationSeconds: 0,
      timeline: `第 ${index + 1} 行`,
      content: line,
    }));
};

export const serializeProjectScriptBlocks = (blocks: ProjectScriptBlock[]) => {
  if (blocks.length === 0) {
    return "";
  }

  if (blocks[0]?.source === "line") {
    return blocks.map((block) => block.content).join("\n");
  }

  return blocks
    .map((block, index) => {
      const endSeconds = block.endSeconds ?? block.startSeconds;
      return [
        `${index + 1}`,
        `${formatSecondsToSrtTimestamp(block.startSeconds)} --> ${formatSecondsToSrtTimestamp(endSeconds)}`,
        block.content,
      ].join("\n");
    })
    .join("\n\n");
};

export const combineProjectScriptState = (input: {
  rawContent: string;
  scriptMatchResults?: Record<string, PersistedProjectScriptMatchResult>;
  itemIds: string[];
}): CombinedProjectScriptState | null => {
  const blocks = parseProjectScriptBlocks(input.rawContent);
  const selectedBlocks = input.itemIds
    .map((itemId) => blocks.find((block) => block.id === itemId) ?? null)
    .filter((block): block is ProjectScriptBlock => block !== null)
    .sort((left, right) => left.index - right.index);
  const selectedIndexes = selectedBlocks.map((block) => block.index);

  if (selectedBlocks.length < 2 || selectedBlocks.length !== input.itemIds.length) {
    return null;
  }

  if (!areConsecutiveIndexes(selectedIndexes)) {
    return null;
  }

  const firstIndex = selectedIndexes[0];
  const firstBlock = selectedBlocks[0];
  const lastBlock = selectedBlocks[selectedBlocks.length - 1];
  const selectedIdSet = new Set(selectedBlocks.map((block) => block.id));
  const combinedContent = selectedBlocks
    .map((block) => block.content)
    .map((value) => value.trim())
    .filter(Boolean)
    .join(" ");

  const combinedBlock: ProjectScriptBlock = {
    ...firstBlock,
    content: combinedContent,
    endSeconds: lastBlock.endSeconds ?? firstBlock.endSeconds,
    durationSeconds:
      lastBlock.endSeconds !== null
        ? Math.max(lastBlock.endSeconds - firstBlock.startSeconds, 0)
        : firstBlock.durationSeconds,
  };

  const nextBlocks = blocks
    .filter((block) => !selectedIdSet.has(block.id) || block.id === firstBlock.id)
    .map((block, index) => ({
      ...block,
      index,
      id: getProjectScriptBlockId(block.source, index),
    }));

  nextBlocks[firstIndex] = {
    ...combinedBlock,
    index: firstIndex,
    id: getProjectScriptBlockId(combinedBlock.source, firstIndex),
  };

  const nextMatchResults: Record<string, PersistedProjectScriptMatchResult> = {};
  const currentMatches = input.scriptMatchResults ?? {};
  const itemIdMap: Record<string, string | null> = {};

  blocks.forEach((block, index) => {
    if (selectedIdSet.has(block.id) && block.id !== firstBlock.id) {
      itemIdMap[block.id] = null;
      return;
    }

    const removedBeforeCount = selectedIndexes.filter(
      (selectedIndex) => selectedIndex < index && selectedIndex !== firstIndex
    ).length;
    const nextId = getProjectScriptBlockId(block.source, index - removedBeforeCount);
    itemIdMap[block.id] = nextId;

    if (block.id === firstBlock.id) {
      const firstMatch = currentMatches[firstBlock.id];
      if (firstMatch) {
        nextMatchResults[nextId] = firstMatch;
      }
      return;
    }

    const currentMatch = currentMatches[block.id];
    if (currentMatch) {
      nextMatchResults[nextId] = currentMatch;
    }
  });

  return {
    scriptSrtContent: serializeProjectScriptBlocks(nextBlocks),
    scriptMatchResults: nextMatchResults,
    itemIdMap,
    combinedItemId: nextBlocks[firstIndex].id,
    combinedContent,
  };
};
