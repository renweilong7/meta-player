import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import { NextResponse } from "next/server";
import { getProjectScriptItemById } from "@/lib/persistence/repository";

export const runtime = "nodejs";

const getMimeType = (absolutePath: string) => {
  const extension = extname(absolutePath).toLowerCase();

  if (extension === ".aiff" || extension === ".aif") {
    return "audio/aiff";
  }

  if (extension === ".wav") {
    return "audio/wav";
  }

  return "application/octet-stream";
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; itemId: string }> }
) {
  const { itemId } = await context.params;
  const item = getProjectScriptItemById(itemId);

  if (!item?.audio_path || !existsSync(item.audio_path)) {
    return NextResponse.json({ message: "音频不存在。" }, { status: 404 });
  }

  const fileBuffer = readFileSync(item.audio_path);

  return new NextResponse(fileBuffer, {
    headers: {
      "Content-Type": getMimeType(item.audio_path),
      "Cache-Control": "no-store",
    },
  });
}
