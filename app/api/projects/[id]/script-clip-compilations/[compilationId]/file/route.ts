import { createReadStream, statSync } from "node:fs";
import { extname } from "node:path";
import { NextResponse } from "next/server";
import { getProjectClipCompilationFileById } from "@/lib/persistence/repository";

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

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; compilationId: string }> }
) {
  const { id, compilationId } = await context.params;
  const descriptor = getProjectClipCompilationFileById(id, compilationId);

  if (!descriptor) {
    return NextResponse.json({ message: "合成视频不存在。" }, { status: 404 });
  }

  const stats = statSync(descriptor.absolutePath);
  const range = request.headers.get("range");
  const mimeType = getMimeType(descriptor.filename);

  if (!range) {
    return new NextResponse(createReadStream(descriptor.absolutePath) as never, {
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

  return new NextResponse(
    createReadStream(descriptor.absolutePath, { start, end }) as never,
    {
      status: 206,
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${stats.size}`,
        "Accept-Ranges": "bytes",
      },
    }
  );
}
