"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  Search,
  Plus,
  MoreVertical,
  Play,
  Pause,
  Check,
  FileText,
  FileUp,
  ListTree,
  LoaderCircle,
  Trash2,
  Music4,
  Captions,
  Link2,
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  PersistedMaterialMarker,
  PersistedProjectScriptAudio,
  PersistedProjectScriptMatchResult,
} from "@/lib/persistence/types";
import {
  OutlineExtractionStatus,
  StoryOutlineSceneRecord,
} from "@/lib/story-outline/types";
import { parseProjectScriptBlocks } from "@/lib/project-script/srt";

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
  projectId?: string | null;
  activeProjectScriptItemId?: string | null;
  projectScriptSrtContent?: string;
  projectScriptAudio?: PersistedProjectScriptAudio;
  projectScriptMatchResults?: Record<string, PersistedProjectScriptMatchResult>;
  muteVideoDuringScriptPlayback?: boolean;
  onMuteVideoDuringScriptPlaybackChange?: (nextValue: boolean) => void;
  canManageMaterials?: boolean;
  canUseOutlineBasic?: boolean;
  canUseOutlineSearch?: boolean;
  onSelect: (id: string) => void;
  onUpdateItem?: (id: string, updates: Partial<MediaItem>) => void | Promise<void>;
  onAddMaterials?: (files: File[]) => void | Promise<void>;
  onDeleteItem?: (id: string) => void | Promise<void>;
  onExtractOutline?: (id: string) => void | Promise<void>;
  onUpdateProjectScript?: (updates: {
    scriptSrtContent?: string;
    scriptAudio?: PersistedProjectScriptAudio | null;
  }) => void | Promise<void>;
  onUploadProjectAudio?: (file: File) => void | Promise<void>;
  onCombineProjectScriptItems?: (input: {
    itemIds: string[];
  }) => void | Promise<void>;
  onActivateProjectScriptItem?: (itemId: string) => void;
  onMatchProjectScriptItem?: (item: {
    id: string;
    content: string;
  }) => Promise<
    | {
        assetId: string;
        assetTitle: string;
        startSeconds: number;
      }
    | null
  >;
  onOffsetProjectScriptWindow?: (input: {
    itemId: string;
    offsetSeconds: number;
    anchorSeconds: number;
  }) => {
    assetId: string;
    assetTitle: string;
    startSeconds: number;
  } | null;
  onLocateProjectScriptItem?: (item: {
    itemId: string;
    assetId: string;
    startSeconds: number;
  }) => void;
  onPrefetchProjectScriptItem?: (item: {
    assetId: string;
    startSeconds: number;
  } | null) => void;
  onCreateProjectScriptClip?: (item: {
    scriptItemId: string;
    scriptContent: string;
    content: string;
    audioStartSeconds: number;
    durationSeconds: number;
  }) => Promise<void>;
  onPlayProjectScriptSegment?: (item: {
    itemId: string;
    videoAssetId: string | null;
    audioStartSeconds: number;
    videoStartSeconds: number;
    audioEndSeconds: number | null;
    durationSeconds: number;
  }) => void;
  onStopProjectScriptSegment?: () => void;
}

type DialogType = "synopsis" | "srt" | null;
type SearchMode = "materials" | "outline";
type ScriptLineItem = ReturnType<typeof parseProjectScriptBlocks>[number];
type ScriptLineMatchState = {
  assetId: string;
  assetTitle: string;
  startSeconds: number;
  status: "matched" | "matching" | "error";
  message?: string;
};

const formatSecondsToTimecode = (value: number) => {
  const safeValue = Math.max(Math.floor(value), 0);
  const hours = Math.floor(safeValue / 3600);
  const minutes = Math.floor((safeValue % 3600) / 60);
  const seconds = safeValue % 60;

  return [hours, minutes, seconds]
    .map((item) => item.toString().padStart(2, "0"))
    .join(":");
};

