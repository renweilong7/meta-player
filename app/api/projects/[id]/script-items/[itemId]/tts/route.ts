import { NextResponse } from "next/server";
import { startProjectScriptTtsGenerationForItem } from "@/lib/project-script-tts/service";
import { getProjectById } from "@/lib/persistence/repository";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string; itemId: string }> }
) {
  const { id, itemId } = await context.params;

  const project = getProjectById(id);
  if (!project) {
    return NextResponse.json({ message: "项目不存在。" }, { status: 404 });
  }

  const updatedItem = await startProjectScriptTtsGenerationForItem(id, itemId);

  if (!updatedItem) {
    return NextResponse.json({ message: "文案条目不存在。" }, { status: 404 });
  }

  return NextResponse.json(updatedItem);
}
