import { statSync } from "node:fs";
import { extname } from "node:path";
import { NextResponse } from "next/server";
import { withRouteLogging } from "@/lib/observability/api-route";
import { getProjectById } from "@/lib/persistence/repository";
import { createFileStreamResponse } from "@/lib/runtime/node-stream-response";

export const runtime = "nodejs";

const MIME_BY_EXTENSION: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".flac": "audio/flac",
  ".aiff": "audio/aiff",
  ".aif": "audio/aiff",
};

const getMimeType = (filename: string) => {
  const extension = extname(filename).toLowerCase();
  return MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
};

const getHandler = async (
  request: Request,
  context: { params: Promise<{ id: string }> }
) => {
  const { id } = await context.params;
  const project = getProjectById(id);

  if (!project?.scriptAudio?.absolutePath) {
    return NextResponse.json({ message: "项目音频不存在。" }, { status: 404 });
  }

  const absolutePath = project.scriptAudio.absolutePath;
  const mimeType = getMimeType(project.scriptAudio.filename);
  const stats = statSync(absolutePath);
  const totalSize = stats.size;
  const range = request.headers.get("range");

  if (!range) {
    return createFileStreamResponse({
      absolutePath,
      signal: request.signal,
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

  const chunkSize = end - start + 1;

  return createFileStreamResponse({
    absolutePath,
    start,
    end,
    status: 206,
    signal: request.signal,
    headers: {
      "Content-Type": mimeType,
      "Content-Length": chunkSize.toString(),
      "Content-Range": `bytes ${start}-${end}/${totalSize}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    },
  });
};

export const GET = withRouteLogging(
  { route: "/api/projects/[id]/audio" },
  getHandler
);
