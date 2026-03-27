"use client";

import { cn } from "@/lib/utils";
import { ChevronRight, GripVertical, Edit2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

export interface StoryScene {
  id: string;
  title: string;
  description: string;
  duration: string;
  timestamp: string;
  status: "completed" | "current" | "upcoming";
}

interface StoryOutlineProps {
  scenes: StoryScene[];
  currentSceneId: string | null;
  onSceneSelect: (id: string) => void;
}

export function StoryOutline({
  scenes,
  currentSceneId,
  onSceneSelect,
}: StoryOutlineProps) {
  const getStatusColor = (status: StoryScene["status"]) => {
    switch (status) {
      case "completed":
        return "bg-green-500/20 text-green-400";
      case "current":
        return "bg-primary/20 text-primary";
      case "upcoming":
        return "bg-muted text-muted-foreground";
    }
  };

  const getStatusText = (status: StoryScene["status"]) => {
    switch (status) {
      case "completed":
        return "已完成";
      case "current":
        return "进行中";
      case "upcoming":
        return "待拍摄";
    }
  };

  return (
    <div className="flex h-full w-80 flex-col border-l border-border bg-card">
      {/* Header */}
      <div className="border-b border-border p-4">
        <h2 className="text-sm font-semibold text-card-foreground">剧情大纲</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          共 {scenes.length} 个场景
        </p>
      </div>

      {/* Scene List */}
      <ScrollArea className="flex-1">
        <div className="p-2">
          {scenes.map((scene, index) => (
            <button
              key={scene.id}
              onClick={() => onSceneSelect(scene.id)}
              className={cn(
                "group relative flex w-full flex-col rounded-lg p-3 text-left transition-colors mb-2",
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
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                      {index + 1}
                    </span>
                    <span className="truncate text-sm font-medium text-card-foreground">
                      {scene.title}
                    </span>
                  </div>
                  <Badge
                    variant="secondary"
                    className={cn("text-xs flex-shrink-0", getStatusColor(scene.status))}
                  >
                    {getStatusText(scene.status)}
                  </Badge>
                </div>

                {/* Description */}
                <p className="mt-2 text-xs text-muted-foreground line-clamp-2">
                  {scene.description}
                </p>

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
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Edit2 className="h-3 w-3" />
                    </Button>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
              </div>

              {/* Current Scene Indicator */}
              {currentSceneId === scene.id && (
                <div className="absolute left-0 top-1/2 h-8 w-1 -translate-y-1/2 rounded-r-full bg-primary" />
              )}
            </button>
          ))}
        </div>
      </ScrollArea>

    </div>
  );
}
