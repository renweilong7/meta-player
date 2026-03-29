import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { extname } from "node:path";
import { NextResponse } from "next/server";
import { getMaterialFileDescriptor } from "@/lib/persistence/repository";

export const runtime = "nodejs";

const MIME_BY_EXTENSION: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".m4v": "video/x-m4v",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
};

const getMimeType = (filename: string, mediaType: "video" | "image") => {
  const extension = extname(filename).toLowerCase();
  const resolvedMimeType = MIME_BY_EXTENSION[extension];

  if (resolvedMimeType) {
    return resolvedMimeType;
  }

  return mediaType === "video" ? "video/mp4" : "application/octet-stream";
};

/**
 * 媒体文件通过同源路由流式返回。
 *
 * 为什么必须自己提供文件流：
 * 1. Next 页面运行在 `http://localhost`，直接读 `file://` 本地文件不稳定。
 * 2. 视频播放需要 `Range` 支持，否则拖动和分段加载都会出问题。
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const descriptor = getMaterialFileDescriptor(id);

  if (!descriptor) {
    return NextResponse.json({ message: "素材文件不存在。" }, { status: 404 });
  }

  const { absolutePath, mediaType, originalFilename } = descriptor;
  const stats = statSync(absolutePath);
  const totalSize = stats.size;
  const mimeType = getMimeType(originalFilename, mediaType);
  const range = request.headers.get("range");

  if (!range) {
    const stream = createReadStream(absolutePath);

    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Content-Length": totalSize.toString(),
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
      },
    });
  }

  const matchedRange = /bytes=(\d*)-(\d*)/.exec(range);
  if (!matchedRange) {
    return new Response("Invalid Range", { status: 416 });
  }

  const start = matchedRange[1] ? Number(matchedRange[1]) : 0;
  const end = matchedRange[2] ? Number(matchedRange[2]) : totalSize - 1;

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end >= totalSize ||
    start > end
  ) {
    return new Response("Range Not Satisfiable", {
      status: 416,
      headers: {
        "Content-Range": `bytes */${totalSize}`,
      },
    });
  }

  const stream = createReadStream(absolutePath, { start, end });
  const chunkSize = end - start + 1;

  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 206,
    headers: {
      "Content-Type": mimeType,
      "Content-Length": chunkSize.toString(),
      "Content-Range": `bytes ${start}-${end}/${totalSize}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    },
  });
}
