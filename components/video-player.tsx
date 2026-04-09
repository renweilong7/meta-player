"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  VideoCanvasPlayer,
  type VideoCanvasPlayerHandle,
} from "@renweilong/electron-ffmpeg-player";
import { Play, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CrossAssetSwitchMode } from "@/lib/persistence/types";

const PLAYBACK_RATE_OPTIONS = [
  { value: "0.5", label: "0.5x" },
  { value: "0.75", label: "0.75x" },
  { value: "1", label: "1x" },
  { value: "1.25", label: "1.25x" },
  { value: "1.5", label: "1.5x" },
  { value: "2", label: "2x" },
] as const;

const normalizePlaybackRate = (value: number | undefined) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 1;

interface VideoPlayerProps {
  title?: string;
  src?: string;
  mediaType?: "video" | "image";
  highlight?: Record<number, string>;
  muted?: boolean;
  initialSeekTime?: number;
  pendingStartTime?: number;
  preloadSrc?: string;
  preloadStartTime?: number;
  frameHoldPreviewSrc?: string | null;
  crossAssetSwitchMode?: CrossAssetSwitchMode;
  autoPlay?: boolean;
  playbackRate?: number;
  onPlaybackRateChange?: (rate: number) => void;
  onReady?: () => void;
  onTimeChange?: (time: number, duration: number) => void;
}

export interface VideoPlayerHandle {
  play: () => Promise<void>;
  seekTo: (time: number) => void;
  pause: () => void;
  getCurrentTime: () => number;
  setMuted: (muted: boolean) => void;
  captureCurrentFrame: () => string | null;
}