export function MediaLibrary({
  items,
  selectedId,
  projectName = null,
  projectId = null,
  activeProjectScriptItemId = null,
  projectScriptSrtContent,
  projectScriptAudio,
  projectScriptMatchResults,
  canManageMaterials = true,
  canUseOutlineBasic = true,
  canUseOutlineSearch = true,
  onSelect,
  onUpdateItem,
  onAddMaterials,
  onDeleteItem,
  onExtractOutline,
  onUpdateProjectScript,
  onUploadProjectAudio,
  onCombineProjectScriptItems,
  onActivateProjectScriptItem,
  onMatchProjectScriptItem,
  onOffsetProjectScriptWindow,
  onLocateProjectScriptItem,
  onPrefetchProjectScriptItem,
  onCreateProjectScriptClip,
  onPlayProjectScriptSegment,
  onStopProjectScriptSegment,
  muteVideoDuringScriptPlayback = true,
  onMuteVideoDuringScriptPlaybackChange,
}: MediaLibraryProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const srtInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [projectScriptDialogOpen, setProjectScriptDialogOpen] = useState(false);
  const [isSavingDialog, setIsSavingDialog] = useState(false);
  const [isImportingMaterials, setIsImportingMaterials] = useState(false);
  const [isImportingSrt, setIsImportingSrt] = useState(false);
  const [isImportingProjectAudio, setIsImportingProjectAudio] = useState(false);
  const [isSavingProjectScript, setIsSavingProjectScript] = useState(false);
  const [isCombiningProjectScript, setIsCombiningProjectScript] = useState(false);
  const [isDeletingMaterialId, setIsDeletingMaterialId] = useState<string | null>(null);
  const [playingScriptItemId, setPlayingScriptItemId] = useState<string | null>(null);
  const [selectedScriptItemIds, setSelectedScriptItemIds] = useState<string[]>([]);
  const [scriptItemMatchState, setScriptItemMatchState] = useState<
    Record<string, ScriptLineMatchState>
  >(() =>
    Object.fromEntries(
      Object.entries(projectScriptMatchResults ?? {}).map(([itemId, match]) => [
        itemId,
        {
          ...match,
          status: "matched" as const,
          message: `已定位到 ${match.assetTitle} · ${formatSecondsToTimecode(
            match.startSeconds
          )}`,
        },
      ])
    )
  );
  const projectScriptAudioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const pauseTimerRef = useRef<number | null>(null);
  const activeScriptItemElementRef = useRef<HTMLDivElement | null>(null);

  const handleAddClick = () => {
    if (!canManageMaterials) {
      return;
    }

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
  const [searchMode, setSearchMode] = useState<SearchMode>("materials");
  const [searchQuery, setSearchQuery] = useState("");
  const [projectScriptDraft, setProjectScriptDraft] = useState(projectScriptSrtContent ?? "");

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredItems = useMemo(() => {
    if (!normalizedQuery || searchMode !== "materials") {
      return items;
    }

    return items.filter((item) =>
      [item.title, item.synopsis ?? ""].some((value) =>
        value.toLowerCase().includes(normalizedQuery)
      )
    );
  }, [items, normalizedQuery, searchMode]);

  const handleSubmitSearch = () => {
    setSearchQuery((current) => current.trim());
  };

  useEffect(() => {
    if (searchMode === "outline" && !canUseOutlineSearch) {
      setSearchMode("materials");
    }
  }, [canUseOutlineSearch, searchMode]);

  useEffect(() => {
    setProjectScriptDraft(projectScriptSrtContent ?? "");
  }, [projectScriptSrtContent]);

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
  const scriptLineItems = useMemo(
    () => parseProjectScriptBlocks(projectScriptDraft),
    [projectScriptDraft]
  );
  const hasProjectScript = projectScriptDraft.trim().length > 0;
  const projectAudioSrc =
    projectId && projectScriptAudio ? `/api/projects/${projectId}/audio` : null;
  const selectedScriptIndexMap = useMemo(
    () => new Map(scriptLineItems.map((item, index) => [item.id, index])),
    [scriptLineItems]
  );
  const selectedScriptItems = useMemo(
    () =>
      selectedScriptItemIds
        .map((itemId) => {
          const index = selectedScriptIndexMap.get(itemId);
          return index === undefined ? null : scriptLineItems[index];
        })
        .filter((item): item is ScriptLineItem => item !== null)
        .sort((left, right) => left.index - right.index),
    [scriptLineItems, selectedScriptItemIds, selectedScriptIndexMap]
  );
  const canCombineSelectedScriptItems =
    selectedScriptItems.length >= 2 &&
    selectedScriptItems.every(
      (item, index) => index === 0 || item.index === selectedScriptItems[index - 1].index + 1
    );

  useEffect(() => {
    const player = projectScriptAudioPlayerRef.current;
    if (!player) {
      return;
    }

    const handleEnded = () => {
      setPlayingScriptItemId(null);
      onStopProjectScriptSegment?.();
    };
    player.addEventListener("ended", handleEnded);
    player.addEventListener("pause", handleEnded);

    return () => {
      player.removeEventListener("ended", handleEnded);
      player.removeEventListener("pause", handleEnded);
    };
  }, [onStopProjectScriptSegment]);

  useEffect(() => {
    return () => {
      if (pauseTimerRef.current !== null) {
        window.clearTimeout(pauseTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const validItemIds = new Set(scriptLineItems.map((item) => item.id));
    setSelectedScriptItemIds((previous) =>
      previous.filter((itemId) => validItemIds.has(itemId))
    );
    setScriptItemMatchState((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(([itemId]) => validItemIds.has(itemId))
      )
    );
  }, [scriptLineItems]);

  useEffect(() => {
    setScriptItemMatchState(
      Object.fromEntries(
        Object.entries(projectScriptMatchResults ?? {}).map(([itemId, match]) => [
          itemId,
          {
            assetId: match.assetId,
            assetTitle: match.assetTitle,
            startSeconds: match.startSeconds,
            status: "matched" as const,
            message: `已定位到 ${match.assetTitle} · ${formatSecondsToTimecode(
              match.startSeconds
            )}`,
          },
        ])
      )
    );
  }, [projectScriptMatchResults]);

  useEffect(() => {
    if (!activeProjectScriptItemId) {
      return;
    }

    activeScriptItemElementRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [activeProjectScriptItemId]);

  const handleToggleScriptItemSelection = (itemId: string) => {
    setSelectedScriptItemIds((previous) => {
      if (previous.includes(itemId)) {
        return previous.filter((currentItemId) => currentItemId !== itemId);
      }

      return [...previous, itemId];
    });
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 w-full flex-col bg-card">
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
            disabled={!canManageMaterials || isImportingMaterials}
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
        {canUseOutlineSearch ? (
          <ToggleGroup
            type="single"
            value={searchMode}
            onValueChange={(value) => {
              if (value === "materials" || value === "outline") {
                setSearchMode(value);
              }
            }}
            variant="outline"
            size="sm"
            className="mt-3 grid w-full grid-cols-2"
          >
            <ToggleGroupItem value="materials" aria-label="搜索素材">
              素材
            </ToggleGroupItem>
            <ToggleGroupItem value="outline" aria-label="搜索剧情">
              剧情
            </ToggleGroupItem>
          </ToggleGroup>
        ) : null}
        <div className="mt-3 flex items-center gap-2">
          {searchMode === "materials" ? (
            <>
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleSubmitSearch();
                    }
                  }}
                  placeholder="搜索素材..."
                  className="h-9 border-border bg-input pl-9 text-foreground placeholder:text-muted-foreground"
                />
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleSubmitSearch}
                className="h-9 shrink-0"
              >
                搜索
              </Button>
            </>
          ) : (
            <div className="w-full rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              剧情模式展示当前项目的 SRT 脚本，可导入 SRT 文件或直接输入 SRT 内容，下面按字幕条目展示。
            </div>
          )}
        </div>
      </div>

      {/* Media List */}
      <ScrollArea className="min-h-0 flex-1">
        {searchMode === "materials" && items.length === 0 ? (
          <div className="flex h-full min-h-72 flex-col items-center justify-center px-6 text-center">
            <p className="text-sm font-medium text-foreground">当前项目还没有素材</p>
            <p className="mt-2 max-w-xs text-xs leading-5 text-muted-foreground">
              {canManageMaterials
                ? "点击右上角的加号，把视频或图片导入到当前项目。"
                : "当前不能导入素材。"}
            </p>
          </div>
        ) : (
        <div className="p-2">
          {searchMode === "outline" && (
            <>
              <div className="mb-3 rounded-lg border border-border bg-background p-3">
                <p className="text-sm font-medium text-foreground">
                  {projectName ? `${projectName} 项目脚本` : "当前未选择项目"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {projectName
                    ? "当前剧情面板绑定到项目级脚本。这里导入的是项目级 SRT 和配套音频，不属于任一素材。"
                    : "请先选择一个项目，再在这里导入项目级 SRT 和音频。"}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className={cn(
                      "justify-between",
                      hasProjectScript && "border-emerald-500/40 text-emerald-600"
                    )}
                    disabled={!projectName || isImportingSrt}
                    onClick={() => setProjectScriptDialogOpen(true)}
                  >
                    <span className="flex items-center gap-2">
                      <Captions
                        className={cn(
                          "h-4 w-4",
                          hasProjectScript && "text-emerald-600"
                        )}
                      />
                      <span>导入 SRT</span>
                    </span>
                    <span
                      className={cn(
                        "text-xs",
                        hasProjectScript
                          ? "text-emerald-600"
                          : "text-muted-foreground"
                      )}
                    >
                      {isImportingSrt ? "导入中..." : hasProjectScript ? "已导入" : ""}
                    </span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className={cn(
                      "justify-between",
                      projectScriptAudio && "border-emerald-500/40 text-emerald-600"
                    )}
                    disabled={!projectName || isImportingProjectAudio}
                    onClick={() => audioInputRef.current?.click()}
                  >
                    <span className="flex items-center gap-2">
                      <Music4
                        className={cn(
                          "h-4 w-4",
                          projectScriptAudio && "text-emerald-600"
                        )}
                      />
                      <span>导入音频</span>
                    </span>
                    <span
                      className={cn(
                        "text-xs",
                        projectScriptAudio ? "text-emerald-600" : "text-muted-foreground"
                      )}
                    >
                      {isImportingProjectAudio ? "导入中..." : projectScriptAudio ? "已导入" : ""}
                    </span>
                  </Button>
                </div>
                <div className="mt-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-between"
                    disabled={
                      !projectName ||
                      !onCombineProjectScriptItems ||
                      !canCombineSelectedScriptItems ||
                      isCombiningProjectScript
                    }
                    onClick={async () => {
                      if (!onCombineProjectScriptItems || !canCombineSelectedScriptItems) {
                        return;
                      }

                      setIsCombiningProjectScript(true);
                      try {
                        await onCombineProjectScriptItems({
                          itemIds: selectedScriptItems.map((item) => item.id),
                        });
                        setSelectedScriptItemIds([]);
                      } catch (error) {
                        console.error("组合项目文案失败:", error);
                      } finally {
                        setIsCombiningProjectScript(false);
                      }
                    }}
                  >
                    <span className="flex items-center gap-2">
                      <Link2 className="h-4 w-4" />
                      <span>组合选中文案</span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {isCombiningProjectScript
                        ? "组合中..."
                        : canCombineSelectedScriptItems
                          ? `已选 ${selectedScriptItems.length} 条`
                          : "需选连续多条"}
                    </span>
                  </Button>
                </div>
                <div className="mt-3 flex items-center justify-between rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
                  <div>
                    <p className="text-xs font-medium text-foreground">播放时关闭视频原声</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      打开后只保留导入音频，关闭后视频原声会一同播放。
                    </p>
                  </div>
                  <Switch
                    checked={muteVideoDuringScriptPlayback}
                    onCheckedChange={onMuteVideoDuringScriptPlaybackChange}
                    aria-label="播放时关闭视频原声"
                  />
                </div>
                <input
                  ref={srtInputRef}
                  type="file"
                  accept=".srt,.txt,text/plain"
                  className="hidden"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file || !projectName || !onUpdateProjectScript) {
                      event.target.value = "";
                      return;
                    }

                    setIsImportingSrt(true);

                    try {
                      const text = await file.text();
                      setProjectScriptDraft(text);
                    } catch (error) {
                      console.error("导入 SRT 失败:", error);
                    } finally {
                      setIsImportingSrt(false);
                      event.target.value = "";
                    }
                  }}
                />
                <input
                  ref={audioInputRef}
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file || !projectName || !onUploadProjectAudio) {
                      event.target.value = "";
                      return;
                    }

                    setIsImportingProjectAudio(true);

                    try {
                      await onUploadProjectAudio(file);
                    } catch (error) {
                      console.error("导入项目音频失败:", error);
                    } finally {
                      setIsImportingProjectAudio(false);
                      event.target.value = "";
                    }
                  }}
                />
              </div>
            </>
          )}
          {searchMode === "outline" ? (
            !projectName ? (
              <div className="flex min-h-52 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-6 text-center">
                <p className="text-sm font-medium text-foreground">当前未选择项目</p>
                <p className="mt-2 max-w-xs text-xs leading-5 text-muted-foreground">
                  先选择一个项目，再到这里导入项目级 SRT 和音频。
                </p>
              </div>
            ) : scriptLineItems.length === 0 ? (
              <div className="flex min-h-52 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-6 text-center">
                <p className="text-sm font-medium text-foreground">当前还没有 SRT 条目</p>
                <p className="mt-2 max-w-xs text-xs leading-5 text-muted-foreground">
                  导入 SRT 文件或直接输入 SRT 内容后，这里会按字幕条目展示列表。
                </p>
              </div>
            ) : (
              scriptLineItems.map((item, index) => (
                <div
                  key={item.id}
                  ref={
                    activeProjectScriptItemId === item.id
                      ? activeScriptItemElementRef
                      : undefined
                  }
                  role={scriptItemMatchState[item.id]?.status === "matched" ? "button" : undefined}
                  tabIndex={scriptItemMatchState[item.id]?.status === "matched" ? 0 : undefined}
                  onClick={() => {
                    onActivateProjectScriptItem?.(item.id);
                    const matchedState = scriptItemMatchState[item.id];
                    if (matchedState?.status !== "matched" || !matchedState.assetId) {
                      return;
                    }

                    onLocateProjectScriptItem?.({
                      itemId: item.id,
                      assetId: matchedState.assetId,
                      startSeconds: matchedState.startSeconds,
                    });
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") {
                      return;
                    }

                    const matchedState = scriptItemMatchState[item.id];
                    if (matchedState?.status !== "matched" || !matchedState.assetId) {
                      onActivateProjectScriptItem?.(item.id);
                      return;
                    }

                    event.preventDefault();
                    onActivateProjectScriptItem?.(item.id);
                    onLocateProjectScriptItem?.({
                      itemId: item.id,
                      assetId: matchedState.assetId,
                      startSeconds: matchedState.startSeconds,
                    });
                  }}
                  onMouseEnter={() => {
                    const matchedState = scriptItemMatchState[item.id];
                    if (matchedState?.status !== "matched" || !matchedState.assetId) {
                      return;
                    }

                    onPrefetchProjectScriptItem?.({
                      assetId: matchedState.assetId,
                      startSeconds: matchedState.startSeconds,
                    });
                  }}
                  onFocus={() => {
                    const matchedState = scriptItemMatchState[item.id];
                    if (matchedState?.status !== "matched" || !matchedState.assetId) {
                      return;
                    }

                    onPrefetchProjectScriptItem?.({
                      assetId: matchedState.assetId,
                      startSeconds: matchedState.startSeconds,
                    });
                  }}
                  className={cn(
                    "mb-2 rounded-lg border border-border bg-background p-3",
                    activeProjectScriptItemId === item.id &&
                      "border-primary/50 bg-primary/5",
                    selectedScriptItemIds.includes(item.id) &&
                      "border-sky-500/50 bg-sky-500/5",
                    scriptItemMatchState[item.id]?.status === "matched" &&
                      "cursor-pointer transition-colors hover:border-primary/40 hover:bg-primary/5"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      aria-label={`选择第 ${index + 1} 条文案`}
                      onClick={(event) => {
                        event.stopPropagation();
                        handleToggleScriptItemSelection(item.id);
                      }}
                      className={cn(
                        "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors",
                        selectedScriptItemIds.includes(item.id)
                          ? "border-sky-500 bg-sky-500 text-white"
                          : "border-border bg-background hover:bg-secondary"
                      )}
                    >
                      <Check className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      disabled={!projectAudioSrc}
                      onClick={(event) => {
                        event.stopPropagation();
                        onActivateProjectScriptItem?.(item.id);
                        if (!projectAudioSrc) {
                          return;
                        }

                        const player =
                          projectScriptAudioPlayerRef.current ?? new Audio();
                        projectScriptAudioPlayerRef.current = player;

                        if (playingScriptItemId === item.id) {
                          player.pause();
                          setPlayingScriptItemId(null);
                          return;
                        }

                        if (pauseTimerRef.current !== null) {
                          window.clearTimeout(pauseTimerRef.current);
                          pauseTimerRef.current = null;
                        }

                        const startPlayback = () => {
                          player.currentTime = item.startSeconds;
                          void player.play();
                          setPlayingScriptItemId(item.id);
                          onPlayProjectScriptSegment?.({
                            itemId: item.id,
                            videoAssetId: scriptItemMatchState[item.id]?.assetId ?? null,
                            audioStartSeconds: item.startSeconds,
                            videoStartSeconds:
                              scriptItemMatchState[item.id]?.startSeconds ?? item.startSeconds,
                            audioEndSeconds: item.endSeconds,
                            durationSeconds: item.durationSeconds,
                          });

                          if (item.endSeconds !== null && item.endSeconds > item.startSeconds) {
                            pauseTimerRef.current = window.setTimeout(() => {
                              player.pause();
                              setPlayingScriptItemId(null);
                            }, (item.endSeconds - item.startSeconds) * 1000);
                          }
                        };

                        if (player.src !== projectAudioSrc) {
                          player.src = projectAudioSrc;
                          player.load();
                          player.onloadedmetadata = () => {
                            startPlayback();
                            player.onloadedmetadata = null;
                          };
                          player.onerror = () => {
                            console.error("项目音频加载失败:", projectAudioSrc);
                            player.onerror = null;
                          };
                          return;
                        }

                        startPlayback();
                      }}
                      className={cn(
                        "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors",
                        projectAudioSrc
                          ? "border-border bg-background hover:bg-secondary"
                          : "border-border/60 bg-muted/30 text-muted-foreground"
                      )}
                    >
                      {playingScriptItemId === item.id ? (
                        <Pause className="h-4 w-4" />
                      ) : (
                        <Play className="h-4 w-4" fill="currentColor" />
                      )}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-3">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                          {index + 1}
                        </span>
                        <span className="text-xs text-muted-foreground">{item.timeline}</span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-card-foreground">{item.content}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          disabled={scriptItemMatchState[item.id]?.status === "matching"}
                          onClick={async (event) => {
                            event.stopPropagation();
                            onActivateProjectScriptItem?.(item.id);
                            if (!onMatchProjectScriptItem) {
                              return;
                            }

                            setScriptItemMatchState((previous) => ({
                              ...previous,
                              [item.id]: {
                                ...(previous[item.id] ?? {
                                  assetId: "",
                                  assetTitle: "",
                                  startSeconds: item.startSeconds,
                                }),
                                status: "matching",
                                message: "正在匹配画面...",
                              },
                            }));

                            const matchedResult = await onMatchProjectScriptItem({
                              id: item.id,
                              content: item.content,
                            });

                            if (!matchedResult) {
                              setScriptItemMatchState((previous) => ({
                                ...previous,
                                [item.id]: {
                                  ...(previous[item.id] ?? {
                                    assetId: "",
                                    assetTitle: "",
                                    startSeconds: item.startSeconds,
                                  }),
                                  status: "error",
                                  message: "没有找到合适的画面",
                                },
                              }));
                              return;
                            }

                            setScriptItemMatchState((previous) => ({
                              ...previous,
                              [item.id]: {
                                assetId: matchedResult.assetId,
                                assetTitle: matchedResult.assetTitle,
                                startSeconds: matchedResult.startSeconds,
                                status: "matched",
                                message: `已定位到 ${matchedResult.assetTitle} · ${formatSecondsToTimecode(
                                  matchedResult.startSeconds
                                )}`,
                              },
                            }));
                          }}
                        >
                          {scriptItemMatchState[item.id]?.status === "matching" ? (
                            <LoaderCircle className="mr-1 h-3.5 w-3.5 animate-spin" />
                          ) : null}
                          匹配画面
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          onClick={(event) => {
                            event.stopPropagation();
                            onActivateProjectScriptItem?.(item.id);
                            const offsetSeconds = -(item.durationSeconds > 0 ? item.durationSeconds : 5);
                            const matchedState = scriptItemMatchState[item.id];
                            const nextMatch = onOffsetProjectScriptWindow?.({
                              itemId: item.id,
                              offsetSeconds,
                              anchorSeconds: matchedState?.startSeconds ?? item.startSeconds,
                            });

                            if (!nextMatch) {
                              return;
                            }

                            setScriptItemMatchState((previous) => ({
                              ...previous,
                              [item.id]: {
                                assetId: nextMatch.assetId,
                                assetTitle: nextMatch.assetTitle,
                                startSeconds: nextMatch.startSeconds,
                                status: "matched",
                                message: `已定位到 ${nextMatch.assetTitle} · ${formatSecondsToTimecode(
                                  nextMatch.startSeconds
                                )}`,
                              },
                            }));
                          }}
                        >
                          向前匹配
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          onClick={(event) => {
                            event.stopPropagation();
                            onActivateProjectScriptItem?.(item.id);
                            const offsetSeconds = item.durationSeconds > 0 ? item.durationSeconds : 5;
                            const matchedState = scriptItemMatchState[item.id];
                            const nextMatch = onOffsetProjectScriptWindow?.({
                              itemId: item.id,
                              offsetSeconds,
                              anchorSeconds: matchedState?.startSeconds ?? item.startSeconds,
                            });

                            if (!nextMatch) {
                              return;
                            }

                            setScriptItemMatchState((previous) => ({
                              ...previous,
                              [item.id]: {
                                assetId: nextMatch.assetId,
                                assetTitle: nextMatch.assetTitle,
                                startSeconds: nextMatch.startSeconds,
                                status: "matched",
                                message: `已定位到 ${nextMatch.assetTitle} · ${formatSecondsToTimecode(
                                  nextMatch.startSeconds
                                )}`,
                              },
                            }));
                          }}
                        >
                          向后匹配
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          disabled={!projectAudioSrc || item.durationSeconds <= 0}
                          onClick={async (event) => {
                            event.stopPropagation();
                            onActivateProjectScriptItem?.(item.id);
                            await onCreateProjectScriptClip?.({
                              scriptItemId: item.id,
                              scriptContent: item.content,
                              content: item.content,
                              audioStartSeconds: item.startSeconds,
                              durationSeconds: item.durationSeconds,
                            });
                          }}
                        >
                          生成片段
                        </Button>
                      </div>
                      {scriptItemMatchState[item.id]?.message ? (
                        <div
                          className={cn(
                            "mt-2 inline-flex rounded-full px-2.5 py-1 text-[11px]",
                            scriptItemMatchState[item.id]?.status === "error"
                              ? "bg-destructive/10 text-destructive"
                              : scriptItemMatchState[item.id]?.status === "matching"
                                ? "bg-muted text-muted-foreground"
                                : "bg-emerald-500/10 text-emerald-700"
                          )}
                        >
                          {scriptItemMatchState[item.id]?.message}
                        </div>
                      ) : null}
                      {!projectAudioSrc ? (
                        <p className="mt-1 text-xs text-muted-foreground">请先导入项目音频后再播放。</p>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))
            )
          ) : filteredItems.length === 0 ? (
            <div className="flex min-h-52 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-6 text-center">
              <p className="text-sm font-medium text-foreground">没有匹配的素材</p>
              <p className="mt-2 max-w-xs text-xs leading-5 text-muted-foreground">
                试试修改关键词，或者切到“剧情”模式管理脚本和字幕条目。
              </p>
            </div>
          ) : filteredItems.map((item) => {
            const hasSynopsis = Boolean(item.synopsis?.trim());
            const hasSrt = Boolean(item.srtContent?.trim());
            const hasOutline = Boolean(item.storyOutline?.length);
            const isExtracting = item.outlineExtractionStatus === "loading";
            const isDeleting = isDeletingMaterialId === item.id;
            const canExtractOutline =
              canUseOutlineBasic &&
              hasSynopsis &&
              hasSrt &&
              !isExtracting &&
              !isDeleting;

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
              {canManageMaterials || canUseOutlineBasic ? (
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
                    {canManageMaterials ? (
                      <>
                        <DropdownMenuItem onClick={(e) => handleOpenDialog("synopsis", item.id, e as unknown as React.MouseEvent)}>
                          <FileText className="mr-2 h-4 w-4" />
                          剧情简介
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={(e) => handleOpenDialog("srt", item.id, e as unknown as React.MouseEvent)}>
                          <FileUp className="mr-2 h-4 w-4" />
                          导入 SRT
                        </DropdownMenuItem>
                      </>
                    ) : null}
                    {canUseOutlineBasic ? (
                      <DropdownMenuItem
                        disabled={!canExtractOutline}
                        onClick={(e) =>
                          handleExtractOutline(item.id, e as unknown as React.MouseEvent)
                        }
                      >
                        <ListTree className="mr-2 h-4 w-4" />
                        {isExtracting ? "提取中..." : "提取大纲"}
                      </DropdownMenuItem>
                    ) : null}
                    {canManageMaterials ? (
                      <DropdownMenuItem
                        disabled={isDeleting}
                        className="text-destructive focus:text-destructive"
                        onClick={(e) => handleDelete(item.id, e as unknown as React.MouseEvent)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        {isDeleting ? "删除中..." : "删除素材"}
                      </DropdownMenuItem>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
              </div>
            );
          })}
        </div>
        )}
      </ScrollArea>

      {/* Footer Stats */}
      <div className="border-t border-border p-3">
        <p className="text-xs text-muted-foreground">
          {searchMode === "materials"
            ? `共 ${filteredItems.length} / ${items.length} 个素材`
            : `共 ${scriptLineItems.length} 条 SRT 条目`}
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
              <Button variant="outline" className="w-full" disabled>
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

      <Dialog open={projectScriptDialogOpen} onOpenChange={setProjectScriptDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>导入 SRT</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 rounded-lg bg-secondary p-3">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {projectName ? `${projectName} 项目 SRT` : "当前未选择项目"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  可直接粘贴 SRT 内容，或导入 SRT 文件。保存后会按字幕条目解析成列表。
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={!projectName || isImportingSrt}
                onClick={() => srtInputRef.current?.click()}
              >
                <Captions className="h-4 w-4" />
                {isImportingSrt ? "导入中..." : "选择文件"}
              </Button>
            </div>

            <div className="space-y-2">
              <Label htmlFor="project-script-text">SRT 内容</Label>
              <Textarea
                id="project-script-text"
                value={projectScriptDraft}
                onChange={(event) => setProjectScriptDraft(event.target.value)}
                placeholder="粘贴或输入 SRT 内容，保存后会按字幕时间和文本解析。"
                rows={12}
                className="h-72 resize-none"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setProjectScriptDraft(projectScriptSrtContent ?? "");
                setProjectScriptDialogOpen(false);
              }}
              disabled={isSavingProjectScript}
            >
              取消
            </Button>
            <Button
              onClick={async () => {
                if (!projectName || !onUpdateProjectScript) {
                  return;
                }

                setIsSavingProjectScript(true);
                try {
                  await onUpdateProjectScript({
                    scriptSrtContent: projectScriptDraft,
                  });
                  setProjectScriptDialogOpen(false);
                } catch (error) {
                  console.error("保存项目 SRT 失败:", error);
                } finally {
                  setIsSavingProjectScript(false);
                }
              }}
              disabled={!projectName || isSavingProjectScript}
            >
              {isSavingProjectScript ? "保存中..." : "保存并解析"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
