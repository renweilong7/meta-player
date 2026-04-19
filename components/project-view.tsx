"use client";

import { useMemo, useState } from "react";
import {
  ArrowRight,
  Edit2,
  FolderKanban,
  MoreVertical,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CrossAssetSwitchMode,
  StorySearchProvider,
} from "@/lib/persistence/types";

export interface ProjectItem {
  id: string;
  name: string;
  description?: string;
  materialIds: string[];
  storySearchProvider: StorySearchProvider;
  crossAssetSwitchMode?: CrossAssetSwitchMode;
  autoTrimIntroOutro?: boolean;
  introTrimSeconds?: number;
  outroTrimSeconds?: number;
  scriptSrtContent?: string;
  scriptAudio?: {
    filename: string;
    absolutePath: string;
    fileSize: number;
  };
  scriptMatchResults?: Record<
    string,
    {
      assetId: string;
      assetTitle: string;
      startSeconds: number;
    }
  >;
  scriptItems: Array<{
    id: string;
    lineIndex: number;
    content: string;
    ttsStatus: "idle" | "loading" | "success" | "error";
    ttsError?: string | null;
    audioSrc?: string;
  }>;
  scriptClips: Array<{
    id: string;
    scriptItemId: string;
    scriptContent: string;
    label: string;
    sourceAssetId: string;
    sourceAssetTitle: string;
    sourceStartSeconds: number;
    audioStartSeconds: number;
    durationSeconds: number;
    absolutePath: string;
    fileSize: number;
    src: string;
    createdAt: string;
    updatedAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

interface ProjectViewProps {
  items: ProjectItem[];
  selectedProjectId: string | null;
  canManageProjects?: boolean;
  defaultStorySearchProvider: StorySearchProvider;
  onCreateProject: (input: {
    name: string;
    description?: string;
    storySearchProvider: StorySearchProvider;
  }) => void | Promise<void>;
  onUpdateProject: (
    id: string,
    updates: {
      name: string;
      description?: string;
      storySearchProvider?: StorySearchProvider;
      crossAssetSwitchMode?: CrossAssetSwitchMode;
      autoTrimIntroOutro?: boolean;
      introTrimSeconds?: number;
      outroTrimSeconds?: number;
    }
  ) => void | Promise<void>;
  onDeleteProject: (id: string) => void | Promise<void>;
  onOpenProject: (id: string) => void;
}

export function ProjectView({
  items,
  selectedProjectId,
  canManageProjects = true,
  defaultStorySearchProvider,
  onCreateProject,
  onUpdateProject,
  onDeleteProject,
  onOpenProject,
}: ProjectViewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [storySearchProvider, setStorySearchProvider] =
    useState<StorySearchProvider>(defaultStorySearchProvider);
  const [crossAssetSwitchMode, setCrossAssetSwitchMode] =
    useState<CrossAssetSwitchMode>("frame_hold");
  const [autoTrimIntroOutro, setAutoTrimIntroOutro] = useState(false);
  const [introTrimSeconds, setIntroTrimSeconds] = useState("0");
  const [outroTrimSeconds, setOutroTrimSeconds] = useState("0");

  const filteredItems = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase();
    if (!keyword) {
      return items;
    }

    return items.filter((item) =>
      [item.name, item.description ?? ""].some((value) =>
        value.toLowerCase().includes(keyword)
      )
    );
  }, [items, searchQuery]);

  const resetDialog = () => {
    setIsDialogOpen(false);
    setEditingProjectId(null);
    setProjectName("");
    setProjectDescription("");
    setStorySearchProvider(defaultStorySearchProvider);
    setCrossAssetSwitchMode("frame_hold");
    setAutoTrimIntroOutro(false);
    setIntroTrimSeconds("0");
    setOutroTrimSeconds("0");
  };

  const handleCreateClick = () => {
    setEditingProjectId(null);
    setProjectName("");
    setProjectDescription("");
    setStorySearchProvider(defaultStorySearchProvider);
    setIsDialogOpen(true);
  };

  const handleEditClick = (project: ProjectItem) => {
    setEditingProjectId(project.id);
    setProjectName(project.name);
    setProjectDescription(project.description ?? "");
    setStorySearchProvider(project.storySearchProvider);
    setCrossAssetSwitchMode(project.crossAssetSwitchMode ?? "frame_hold");
    setAutoTrimIntroOutro(project.autoTrimIntroOutro ?? false);
    setIntroTrimSeconds(String(project.introTrimSeconds ?? 0));
    setOutroTrimSeconds(String(project.outroTrimSeconds ?? 0));
    setIsDialogOpen(true);
  };

