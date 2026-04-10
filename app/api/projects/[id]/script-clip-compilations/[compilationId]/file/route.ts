import { statSync } from "node:fs";
import { extname } from "node:path";
import { NextResponse } from "next/server";
import { withRouteLogging } from "@/lib/observability/api-route";
import { getProjectClipCompilationFileById } from "@/lib/persistence/repository";
import { createFileStreamResponse } from "@/lib/runtime/node-stream-response";

export const runtime = "nodejs";

const getMimeType = (filename: string) => {
  switch (extname(filename).toLowerCase()) {
    case ".mp4":
      return "video/mp4";
    case ".mov":
      return "video/quicktime";
    case ".webm":
      return "video/webm";
    default:
      return "application/octet-stream";
  }
};

const getHandler = async (
  request: Request,
  context: { params: Promise<{ id: string; compilationId: string }> }
) => {
  const { id, compilationId } = await context.params;
  const descriptor = getProjectClipCompilationFileById(id, compilationId);

  if (!descriptor) {
    return NextResponse.json({ message: "合成视频不存在。" }, { status: 404 });
  }

  const stats = statSync(descriptor.absolutePath);
  const range = request.headers.get("range");
  const mimeType = getMimeType(descriptor.filename);

  if (!range) {
    return createFileStreamResponse({
      absolutePath: descriptor.absolutePath,
      signal: request.signal,
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(stats.size),
        "Accept-Ranges": "bytes",
      },
    });
  }

  const match = /bytes=(\d+)-(\d*)/.exec(range);
  if (!match) {
    return new NextResponse(null, { status: 416 });
  }

  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : stats.size - 1;

  return createFileStreamResponse({
    absolutePath: descriptor.absolutePath,
    start,
    end,
    status: 206,
    signal: request.signal,
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${stats.size}`,
      "Accept-Ranges": "bytes",
    }
  });
};

export const GET = withRouteLogging(
  { route: "/api/projects/[id]/script-clip-compilations/[compilationId]/file" },
  getHandler
);
