import { statSync } from "node:fs";
import { NextResponse } from "next/server";
import { withRouteLogging } from "@/lib/observability/api-route";
import { getMaterialMarkerClipFileById } from "@/lib/persistence/repository";
import { createFileStreamResponse } from "@/lib/runtime/node-stream-response";

export const runtime = "nodejs";

const getHandler = async (
  request: Request,
  context: { params: Promise<{ id: string; clipId: string }> }
) => {
  const { id, clipId } = await context.params;
  const descriptor = getMaterialMarkerClipFileById(id, clipId);

  if (!descriptor) {
    return NextResponse.json({ message: "标记片段文件不存在。" }, { status: 404 });
  }

  const stats = statSync(descriptor.absolutePath);
  const totalSize = stats.size;
  const range = request.headers.get("range");

  if (!range) {
    return createFileStreamResponse({
      absolutePath: descriptor.absolutePath,
      signal: request.signal,
      headers: {
        "Content-Type": "video/mp4",
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

  const chunkSize = end - start + 1;

  return createFileStreamResponse({
    absolutePath: descriptor.absolutePath,
    start,
    end,
    status: 206,
    signal: request.signal,
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": chunkSize.toString(),
      "Content-Range": `bytes ${start}-${end}/${totalSize}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    },
  });
};

export const GET = withRouteLogging(
  { route: "/api/materials/[id]/marker-clips/[clipId]/file" },
  getHandler
);