export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(function VideoPlayer(
  {
    title,
    src,
    mediaType = "video",
    highlight,
    muted = false,
    initialSeekTime,
    pendingStartTime,
    preloadSrc,
    preloadStartTime,
    frameHoldPreviewSrc,
    crossAssetSwitchMode = "frame_hold",
    autoPlay = false,
    playbackRate = 1,
    onPlaybackRateChange,
    onReady,
    onTimeChange,
  },
  ref
) {
  const playerRef = useRef<VideoCanvasPlayerHandle>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const preloadVideoRef = useRef<HTMLVideoElement>(null);
  const preloadTimerRef = useRef<number | null>(null);
  const lastPreloadRequestRef = useRef<{
    src: string;
    startTime: number | null;
  } | null>(null);
  const lastFrameCaptureRef = useRef<{
    src: string;
    capturedAt: number;
    dataUrl: string | null;
  } | null>(null);
  const [surfaceSize, setSurfaceSize] = useState({ width: 0, height: 0 });
  const [showThumbnailRail, setShowThumbnailRail] = useState(false);
  const normalizedPlaybackRate = normalizePlaybackRate(playbackRate);
  const defaultHighlight = useMemo(
    () => ({
      30: "30 秒检查点",
      90: "90 秒检查点",
      180: "3 分钟检查点",
    }),
    []
  );

  const canPlayVideo = Boolean(src) && mediaType === "video";
  const responsiveWidth =
    surfaceSize.width > 0 && surfaceSize.height > 0
      ? Math.min(surfaceSize.width, surfaceSize.height * (16 / 9))
      : 0;

  useEffect(() => {
    const element = surfaceRef.current;
    if (!element) {
      return;
    }

    const observer = new ResizeObserver(([entry]) => {
      setSurfaceSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const videoElement = playerContainerRef.current?.querySelector("video");
    if (!videoElement) {
      return;
    }

    const handleLoadedMetadata = () => {
      onReady?.();
    };

    videoElement.addEventListener("loadedmetadata", handleLoadedMetadata);
    return () => {
      videoElement.removeEventListener("loadedmetadata", handleLoadedMetadata);
    };
  }, [onReady, src]);

  useEffect(() => {
    if (crossAssetSwitchMode !== "preload") {
      return;
    }

    const preloadVideo = preloadVideoRef.current;
    if (!preloadVideo || !preloadSrc) {
      return;
    }

    const normalizedStartTime =
      typeof preloadStartTime === "number" && Number.isFinite(preloadStartTime)
        ? Math.max(preloadStartTime, 0)
        : null;
    const previousRequest = lastPreloadRequestRef.current;
    if (
      previousRequest?.src === preloadSrc &&
      previousRequest.startTime === normalizedStartTime
    ) {
      return;
    }

    lastPreloadRequestRef.current = {
      src: preloadSrc,
      startTime: normalizedStartTime,
    };

    const handleLoadedMetadata = () => {
      if (
        typeof normalizedStartTime === "number" &&
        normalizedStartTime >= 0
      ) {
        try {
          preloadVideo.currentTime = normalizedStartTime;
        } catch {
          // 忽略预加载 seek 失败，保留基础 preload 行为。
        }
      }
    };

    if (preloadTimerRef.current !== null) {
      window.clearTimeout(preloadTimerRef.current);
    }

    preloadTimerRef.current = window.setTimeout(() => {
      preloadVideo.src = preloadSrc;
      preloadVideo.preload = "metadata";
      preloadVideo.load();
    }, 120);

    preloadVideo.addEventListener("loadedmetadata", handleLoadedMetadata, { once: true });
    return () => {
      if (preloadTimerRef.current !== null) {
        window.clearTimeout(preloadTimerRef.current);
        preloadTimerRef.current = null;
      }

      preloadVideo.removeEventListener("loadedmetadata", handleLoadedMetadata);
    };
  }, [crossAssetSwitchMode, preloadSrc, preloadStartTime]);

  useEffect(() => {
    const videoElement = playerContainerRef.current?.querySelector("video");
    if (!videoElement) {
      return;
    }

    videoElement.muted = muted;
    if (muted) {
      videoElement.setAttribute("muted", "");
      return;
    }

    videoElement.removeAttribute("muted");
  }, [muted, src]);

  useImperativeHandle(
    ref,
    () => ({
      play: () => playerRef.current?.play() ?? Promise.resolve(),
      seekTo: (time: number) => {
        playerRef.current?.seekTo(time);
      },
      pause: () => {
        playerRef.current?.pause();
      },
      getCurrentTime: () => playerRef.current?.getCurrentTime() ?? 0,
      setMuted: (nextMuted: boolean) => {
        const videoElement = playerContainerRef.current?.querySelector("video");
        if (!videoElement) {
          return;
        }

        videoElement.muted = nextMuted;
        if (nextMuted) {
          videoElement.setAttribute("muted", "");
          return;
        }

        videoElement.removeAttribute("muted");
      },
      captureCurrentFrame: () => {
        const videoElement = playerContainerRef.current?.querySelector("video");
        if (!videoElement || !videoElement.videoWidth || !videoElement.videoHeight) {
          return null;
        }

        const currentSrc = videoElement.currentSrc || src || "";
        const previousCapture = lastFrameCaptureRef.current;
        if (
          previousCapture &&
          previousCapture.src === currentSrc &&
          performance.now() - previousCapture.capturedAt < 160
        ) {
          return previousCapture.dataUrl;
        }

        const canvas = document.createElement("canvas");
        const maxSnapshotEdge = 960;
        const scale = Math.min(
          1,
          maxSnapshotEdge / Math.max(videoElement.videoWidth, videoElement.videoHeight)
        );
        canvas.width = Math.max(Math.round(videoElement.videoWidth * scale), 1);
        canvas.height = Math.max(Math.round(videoElement.videoHeight * scale), 1);
        const context = canvas.getContext("2d");
        if (!context) {
          return null;
        }

        context.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
        lastFrameCaptureRef.current = {
          src: currentSrc,
          capturedAt: performance.now(),
          dataUrl,
        };
        return dataUrl;
      },
    }),
    [src]
  );

  return (
    <div className="relative flex h-full flex-col bg-background">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium text-foreground">
          {title || "播放器"}
        </h2>
        <div className="flex items-center gap-3">
          <Select
            value={String(normalizedPlaybackRate)}
            onValueChange={(value) => onPlaybackRateChange?.(Number(value))}
          >
            <SelectTrigger className="h-8 w-[92px] text-xs">
              <SelectValue placeholder="倍速" />
            </SelectTrigger>
            <SelectContent>
              {PLAYBACK_RATE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5">
            <span className="text-xs text-muted-foreground">
              Thumbnail Rail（测试功能）
            </span>
            <Switch
              checked={showThumbnailRail}
              onCheckedChange={setShowThumbnailRail}
              aria-label="切换 Thumbnail Rail 测试功能"
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div ref={surfaceRef} className="min-h-0 flex-1 overflow-hidden bg-muted/30 p-4">
        {canPlayVideo ? (
          <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
            <div
              ref={playerContainerRef}
              className="w-full max-w-full"
              style={{
                width: responsiveWidth > 0 ? `${responsiveWidth}px` : "100%",
              }}
            >
              <VideoCanvasPlayer
                ref={playerRef}
                key={src}
                src={src!}
                theme="dark"
                fastSeekStep={5}
                initialSeekTime={initialSeekTime}
                pendingStartTime={pendingStartTime}
                autoPlay={autoPlay}
                muted={muted}
                playbackRate={normalizedPlaybackRate}
                highlight={highlight ?? defaultHighlight}
                showThumbnailRail={showThumbnailRail}
                onTimeChange={onTimeChange}
                className="w-full"
              />
            </div>
            {crossAssetSwitchMode === "frame_hold" && frameHoldPreviewSrc ? (
              <img
                src={frameHoldPreviewSrc}
                alt=""
                className="pointer-events-none absolute inset-4 h-[calc(100%-2rem)] w-[calc(100%-2rem)] object-contain"
              />
            ) : null}
            {crossAssetSwitchMode === "preload" ? (
              <video
                ref={preloadVideoRef}
                className="hidden"
                muted
                playsInline
                preload="auto"
                aria-hidden="true"
              />
            ) : null}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border bg-card/30">
            <div className="text-center">
              <Play className="mx-auto h-16 w-16 text-muted-foreground/30" />
              <p className="mt-4 text-sm text-muted-foreground">
                {mediaType === "image"
                  ? "当前素材不是视频，无法在播放器中预览"
                  : "选择一个视频开始播放"}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
