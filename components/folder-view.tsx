"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  Folder,
  FolderPlus,
  MoreVertical,
  ChevronRight,
  ArrowLeft,
  Film,
  Search,
  Grid3X3,
  List,
  Trash2,
  Edit2,
  FolderInput,
  Play,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

export interface FolderItem {
  id: string;
  name: string;
  type: "folder" | "video";
  thumbnail?: string;
  duration?: string;
  itemCount?: number;
  updatedAt: string;
  parentId: string | null;
}

interface FolderViewProps {
  items: FolderItem[];
  onUpdateItems: (items: FolderItem[]) => void;
  onSelectVideo?: (videoId: string) => void;
}

export function FolderView({ items, onUpdateItems, onSelectVideo }: FolderViewProps) {
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [editingItem, setEditingItem] = useState<FolderItem | null>(null);

  // 获取当前文件夹下的项目
  const currentItems = items.filter((item) => item.parentId === currentFolderId);

  // 搜索过滤
  const filteredItems = currentItems.filter((item) =>
    item.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // 获取面包屑路径
  const getBreadcrumbs = () => {
    const breadcrumbs: { id: string | null; name: string }[] = [{ id: null, name: "全部文件" }];
    let current = currentFolderId;
    const visited = new Set<string>();

    while (current) {
      if (visited.has(current)) break;
      visited.add(current);
      const folder = items.find((item) => item.id === current);
      if (folder) {
        breadcrumbs.splice(1, 0, { id: folder.id, name: folder.name });
        current = folder.parentId;
      } else {
        break;
      }
    }
    return breadcrumbs;
  };

  const breadcrumbs = getBreadcrumbs();

  // 创建新文件夹
  const handleCreateFolder = () => {
    if (!newFolderName.trim()) return;
    const newFolder: FolderItem = {
      id: `folder-${Date.now()}`,
      name: newFolderName,
      type: "folder",
      itemCount: 0,
      updatedAt: "刚刚",
      parentId: currentFolderId,
    };
    onUpdateItems([...items, newFolder]);
    setNewFolderName("");
    setIsCreateFolderOpen(false);
  };

  // 重命名
  const handleRename = () => {
    if (!editingItem || !newFolderName.trim()) return;
    onUpdateItems(
      items.map((item) =>
        item.id === editingItem.id ? { ...item, name: newFolderName } : item
      )
    );
    setNewFolderName("");
    setEditingItem(null);
    setIsRenameOpen(false);
  };

  // 删除项目
  const handleDelete = (itemId: string) => {
    // 递归删除文件夹及其内容
    const idsToDelete = new Set<string>();
    const collectIds = (id: string) => {
      idsToDelete.add(id);
      items.filter((item) => item.parentId === id).forEach((item) => collectIds(item.id));
    };
    collectIds(itemId);
    onUpdateItems(items.filter((item) => !idsToDelete.has(item.id)));
  };

  // 打开文件夹或播放视频
  const handleItemClick = (item: FolderItem) => {
    if (item.type === "folder") {
      setCurrentFolderId(item.id);
    } else if (onSelectVideo) {
      onSelectVideo(item.id);
    }
  };

  // 统计文件夹内的项目数
  const getItemCount = (folderId: string) => {
    return items.filter((item) => item.parentId === folderId).length;
  };

  return (
    <div className="flex h-full flex-col bg-card">
      {/* Header */}
      <div className="border-b border-border p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            {currentFolderId && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-card-foreground"
                onClick={() => {
                  const currentFolder = items.find((item) => item.id === currentFolderId);
                  setCurrentFolderId(currentFolder?.parentId ?? null);
                }}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <h2 className="text-lg font-semibold text-card-foreground">文件管理</h2>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-8 w-8",
                viewMode === "list" ? "text-primary" : "text-muted-foreground"
              )}
              onClick={() => setViewMode("list")}
            >
              <List className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-8 w-8",
                viewMode === "grid" ? "text-primary" : "text-muted-foreground"
              )}
              onClick={() => setViewMode("grid")}
            >
              <Grid3X3 className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-border text-card-foreground"
              onClick={() => setIsCreateFolderOpen(true)}
            >
              <FolderPlus className="h-4 w-4" />
              新建文件夹
            </Button>
          </div>
        </div>

        {/* 面包屑 */}
        <div className="flex items-center gap-1 text-sm mb-4">
          {breadcrumbs.map((crumb, index) => (
            <div key={crumb.id ?? "root"} className="flex items-center gap-1">
              {index > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
              <button
                onClick={() => setCurrentFolderId(crumb.id)}
                className={cn(
                  "hover:text-primary transition-colors",
                  index === breadcrumbs.length - 1
                    ? "text-card-foreground font-medium"
                    : "text-muted-foreground"
                )}
              >
                {crumb.name}
              </button>
            </div>
          ))}
        </div>

        {/* 搜索框 */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜索文件和文件夹..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 bg-secondary border-border text-card-foreground placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Folder className="h-16 w-16 mb-4 opacity-50" />
            <p className="text-sm">此文件夹为空</p>
            <Button
              variant="link"
              className="mt-2 text-primary"
              onClick={() => setIsCreateFolderOpen(true)}
            >
              创建新文件夹
            </Button>
          </div>
        ) : viewMode === "list" ? (
          <div className="space-y-1">
            {/* 表头 */}
            <div className="grid grid-cols-12 gap-4 px-3 py-2 text-xs text-muted-foreground border-b border-border">
              <div className="col-span-6">名称</div>
              <div className="col-span-2">类型</div>
              <div className="col-span-2">项目数/时长</div>
              <div className="col-span-2">更新时间</div>
            </div>
            {filteredItems.map((item) => (
              <div
                key={item.id}
                className="group grid grid-cols-12 gap-4 items-center px-3 py-3 rounded-lg hover:bg-secondary cursor-pointer transition-colors"
                onClick={() => handleItemClick(item)}
              >
                <div className="col-span-6 flex items-center gap-3">
                  {item.type === "folder" ? (
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                      <Folder className="h-5 w-5 text-primary" />
                    </div>
                  ) : (
                    <div className="relative h-10 w-16 rounded overflow-hidden bg-secondary">
                      {item.thumbnail && (
                        <img
                          src={item.thumbnail}
                          alt={item.name}
                          className="h-full w-full object-cover"
                        />
                      )}
                      <div className="absolute inset-0 flex items-center justify-center bg-background/50 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Play className="h-4 w-4 text-card-foreground" />
                      </div>
                    </div>
                  )}
                  <span className="text-sm text-card-foreground truncate">{item.name}</span>
                </div>
                <div className="col-span-2 text-sm text-muted-foreground">
                  {item.type === "folder" ? "文件夹" : "视频"}
                </div>
                <div className="col-span-2 text-sm text-muted-foreground">
                  {item.type === "folder" ? `${getItemCount(item.id)} 项` : item.duration}
                </div>
                <div className="col-span-2 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{item.updatedAt}</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-card-foreground"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40">
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingItem(item);
                          setNewFolderName(item.name);
                          setIsRenameOpen(true);
                        }}
                      >
                        <Edit2 className="h-4 w-4 mr-2" />
                        重命名
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                        }}
                      >
                        <FolderInput className="h-4 w-4 mr-2" />
                        移动到...
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(item.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        删除
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-4">
            {filteredItems.map((item) => (
              <div
                key={item.id}
                className="group relative rounded-lg border border-border bg-secondary/50 p-3 hover:bg-secondary cursor-pointer transition-colors"
                onClick={() => handleItemClick(item)}
              >
                <div className="flex flex-col items-center">
                  {item.type === "folder" ? (
                    <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-primary/10 mb-3">
                      <Folder className="h-10 w-10 text-primary" />
                    </div>
                  ) : (
                    <div className="relative h-20 w-full rounded-lg overflow-hidden bg-background mb-3">
                      {item.thumbnail && (
                        <img
                          src={item.thumbnail}
                          alt={item.name}
                          className="h-full w-full object-cover"
                        />
                      )}
                      <div className="absolute bottom-1 right-1 rounded bg-background/80 px-1.5 py-0.5 text-xs text-card-foreground">
                        {item.duration}
                      </div>
                      <div className="absolute inset-0 flex items-center justify-center bg-background/50 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Play className="h-8 w-8 text-card-foreground" />
                      </div>
                    </div>
                  )}
                  <p className="text-sm text-card-foreground text-center truncate w-full">
                    {item.name}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {item.type === "folder" ? `${getItemCount(item.id)} 项` : item.duration}
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-card-foreground"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40">
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingItem(item);
                        setNewFolderName(item.name);
                        setIsRenameOpen(true);
                      }}
                    >
                      <Edit2 className="h-4 w-4 mr-2" />
                      重命名
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                    >
                      <FolderInput className="h-4 w-4 mr-2" />
                      移动到...
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(item.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      删除
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 新建文件夹对话框 */}
      <Dialog open={isCreateFolderOpen} onOpenChange={setIsCreateFolderOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>新建文件夹</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="输入文件夹名称"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateFolder()}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateFolderOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreateFolder} disabled={!newFolderName.trim()}>
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 重命名对话框 */}
      <Dialog open={isRenameOpen} onOpenChange={setIsRenameOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>重命名</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="输入新名称"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleRename()}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRenameOpen(false)}>
              取消
            </Button>
            <Button onClick={handleRename} disabled={!newFolderName.trim()}>
              确定
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
