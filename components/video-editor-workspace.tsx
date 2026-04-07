"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Clapperboard, Download, GripHorizontal, Pencil, Play, Rows3, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PersistedMaterialMarker, PersistedProjectClip } from "@/lib/persistence/types";
import {
  groupProjectClipsByScriptItem,
  resolveSelectedProjectClip,
} from "@/lib/project-clips/sequence";

interface VideoEditorWorkspaceProps {
  mediaTitle?: string;
  projectName?: string;
  activeProjectClipId?: string | null;
  activeProjectScriptItemId?: string | null;
  projectScriptItemOrder?: string[];
  disabled?: boolean;
  disabledReason?: string | null;
  pendingMarkerTime?: number | null;
  markers?: PersistedMaterialMarker[];
  projectClips?: PersistedProjectClip[];
  selectedClipVersionByItemId?: Record<string, string>;
  onCreateMarker?: (content: string) => Promise<void>;
  onUpdateMarker?: (markerId: string, content: string) => Promise<void>;
  onDeleteMarker?: (markerId: string) => Promise<void>;
  onMarkStart?: () => void;
  onMarkEditStart?: (time: number) => void;
  onAdjustMarkerTime?: (nextTime: number) => void;
  onSeekToTime?: (time: number) => void;
  onPreviewProjectClip?: (clip: PersistedProjectClip) => void;
  onSelectProjectClipVersion?: (scriptItemId: string, clipId: string) => void;
  onPreviewProjectClipCompilation?: () => void;
  onExportProjectClipCompilation?: () => void;
  isPreviewingProjectCompilation?: boolean;
  isCompilingProjectClips?: boolean;
  isExportingProjectClips?: boolean;
  lastExportedCompilationPath?: string | null;
  onOpenExportDirectory?: () => void;
}

const formatSeconds = (value: number) => {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  const minutes = Math.floor(safeValue / 60);
  const seconds = safeValue % 60;

  return `${String(minutes).padStart(2, "0")}:${seconds.toFixed(2).padStart(5, "0")}`;
};

