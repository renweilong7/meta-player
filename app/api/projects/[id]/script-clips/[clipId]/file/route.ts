import { statSync } from "node:fs";
import { extname } from "node:path";
import { NextResponse } from "next/server";
import { withRouteLogging } from "@/lib/observability/api-route";
import { getProjectById } from "@/lib/persistence/repository";
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
  context: { params: Promise<{ id: string; clipId: string }> }
) => {
  const { id, clipId } = await context.params;
  const project = getProjectById(id);
  const clip = project?.scriptClips.find((item) => item.id === clipId);

  if (!clip) {
    return NextResponse.json({ message: "片段不存在。" }, { status: 404 });
  }

  const stats = statSync(clip.absolutePath);
  const range = request.headers.get("range");
  const mimeType = getMimeType(clip.absolutePath);

  if (!range) {
    return createFileStreamResponse({
      absolutePath: clip.absolutePath,
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
    absolutePath: clip.absolutePath,
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
  { route: "/api/projects/[id]/script-clips/[clipId]/file" },
  getHandler
);
