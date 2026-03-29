"use client";

import { useState, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  Search,
  Plus,
  MoreVertical,
  Play,
  FileText,
  FileUp,
  ListTree,
  LoaderCircle,
  Trash2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PersistedMaterialMarker } from "@/lib/persistence/types";
import {
  OutlineExtractionStatus,
  StoryOutlineSceneRecord,
} from "@/lib/story-outline/types";

export interface MediaItem {
  id: string;
  title: string;
  thumbnail: string;
  src?: string;
  duration: string;
  addedAt: string;
  mediaType?: "video" | "image";
  synopsis?: string;
  srtContent?: string;
  storyOutline?: StoryOutlineSceneRecord[];
  markers?: PersistedMaterialMarker[];
  outlineExtractionStatus?: OutlineExtractionStatus;
  outlineExtractionError?: string | null;
}

interface MediaLibraryProps {
  items: MediaItem[];
  selectedId: string | null;
  projectName?: string | null;
  onSelect: (id: string) => void;
  onUpdateItem?: (id: string, updates: Partial<MediaItem>) => void | Promise<void>;
  onAddMaterials?: (files: File[]) => void | Promise<void>;
  onDeleteItem?: (id: string) => void | Promise<void>;
  onExtractOutline?: (id: string) => void | Promise<void>;
}

type DialogType = "synopsis" | "srt" | null;