export function VideoEditorWorkspace({
  mediaTitle,
  projectName,
  activeProjectClipId = null,
  activeProjectScriptItemId = null,
  projectScriptItemOrder = [],
  disabled = false,
  disabledReason = null,
  pendingMarkerTime = null,
  markers = [],
  projectClips = [],
  selectedClipVersionByItemId = {},
  onCreateMarker,
  onUpdateMarker,
  onDeleteMarker,
  onMarkStart,
  onMarkEditStart,
  onAdjustMarkerTime,
  onSeekToTime,
  onPreviewProjectClip,
  onSelectProjectClipVersion,
  onPreviewProjectClipCompilation,
  onExportProjectClipCompilation,
  isPreviewingProjectCompilation = false,
  isCompilingProjectClips = false,
  isExportingProjectClips = false,
  lastExportedCompilationPath = null,
  onOpenExportDirectory,
}: VideoEditorWorkspaceProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [markerContent, setMarkerContent] = useState("");
  const [isSavingMarker, setIsSavingMarker] = useState(false);
  const [editingMarkerId, setEditingMarkerId] = useState<string | null>(null);
  const [dialogPosition, setDialogPosition] = useState({ x: 0, y: 0 });
  const activeClipGroupElementRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  useEffect(() => {
    if (!isDialogOpen) {
      setDialogPosition({ x: 0, y: 0 });
      setEditingMarkerId(null);
    }
  }, [isDialogOpen]);

  const groupedProjectClips = useMemo(
    () => groupProjectClipsByScriptItem(projectClips, projectScriptItemOrder),
    [projectClips, projectScriptItemOrder]
  );

  useEffect(() => {
    if (!activeProjectScriptItemId) {
      return;
    }

    activeClipGroupElementRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [activeProjectScriptItemId]);

  const handleOpenCreateDialog = () => {
    if (disabled) {
      return;
    }

    onMarkStart?.();
    setEditingMarkerId(null);
    setMarkerContent("");
    setIsDialogOpen(true);
  };

  const handleOpenEditDialog = (marker: PersistedMaterialMarker) => {
    onMarkEditStart?.(marker.time);
    setEditingMarkerId(marker.id);
    setMarkerContent(marker.content);
    setIsDialogOpen(true);
  };

  const handleSaveMarker = async () => {
    if (!markerContent.trim()) {
      return;
    }

    setIsSavingMarker(true);

    try {
      if (editingMarkerId) {
        await onUpdateMarker?.(editingMarkerId, markerContent.trim());
      } else {
        await onCreateMarker?.(markerContent.trim());
      }

      setIsDialogOpen(false);
      setMarkerContent("");
    } finally {
      setIsSavingMarker(false);
    }
  };

  const handleAdjustMarkerTime = (delta: number) => {
    if (pendingMarkerTime === null) {
      return;
    }

    onAdjustMarkerTime?.(Math.max(0, pendingMarkerTime + delta));
  };

  const handleDragStart = (event: React.PointerEvent<HTMLDivElement>) => {
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: dialogPosition.x,
      originY: dialogPosition.y,
    };

    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleDragMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    setDialogPosition({
      x: dragState.originX + event.clientX - dragState.startX,
      y: dragState.originY + event.clientY - dragState.startY,
    });
  };

  const handleDragEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current?.pointerId !== event.pointerId) {
      return;
    }

    dragStateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  if (!mediaTitle && !projectName) {
    return (
      <div className="flex h-full items-center justify-center bg-card px-6">
        <div className="max-w-sm text-center">
          <Clapperboard className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-4 text-sm font-medium text-foreground">请选择一个素材开始编辑</p>
          <p className="mt-2 text-xs leading-6 text-muted-foreground">
            当前仅保留布局骨架。后续会在这里接入时间线、片段操作和视频处理能力。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col border-t border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">编辑工作区</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {disabledReason
              ? `${mediaTitle} · ${disabledReason}`
              : `${mediaTitle ?? projectName ?? "当前项目"} · 当前已启用素材级标记与项目片段产物管理。`}
          </p>
        </div>
        <Button size="sm" onClick={handleOpenCreateDialog} disabled={disabled}>
          标记
        </Button>
      </div>

      <div className="min-h-0 flex-1 p-4">
        <div className="grid h-full min-h-0 gap-4 lg:grid-cols-2">
          <div className="flex min-h-0 flex-col rounded-xl border border-border bg-background/70">
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-medium text-foreground">标记管理</p>
            <p className="mt-1 text-xs text-muted-foreground">
              点击列表项跳转到对应时间，编辑与删除都在这里完成。
            </p>
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-3">
            {markers.length === 0 ? (
              <div className="flex h-full min-h-32 items-center justify-center rounded-lg border border-dashed border-border px-6 text-center">
                <div>
                  <p className="text-sm font-medium text-foreground">还没有标记</p>
                  <p className="mt-2 text-xs leading-6 text-muted-foreground">
                    {disabledReason
                      ? disabledReason
                      : "点击右上角“标记”按钮，为当前素材记录关键时间点和说明。"}
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {markers.map((marker) => (
                  <div
                    key={marker.id}
                    className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-3"
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => onSeekToTime?.(marker.time)}
                    >
                      <span className="text-xs font-medium text-primary">
                        {formatSeconds(marker.time)}
                      </span>
                      <p className="mt-1 truncate text-sm text-foreground">
                        {marker.content}
                      </p>
                    </button>

                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        disabled={disabled}
                        onClick={() => handleOpenEditDialog(marker)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        disabled={disabled}
                        onClick={() => void onDeleteMarker?.(marker.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
          <div className="flex min-h-0 flex-col rounded-xl border border-border bg-background/70">
            <div className="border-b border-border px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-foreground">项目片段</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    这里展示和文案条目关联的最终片段产物，不会进入素材库。
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={groupedProjectClips.length === 0 || isCompilingProjectClips}
                    className={isPreviewingProjectCompilation ? "border-primary/40 text-primary" : ""}
                    onClick={() => onPreviewProjectClipCompilation?.()}
                  >
                    <Rows3 className="mr-1 h-3.5 w-3.5" />
                    {isCompilingProjectClips
                      ? "合成中..."
                      : isPreviewingProjectCompilation
                        ? "预览中"
                        : "合成预览"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={groupedProjectClips.length === 0 || isExportingProjectClips}
                    onClick={() => onExportProjectClipCompilation?.()}
                  >
                    <Download className="mr-1 h-3.5 w-3.5" />
                    {isExportingProjectClips ? "导出中..." : "导出成片"}
                  </Button>
                </div>
              </div>
              {lastExportedCompilationPath ? (
                <div className="mt-3 rounded-lg border border-border bg-background/80 px-3 py-2">
                  <p className="text-[11px] text-muted-foreground">最近导出</p>
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                    <p className="min-w-0 flex-1 truncate text-xs text-foreground">
                      {lastExportedCompilationPath}
                    </p>
                    <Button variant="ghost" size="sm" onClick={onOpenExportDirectory}>
                      打开目录
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-3">
              {groupedProjectClips.length === 0 ? (
                <div className="flex h-full min-h-32 items-center justify-center rounded-lg border border-dashed border-border px-6 text-center">
                  <div>
                    <p className="text-sm font-medium text-foreground">还没有项目片段</p>
                    <p className="mt-2 text-xs leading-6 text-muted-foreground">
                      在左侧文案条目点击“生成片段”后，会直接出现在这里。
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {groupedProjectClips.map((group) => {
                    const selectedClip = resolveSelectedProjectClip(
                      group,
                      selectedClipVersionByItemId
                    );

                    if (!selectedClip) {
                      return null;
                    }

                    const selectedVersionIndex = group.versions.findIndex(
                      (clip) => clip.id === selectedClip.id
                    );

                    const isPreviewingSelectedVersion = selectedClip.id === activeProjectClipId;
                    const isActiveScriptItem =
                      group.scriptItemId === activeProjectScriptItemId;

                    return (
                    <div
                      key={group.scriptItemId}
                      ref={
                        isPreviewingSelectedVersion || isActiveScriptItem
                          ? activeClipGroupElementRef
                          : undefined
                      }
                      className={
                        "rounded-lg border bg-card px-3 py-3 transition-colors " +
                        (isPreviewingSelectedVersion || isActiveScriptItem
                          ? "border-primary/50 bg-primary/5"
                          : "border-border")
                      }
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">
                            {selectedClip.label}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            关联文案：{group.scriptContent}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            来源：{selectedClip.sourceAssetTitle} · {formatSeconds(selectedClip.sourceStartSeconds)} · 时长 {formatSeconds(selectedClip.durationSeconds)}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Select
                            value={selectedClip.id}
                            onValueChange={(value) =>
                              onSelectProjectClipVersion?.(group.scriptItemId, value)
                            }
                          >
                            <SelectTrigger size="sm" className="w-24">
                              <SelectValue placeholder="版本" />
                            </SelectTrigger>
                            <SelectContent>
                              {group.versions.map((clip, index) => (
                                <SelectItem key={clip.id} value={clip.id}>
                                  {`v${group.versions.length - index}`}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            variant="outline"
                            size="sm"
                            className={
                              "shrink-0 " +
                              (isPreviewingSelectedVersion
                                ? "border-primary/40 text-primary"
                                : "")
                            }
                            onClick={() => onPreviewProjectClip?.(selectedClip)}
                          >
                            <Play className="mr-1 h-3.5 w-3.5" />
                            {isPreviewingSelectedVersion ? "预览中" : "预览"}
                          </Button>
                        </div>
                      </div>
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        当前版本：v{group.versions.length - selectedVersionIndex} · 共 {group.versions.length} 个版本
                      </p>
                    </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent
          className="top-1/2 left-1/2 sm:max-w-md"
          style={{
            transform: `translate(calc(-50% + ${dialogPosition.x}px), calc(-50% + ${dialogPosition.y}px))`,
          }}
        >
          <DialogHeader
            className="cursor-move select-none pr-8"
            onPointerDown={handleDragStart}
            onPointerMove={handleDragMove}
            onPointerUp={handleDragEnd}
            onPointerCancel={handleDragEnd}
          >
            <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
              <GripHorizontal className="h-4 w-4" />
              拖动标题栏移动
            </div>
            <DialogTitle>{editingMarkerId ? "编辑标记" : "新增标记"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <p className="text-xs leading-6 text-muted-foreground">
              保存后会在当前素材时间轴回显高亮点，并延用现有的点击跳转与悬浮提示逻辑。
            </p>
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">标记时间</span>
                <span className="text-sm font-medium text-foreground">
                  {pendingMarkerTime === null ? "--:--.--" : formatSeconds(pendingMarkerTime)}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleAdjustMarkerTime(-1)}
                  disabled={pendingMarkerTime === null}
                >
                  -1 秒
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleAdjustMarkerTime(-0.1)}
                  disabled={pendingMarkerTime === null}
                >
                  -0.1 秒
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleAdjustMarkerTime(0.1)}
                  disabled={pendingMarkerTime === null}
                >
                  +0.1 秒
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleAdjustMarkerTime(1)}
                  disabled={pendingMarkerTime === null}
                >
                  +1 秒
                </Button>
              </div>
            </div>
            <Textarea
              value={markerContent}
              onChange={(event) => setMarkerContent(event.target.value)}
              placeholder="输入标记内容..."
              rows={5}
              className="resize-none"
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDialogOpen(false)}
              disabled={isSavingMarker}
            >
              取消
            </Button>
            <Button
              onClick={handleSaveMarker}
              disabled={isSavingMarker || !markerContent.trim()}
            >
              {isSavingMarker ? "保存中..." : editingMarkerId ? "保存修改" : "保存标记"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
