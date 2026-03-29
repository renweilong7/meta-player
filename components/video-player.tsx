"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  VideoCanvasPlayer,
  type VideoCanvasPlayerHandle,
} from "@renweilong/electron-ffmpeg-player";
import { Play, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";

interface VideoPlayerProps {
  title?: string;
  src?: string;
  mediaType?: "video" | "image";
  highlight?: Record<number, string>;
  onTimeChange?: (time: number, duration: number) => void;
}

export interface VideoPlayerHandle {
  seekTo: (time: number) => void;
  pause: () => void;
  getCurrentTime: () => number;
}

export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(function VideoPlayer(
  { title, src, mediaType = "video", highlight, onTimeChange },
  ref
) {
  const playerRef = useRef<VideoCanvasPlayerHandle>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [surfaceSize, setSurfaceSize] = useState({ width: 0, height: 0 });
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

  useImperativeHandle(
    ref,
    () => ({
      seekTo: (time: number) => {
        playerRef.current?.seekTo(time);
      },
      pause: () => {
        playerRef.current?.pause();
      },
      getCurrentTime: () => playerRef.current?.getCurrentTime() ?? 0,
    }),
    []
  );

  return (
    <div className="relative flex h-full flex-col bg-background">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium text-foreground">
          {title || "播放器"}
        </h2>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
          <Settings className="h-4 w-4" />
        </Button>
      </div>

      <div ref={surfaceRef} className="min-h-0 flex-1 overflow-hidden bg-muted/30 p-4">
        {canPlayVideo ? (
          <div className="flex h-full w-full items-center justify-center overflow-hidden">
            <div
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
                highlight={highlight ?? defaultHighlight}
                onTimeChange={onTimeChange}
                className="w-full"
              />
            </div>
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
