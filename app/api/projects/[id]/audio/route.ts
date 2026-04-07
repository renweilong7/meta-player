import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { extname } from "node:path";
import { NextResponse } from "next/server";
import { getProjectById } from "@/lib/persistence/repository";

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

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
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
