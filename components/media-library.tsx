"use client";

import { useState, useRef } from "react";
import { cn } from "@/lib/utils";
import { Search, Plus, MoreVertical, Play, FileText, FileUp, ListTree, Trash2 } from "lucide-react";
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

export interface MediaItem {
  id: string;
  title: string;
  thumbnail: string;
  duration: string;
  addedAt: string;
  synopsis?: string;
  srtContent?: string;
}

interface MediaLibraryProps {
  items: MediaItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onUpdateItem?: (id: string, updates: Partial<MediaItem>) => void;
  onAddMaterials?: (files: File[]) => void;
  onDeleteItem?: (id: string) => void;
}

type DialogType = "synopsis" | "srt" | null;

export function MediaLibrary({ items, selectedId, onSelect, onUpdateItem, onAddMaterials, onDeleteItem }: MediaLibraryProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleAddClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onAddMaterials?.(Array.from(e.target.files));
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
    // 提取大纲逻辑 - 这里可以调用 AI 接口
    console.log("提取大纲:", itemId);
  };

  const handleSave = () => {
    if (!activeItemId || !onUpdateItem) return;
    
    if (dialogType === "synopsis") {
      onUpdateItem(activeItemId, { synopsis: synopsisText });
    } else if (dialogType === "srt") {
      onUpdateItem(activeItemId, { srtContent: srtText });
    }
    
    setDialogOpen(false);
    setDialogType(null);
    setActiveItemId(null);
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
    <div className="flex h-full w-72 flex-col border-r border-border bg-card">
      {/* Header */}
      <div className="border-b border-border p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-card-foreground">素材库</h2>
          <Button onClick={handleAddClick} variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-card-foreground">
            <Plus className="h-4 w-4" />
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
        <div className="p-2">
          {items.map((item) => (
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
                "group flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors cursor-pointer",
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
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-medium text-card-foreground">
                  {item.title}
                </p>
                <p className="text-xs text-muted-foreground">{item.addedAt}</p>
                {item.synopsis && (
                  <p className="text-xs text-primary mt-0.5 truncate">已有简介</p>
                )}
              </div>

              {/* More Button with Dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-card-foreground"
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
                  <DropdownMenuItem onClick={(e) => handleExtractOutline(item.id, e as unknown as React.MouseEvent)}>
                    <ListTree className="mr-2 h-4 w-4" />
                    提取大纲
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={(e) => { e.stopPropagation(); onDeleteItem?.(item.id); }}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    删除素材
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
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
                className="resize-none"
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
                className="resize-none font-mono text-sm"
              />
              <Button variant="outline" className="w-full">
                <FileUp className="mr-2 h-4 w-4" />
                上传 SRT 文件
              </Button>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSave}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
