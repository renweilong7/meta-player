"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  Edit2,
  LoaderCircle,
  Sparkles,
  Clapperboard,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StoryScene } from "@/lib/story-outline/types";
import { StoryOutlineSearchResult } from "@/lib/story-outline/search";

interface StoryOutlineProps {
  scenes: StoryScene[];
  currentSceneId: string | null;
  mediaOptions?: Array<{
    id: string;
    title: string;
    outlineSceneCount: number;
  }>;
  selectedMediaId?: string | null;
  isExtracting?: boolean;
  extractionError?: string | null;
  onMediaSelect?: (mediaId: string) => void;
  onSceneSelect: (id: string) => void;
  searchQuery?: string;
  searchState?: "idle" | "loading" | "embedding" | "keyword" | "llm";
  searchResults?: StoryOutlineSearchResult[];
  currentSearchResultId?: string | null;
  onSearchResultSelect?: (result: StoryOutlineSearchResult) => void;
  onSearchQueryChange?: (value: string) => void;
  onSearchSubmit?: () => void | Promise<void>;
  onClearSearch?: () => void;
  onGenerateShotAnalysis?: (sceneId: string) => void | Promise<void>;
  onSceneSubtitleSelect?: (sceneId: string, time: number) => void;
}

export function StoryOutline({
  scenes,
  currentSceneId,
  mediaOptions = [],
  selectedMediaId = null,
  isExtracting = false,
  extractionError = null,
  onMediaSelect,
  onSceneSelect,
  searchQuery = "",
  searchState = "idle",
  searchResults = [],
  currentSearchResultId = null,
  onSearchResultSelect,
  onSearchQueryChange,
  onSearchSubmit,
  onClearSearch,
  onGenerateShotAnalysis,
  onSceneSubtitleSelect,
}: StoryOutlineProps) {
  const [expandedSceneId, setExpandedSceneId] = useState<string | null>(null);
  const [expandedSubtitleSceneId, setExpandedSubtitleSceneId] = useState<string | null>(null);
  const sceneRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const isSearchMode = searchQuery.trim().length > 0 || searchState === "loading";
  const searchStatusLabel =
    searchState === "embedding"
      ? "语义检索"
      : searchState === "llm"
        ? "大模型搜索"
        : searchState === "loading"
          ? "搜索中"
          : "关键词检索";

  const handleToggleExpanded = (sceneId: string) => {
    setExpandedSceneId((current) => (current === sceneId ? null : sceneId));
  };

  const getShotAnalysisButtonLabel = (scene: StoryScene) => {
    if (scene.shotAnalysis?.status === "loading") {
      return "解析中...";
    }

    if (scene.shotAnalysis?.status === "success") {
      return "查看镜头解读";
    }

    if (scene.shotAnalysis?.status === "error") {
      return "重新生成";
    }

    return "生成镜头解读";
  };

  const handleShotAnalysisAction = (scene: StoryScene) => {
    if (scene.shotAnalysis?.status === "success") {
      setExpandedSceneId((current) => (current === scene.id ? null : scene.id));
      return;
    }

    void onGenerateShotAnalysis?.(scene.id);
    setExpandedSceneId(scene.id);
  };

  const handleSubtitleToggle = (sceneId: string) => {
    setExpandedSubtitleSceneId((current) => (current === sceneId ? null : sceneId));
    setExpandedSceneId(sceneId);
  };

  useEffect(() => {
    if (!currentSceneId) {
      return;
    }

    sceneRefs.current[currentSceneId]?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [currentSceneId]);

  return (
    <div className="flex h-full min-h-0 min-w-0 w-full flex-col bg-card">
      {/* Header */}
      <div className="border-b border-border p-4">
        <h2 className="text-sm font-semibold text-card-foreground">剧情大纲</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {isSearchMode ? `共 ${searchResults.length} 条搜索结果` : `共 ${scenes.length} 个场景`}
        </p>
        <div className="mt-3 flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(event) => onSearchQueryChange?.(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void onSearchSubmit?.();
                }
              }}
              placeholder="搜索剧情大纲"
              className="pl-9"
            />
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => void onSearchSubmit?.()}
            disabled={!searchQuery.trim() || searchState === "loading"}
          >
            搜索
          </Button>
          {searchQuery.trim() ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onClearSearch?.()}
              disabled={searchState === "loading"}
            >
              <X className="h-4 w-4" />
              清空
            </Button>
          ) : null}
        </div>
        {!isSearchMode && mediaOptions.length > 0 ? (
          <div className="mt-3">
            <Select
              value={selectedMediaId ?? undefined}
              onValueChange={(value) => onMediaSelect?.(value)}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue placeholder="切换素材查看剧情大纲" />
              </SelectTrigger>
              <SelectContent>
                {mediaOptions.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.title} · {item.outlineSceneCount} 场
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      {/* Scene List */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-2">
          {isSearchMode ? (
            <>
              <div className="mb-3 rounded-lg border border-dashed border-border bg-muted/20 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-foreground">剧情搜索：{searchQuery}</p>
                  <span className="text-xs text-muted-foreground">{searchStatusLabel}</span>
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  点击结果后会自动切到对应素材，并定位到该剧情片段。
                </p>
              </div>

              {searchState === "loading" ? (
                <div className="flex min-h-52 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-6 text-center">
                  <LoaderCircle className="h-6 w-6 animate-spin text-primary" />
                  <p className="mt-3 text-sm font-medium text-foreground">正在搜索剧情片段</p>
                </div>
              ) : searchResults.length === 0 ? (
                <div className="flex min-h-52 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-6 text-center">
                  <p className="text-sm font-medium text-foreground">没有匹配的剧情片段</p>
                  <p className="mt-2 max-w-xs text-xs leading-5 text-muted-foreground">
                    试试更短的关键词，或者先为素材提取剧情大纲。
                  </p>
                </div>
              ) : (
                searchResults.map((result) => {
                  return (
                    <button
                      key={result.id}
                      type="button"
                      onClick={() => onSearchResultSelect?.(result)}
                      className={cn(
                        "mb-2 w-full rounded-lg border p-3 text-left transition-colors",
                        currentSearchResultId === result.id
                          ? "border-primary/40 bg-secondary"
                          : "border-border bg-background hover:bg-secondary/50"
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-card-foreground">
                            {result.sceneTitle}
                          </p>
                          <p className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">
                            {result.sceneDescription}
                          </p>
                        </div>
                        <Badge variant="secondary" className="shrink-0">
                          {searchState === "embedding" || searchState === "llm"
                            ? result.score.toFixed(3)
                            : result.score}
                        </Badge>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                        <span className="truncate">{result.assetTitle}</span>
                        <span className="shrink-0">{result.timestamp}</span>
                      </div>
                    </button>
                  );
                })
              )}
            </>
          ) : (
            <>
          {isExtracting && (
            <div className="mb-3 rounded-lg border border-dashed border-primary/40 bg-primary/5 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <LoaderCircle className="h-4 w-4 animate-spin text-primary" />
                正在提取剧情大纲
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                已将当前素材的剧情简介和 SRT 字幕发送给 AI，等待结构化结果返回。
              </p>
            </div>
          )}

          {!isExtracting && extractionError && (
            <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
              <div className="text-sm font-medium text-destructive">提取失败</div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {extractionError}
              </p>
            </div>
          )}

          {!isExtracting && !extractionError && scenes.length === 0 && (
            <div className="flex min-h-52 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-6 text-center">
              <Sparkles className="h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium text-foreground">
                暂无剧情大纲
              </p>
              <p className="mt-2 max-w-xs text-xs leading-5 text-muted-foreground">
                先为素材补充剧情简介和 SRT 字幕，再从素材菜单中点击“提取大纲”。
              </p>
            </div>
          )}

          {scenes.map((scene, index) => (
            <div
              key={scene.id}
              ref={(element) => {
                sceneRefs.current[scene.id] = element;
              }}
              role="button"
              tabIndex={0}
              onClick={() => onSceneSelect(scene.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSceneSelect(scene.id);
                }
              }}
              className={cn(
                "group relative mb-2 flex w-full flex-col rounded-lg p-3 text-left transition-colors",
                currentSceneId === scene.id
                  ? "bg-secondary"
                  : "hover:bg-secondary/50"
              )}
            >
              {/* Drag Handle */}
              <div className="absolute left-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                <GripVertical className="h-4 w-4 text-muted-foreground" />
              </div>

              <div className="pl-4">
                {/* Scene Header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
                    <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                      {index + 1}
                    </span>
                    <span className="truncate text-sm font-medium text-card-foreground">
                      {scene.title}
                    </span>
                  </div>

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-muted-foreground hover:text-card-foreground"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleToggleExpanded(scene.id);
                    }}
                  >
                    {expandedSceneId === scene.id ? "收起" : "展开"}
                    {expandedSceneId === scene.id ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </Button>
                </div>

                {/* Description */}
                <div
                  className={cn(
                    "mt-2 overflow-hidden rounded-md",
                    expandedSceneId === scene.id ? "max-h-48 overflow-y-auto" : ""
                  )}
                >
                  <p
                    className={cn(
                      "text-xs leading-5 text-muted-foreground",
                      expandedSceneId === scene.id ? "" : "line-clamp-3"
                    )}
                  >
                    {scene.description}
                  </p>
                </div>

                {/* Footer */}
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{scene.timestamp}</span>
                    <span className="text-muted-foreground/50">|</span>
                    <span>{scene.duration}</span>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-card-foreground"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Edit2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    disabled={scene.shotAnalysis?.status === "loading"}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleShotAnalysisAction(scene);
                    }}
                  >
                    {scene.shotAnalysis?.status === "loading" ? (
                      <LoaderCircle className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Clapperboard className="mr-1 h-3.5 w-3.5" />
                    )}
                    {getShotAnalysisButtonLabel(scene)}
                  </Button>
                  {scene.shotAnalysis?.updatedAt ? (
                    <span className="text-[11px] text-muted-foreground">
                      已更新
                    </span>
                  ) : null}
                </div>

                {scene.subtitleEntries?.length ? (
                  <div className="mt-3 rounded-lg border border-border/70 bg-background/70">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between px-3 py-2 text-left"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleSubtitleToggle(scene.id);
                      }}
                    >
                      <span className="text-xs font-medium text-foreground">
                        切片字幕 · {scene.subtitleEntries.length} 条
                      </span>
                      {expandedSubtitleSceneId === scene.id ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                    </button>

                    {expandedSubtitleSceneId === scene.id ? (
                      <div className="border-t border-border/70 px-2 py-2">
                        <div className="max-h-52 space-y-1 overflow-y-auto">
                          {scene.subtitleEntries.map((entry) => (
                            <button
                              key={entry.id}
                              type="button"
                              className="w-full rounded-md px-2 py-2 text-left transition-colors hover:bg-secondary/60"
                              onClick={(event) => {
                                event.stopPropagation();
                                onSceneSubtitleSelect?.(scene.id, entry.startSeconds);
                              }}
                            >
                              <p className="text-[11px] text-muted-foreground">
                                {entry.timeline}
                              </p>
                              <p className="mt-1 text-xs leading-5 text-foreground">
                                {entry.content}
                              </p>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {scene.shotAnalysis &&
                (expandedSceneId === scene.id || scene.shotAnalysis.status !== "success") ? (
                  <div className="mt-3 rounded-lg border border-border/70 bg-muted/20 p-3">
                    <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                      <Clapperboard className="h-3.5 w-3.5" />
                      镜头解读
                    </div>

                    {scene.shotAnalysis.status === "loading" ? (
                      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin text-primary" />
                        正在抽样画面并生成结构化解读
                      </div>
                    ) : null}

                    {scene.shotAnalysis.status === "error" ? (
                      <p className="mt-2 text-xs leading-5 text-destructive">
                        {scene.shotAnalysis.error || "镜头解读生成失败。"}
                      </p>
                    ) : null}

                    {scene.shotAnalysis.summary ? (
                      <p className="mt-2 text-xs leading-5 text-foreground">
                        {scene.shotAnalysis.summary}
                      </p>
                    ) : null}

                    {scene.shotAnalysis.status === "success" ? (
                      <div className="mt-3 space-y-3 text-xs leading-5 text-muted-foreground">
                        <div className="space-y-2">
                          <p><span className="font-medium text-foreground">人物动作：</span>{scene.shotAnalysis.action}</p>
                          <p><span className="font-medium text-foreground">表情与眼神：</span>{scene.shotAnalysis.expressionAndGaze}</p>
                          <p><span className="font-medium text-foreground">镜头语言：</span>{scene.shotAnalysis.cinematography}</p>
                          <p><span className="font-medium text-foreground">画面氛围：</span>{scene.shotAnalysis.atmosphere}</p>
                          <p><span className="font-medium text-foreground">解说价值点：</span>{scene.shotAnalysis.commentaryHooks}</p>
                        </div>
                        <div className="flex justify-end">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="h-7 text-[11px]"
                            onClick={(event) => {
                              event.stopPropagation();
                              void onGenerateShotAnalysis?.(scene.id);
                              setExpandedSceneId(scene.id);
                            }}
                          >
                            <Sparkles className="h-3.5 w-3.5" />
                            重新解读
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {/* Current Scene Indicator */}
              {currentSceneId === scene.id && (
                <div className="absolute left-0 top-1/2 h-8 w-1 -translate-y-1/2 rounded-r-full bg-primary" />
              )}
            </div>
          ))}
            </>
          )}
        </div>
      </ScrollArea>

    </div>
  );
}