  const handleSubmit = () => {
    const normalizedName = projectName.trim();
    const normalizedDescription = projectDescription.trim();
    const normalizedIntroTrimSeconds = Math.max(Number(introTrimSeconds) || 0, 0);
    const normalizedOutroTrimSeconds = Math.max(Number(outroTrimSeconds) || 0, 0);

    if (!normalizedName) {
      return;
    }

    if (editingProjectId) {
      onUpdateProject(editingProjectId, {
        name: normalizedName,
        description: normalizedDescription || undefined,
        storySearchProvider,
        crossAssetSwitchMode,
        autoTrimIntroOutro,
        introTrimSeconds: normalizedIntroTrimSeconds,
        outroTrimSeconds: normalizedOutroTrimSeconds,
      });
    } else {
      onCreateProject({
        name: normalizedName,
        description: normalizedDescription || undefined,
        storySearchProvider,
      });
    }

    resetDialog();
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="border-b border-border px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">项目管理</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              从这里进入项目工作台，项目内的素材、播放器和剧情大纲会一起联动。
            </p>
          </div>
          {canManageProjects ? (
            <Button onClick={handleCreateClick} className="gap-2">
              <Plus className="h-4 w-4" />
              新建项目
            </Button>
          ) : null}
        </div>

        <div className="relative mt-4 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="搜索项目..."
            className="pl-9"
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {filteredItems.length === 0 ? (
          <div className="flex h-full min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 px-6 text-center">
            <FolderKanban className="h-10 w-10 text-muted-foreground" />
            <p className="mt-4 text-base font-medium text-foreground">
              {items.length === 0 ? "还没有项目" : "没有匹配的项目"}
            </p>
            <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
              {items.length === 0
                ? "创建一个项目后，就可以直接进入对应的素材、播放器和剧情大纲工作台。"
                : "试试修改关键词，或者直接创建一个新项目。"}
            </p>
            {canManageProjects ? (
              <Button onClick={handleCreateClick} variant="outline" className="mt-5 gap-2">
                <Plus className="h-4 w-4" />
                新建项目
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredItems.map((item) => {
              const isActive = item.id === selectedProjectId;

              return (
                <div
                  key={item.id}
                  className={
                    "group rounded-2xl border bg-card p-5 transition-colors " +
                    (isActive
                      ? "border-primary/40 shadow-sm shadow-primary/10"
                      : "border-border hover:border-primary/30")
                  }
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
                        <FolderKanban className="h-5 w-5 text-primary" />
                      </div>
                      <h2 className="mt-4 truncate text-base font-semibold text-foreground">
                        {item.name}
                      </h2>
                      <p className="mt-2 line-clamp-2 min-h-10 text-sm leading-5 text-muted-foreground">
                        {item.description || "该项目暂未填写描述。"}
                      </p>
                    </div>

                    {canManageProjects ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleEditClick(item)}>
                            <Edit2 className="mr-2 h-4 w-4" />
                            编辑项目
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => onDeleteProject(item.id)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            删除项目
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </div>

                  <div className="mt-5 flex items-center justify-between text-sm text-muted-foreground">
                    <span>{item.materialIds.length} 个素材</span>
                    <span>{item.updatedAt}</span>
                  </div>

                  <Button
                    className="mt-5 w-full justify-between"
                    variant={isActive ? "default" : "outline"}
                    onClick={() => onOpenProject(item.id)}
                  >
                    进入项目
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Dialog
        open={canManageProjects && isDialogOpen}
        onOpenChange={setIsDialogOpen}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingProjectId ? "编辑项目" : "新建项目"}</DialogTitle>
            <DialogDescription>
              每个项目都会绑定自己的剧情搜索方案，方便按项目内容选择更合适的检索方式。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground" htmlFor="project-name">
                项目名称
              </label>
              <Input
                id="project-name"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                placeholder="例如：城市纪录片"
              />
            </div>

            <div className="space-y-2">
              <label
                className="text-sm font-medium text-foreground"
                htmlFor="project-description"
              >
                项目描述
              </label>
              <Input
                id="project-description"
                value={projectDescription}
                onChange={(event) => setProjectDescription(event.target.value)}
                placeholder="一句话描述这个项目的目标或内容"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="project-search-provider">剧情搜索方案</Label>
              <Select
                value={storySearchProvider}
                onValueChange={(value) => setStorySearchProvider(value as StorySearchProvider)}
              >
                <SelectTrigger id="project-search-provider">
                  <SelectValue placeholder="选择剧情搜索方案" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="keyword">关键词检索</SelectItem>
                  <SelectItem value="llm">直接大模型搜索</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {editingProjectId ? (
              <>
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-foreground">
                    跨素材切换策略
                  </Label>
                  <Select
                    value={crossAssetSwitchMode}
                    onValueChange={(value) =>
                      setCrossAssetSwitchMode(value as CrossAssetSwitchMode)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择跨素材切换策略" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="frame_hold">保留上一帧</SelectItem>
                      <SelectItem value="preload">预加载目标素材</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="rounded-xl border border-border p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-foreground">导入时自动去掉片头片尾</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        只对新导入的视频生效，会生成裁剪后的项目素材。
                      </p>
                    </div>
                    <Switch
                      checked={autoTrimIntroOutro}
                      onCheckedChange={setAutoTrimIntroOutro}
                    />
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium text-foreground">
                        片头时长（秒）
                      </Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.1"
                        value={introTrimSeconds}
                        onChange={(event) => setIntroTrimSeconds(event.target.value)}
                        disabled={!autoTrimIntroOutro}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-sm font-medium text-foreground">
                        片尾时长（秒）
                      </Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.1"
                        value={outroTrimSeconds}
                        onChange={(event) => setOutroTrimSeconds(event.target.value)}
                        disabled={!autoTrimIntroOutro}
                      />
                    </div>
                  </div>
                </div>
              </>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={resetDialog}>
              取消
            </Button>
            <Button onClick={handleSubmit}>
              {editingProjectId ? "保存修改" : "创建项目"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