export function MediaLibrary({
  items,
  selectedId,
  projectName = null,
  onSelect,
  onUpdateItem,
  onAddMaterials,
  onDeleteItem,
  onExtractOutline,
}: MediaLibraryProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isSavingDialog, setIsSavingDialog] = useState(false);
  const [isImportingMaterials, setIsImportingMaterials] = useState(false);
  const [isDeletingMaterialId, setIsDeletingMaterialId] = useState<string | null>(null);

  const handleAddClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setIsImportingMaterials(true);
      try {
        await onAddMaterials?.(Array.from(e.target.files));
      } catch (error) {
        console.error("导入素材失败:", error);
      } finally {
        setIsImportingMaterials(false);
      }
      e.target.value = '';
    }
  };
  const [dialogType, setDialogType] = useState<DialogType>(null);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [synopsisText, setSynopsisText] = useState("");
  const [srtText, setSrtText] = useState("");

  const handleOpenDialog = (type: DialogType, itemId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDialogType(type);
    setActiveItemId(itemId);
    
    const item = items.find(i => i.id === itemId);
    if (type === "synopsis") {
      setSynopsisText(item?.synopsis || "");
    } else if (type === "srt") {
      setSrtText(item?.srtContent || "");
    }
    
    setDialogOpen(true);
  };

  const handleExtractOutline = (itemId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onExtractOutline?.(itemId);
  };

  const handleSave = async () => {
    if (!activeItemId || !onUpdateItem) return;

    setIsSavingDialog(true);

    try {
      if (dialogType === "synopsis") {
        await onUpdateItem(activeItemId, { synopsis: synopsisText });
      } else if (dialogType === "srt") {
        await onUpdateItem(activeItemId, { srtContent: srtText });
      }
    } catch (error) {
      console.error("保存素材文本数据失败:", error);
      return;
    } finally {
      setIsSavingDialog(false);
    }

    setDialogOpen(false);
    setDialogType(null);
    setActiveItemId(null);
  };

  const handleDelete = async (itemId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDeletingMaterialId(itemId);

    try {
      await onDeleteItem?.(itemId);
    } catch (error) {
      console.error("删除素材失败:", error);
    } finally {
      setIsDeletingMaterialId(null);
    }
  };

  const getDialogTitle = () => {
    switch (dialogType) {
      case "synopsis":
        return "添加剧情简介";
      case "srt":
        return "导入 SRT 字幕";
      default:
        return "";
    }
  };

  const activeItem = items.find(i => i.id === activeItemId);

  return (
    <div className="flex h-full min-w-0 w-full flex-col bg-card">
      {/* Header */}
      <div className="border-b border-border p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-card-foreground">素材库</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {projectName ? `当前项目：${projectName}` : "当前未选择项目"}
            </p>
          </div>
          <Button
            onClick={handleAddClick}
            variant="ghost"
            size="icon"
            disabled={isImportingMaterials}
            className="h-8 w-8 text-muted-foreground hover:text-card-foreground"
          >
            {isImportingMaterials ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
          </Button>
          <input
            type="file"
            multiple
            accept="video/*,image/*"
            style={{ display: "none" }}
            ref={fileInputRef}
            onChange={handleFileChange}
          />
        </div>
        <div className="mt-3 relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜索素材..."
            className="h-9 pl-9 bg-input border-border text-foreground placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {/* Media List */}
      <ScrollArea className="flex-1">
        {items.length === 0 ? (
          <div className="flex h-full min-h-72 flex-col items-center justify-center px-6 text-center">
            <p className="text-sm font-medium text-foreground">当前项目还没有素材</p>
            <p className="mt-2 max-w-xs text-xs leading-5 text-muted-foreground">
              点击右上角的加号，把视频或图片导入到当前项目。
            </p>
          </div>
        ) : (
        <div className="p-2">
          {items.map((item) => {
            const hasSynopsis = Boolean(item.synopsis?.trim());
            const hasSrt = Boolean(item.srtContent?.trim());
            const hasOutline = Boolean(item.storyOutline?.length);
            const isExtracting = item.outlineExtractionStatus === "loading";
            const isDeleting = isDeletingMaterialId === item.id;
            const canExtractOutline = hasSynopsis && hasSrt && !isExtracting && !isDeleting;

            return (
              <div
                key={item.id}
                onClick={() => onSelect(item.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(item.id);
                  }
                }}
                className={cn(
                  "group grid w-full min-w-0 grid-cols-[96px_minmax(0,1fr)_28px] items-center gap-3 rounded-lg p-2 text-left transition-colors cursor-pointer",
                  selectedId === item.id
                    ? "bg-secondary"
                    : "hover:bg-secondary/50"
                )}
              >
              {/* Thumbnail */}
              <div className="relative h-14 w-24 flex-shrink-0 overflow-hidden rounded-md bg-muted">
                <img
                  src={item.thumbnail}
                  alt={item.title}
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 flex items-center justify-center bg-background/40 opacity-0 transition-opacity group-hover:opacity-100">
                  <Play className="h-6 w-6 text-foreground" fill="currentColor" />
                </div>
                <div className="absolute bottom-1 right-1 rounded bg-background/80 px-1 py-0.5 text-xs text-foreground">
                  {item.duration}
                </div>
              </div>

              {/* Info */}
                <div className="min-w-0">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <p className="truncate text-sm font-medium text-card-foreground">
                      {item.title}
                    </p>
                  </TooltipTrigger>
                  <TooltipContent side="top" align="start" sideOffset={6} className="max-w-80 break-all">
                    {item.title}
                  </TooltipContent>
                </Tooltip>
                <p className="text-xs text-muted-foreground">{item.addedAt}</p>
                  {(hasSynopsis || hasSrt) && (
                    <div className="mt-1 flex items-center gap-2 text-xs">
                      {hasSynopsis && (
                        <span className="truncate text-primary">已有简介</span>
                      )}
                      {hasSrt && (
                        <span className="truncate text-sky-400">已有 SRT</span>
                      )}
                      {hasOutline && (
                        <span className="truncate text-emerald-400">已有大纲</span>
                      )}
                    </div>
                  )}
                  {isExtracting && (
                    <div className="mt-1 flex items-center gap-1 text-xs text-primary">
                      <LoaderCircle className="h-3 w-3 animate-spin" />
                      提取中
                    </div>
                  )}
                  {!isExtracting && item.outlineExtractionStatus === "error" && (
                    <p className="mt-1 truncate text-xs text-destructive">
                      {item.outlineExtractionError || "提取失败"}
                    </p>
                  )}
                </div>

              {/* More Button with Dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 self-start opacity-0 text-muted-foreground hover:text-card-foreground group-hover:opacity-100 group-focus-within:opacity-100"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem onClick={(e) => handleOpenDialog("synopsis", item.id, e as unknown as React.MouseEvent)}>
                    <FileText className="mr-2 h-4 w-4" />
                    剧情简介
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={(e) => handleOpenDialog("srt", item.id, e as unknown as React.MouseEvent)}>
                    <FileUp className="mr-2 h-4 w-4" />
                    导入 SRT
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!canExtractOutline}
                    onClick={(e) =>
                      handleExtractOutline(item.id, e as unknown as React.MouseEvent)
                    }
                  >
                    <ListTree className="mr-2 h-4 w-4" />
                    {isExtracting ? "提取中..." : "提取大纲"}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={isDeleting}
                    className="text-destructive focus:text-destructive"
                    onClick={(e) => handleDelete(item.id, e as unknown as React.MouseEvent)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    {isDeleting ? "删除中..." : "删除素材"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              </div>
            );
          })}
        </div>
        )}
      </ScrollArea>

      {/* Footer Stats */}
      <div className="border-t border-border p-3">
        <p className="text-xs text-muted-foreground">
          共 {items.length} 个素材
        </p>
      </div>

      {/* Dialog for Synopsis and SRT Import */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{getDialogTitle()}</DialogTitle>
          </DialogHeader>
          
          {activeItem && (
            <div className="mb-4 flex items-center gap-3 rounded-lg bg-secondary p-3">
              <div className="relative h-12 w-20 flex-shrink-0 overflow-hidden rounded-md bg-muted">
                <img
                  src={activeItem.thumbnail}
                  alt={activeItem.title}
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{activeItem.title}</p>
                <p className="text-xs text-muted-foreground">{activeItem.duration}</p>
              </div>
            </div>
          )}

          {dialogType === "synopsis" && (
            <div className="space-y-3">
              <Label htmlFor="synopsis">剧情简介</Label>
              <Textarea
                id="synopsis"
                placeholder="请输入该视频的剧情简介..."
                value={synopsisText}
                onChange={(e) => setSynopsisText(e.target.value)}
                rows={6}
                className="h-48 resize-none overflow-y-auto"
              />
            </div>
          )}

          {dialogType === "srt" && (
            <div className="space-y-3">
              <Label htmlFor="srt">SRT 字幕内容</Label>
              <Textarea
                id="srt"
                placeholder="请粘贴 SRT 字幕内容，或点击下方按钮上传文件..."
                value={srtText}
                onChange={(e) => setSrtText(e.target.value)}
                rows={8}
                className="h-64 resize-none overflow-y-auto font-mono text-sm"
              />
              <Button variant="outline" className="w-full">
                <FileUp className="mr-2 h-4 w-4" />
                上传 SRT 文件
              </Button>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={isSavingDialog}>
              取消
            </Button>
            <Button onClick={handleSave} disabled={isSavingDialog}>
              {isSavingDialog ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
