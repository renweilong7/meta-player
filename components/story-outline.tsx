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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StoryScene } from "@/lib/story-outline/types";

interface StoryOutlineProps {
  scenes: StoryScene[];
  currentSceneId: string | null;
  isExtracting?: boolean;
  extractionError?: string | null;
  onSceneSelect: (id: string) => void;
}

export function StoryOutline({
  scenes,
  currentSceneId,
  isExtracting = false,
  extractionError = null,
  onSceneSelect,
}: StoryOutlineProps) {
  const [expandedSceneId, setExpandedSceneId] = useState<string | null>(null);
  const sceneRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const handleToggleExpanded = (sceneId: string) => {
    setExpandedSceneId((current) => (current === sceneId ? null : sceneId));
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
          共 {scenes.length} 个场景
        </p>
      </div>

      {/* Scene List */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-2">
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
              </div>

              {/* Current Scene Indicator */}
              {currentSceneId === scene.id && (
                <div className="absolute left-0 top-1/2 h-8 w-1 -translate-y-1/2 rounded-r-full bg-primary" />
              )}
            </div>
          ))}
        </div>
      </ScrollArea>

    </div>
  );
}
