import { NextResponse } from "next/server";
import { getSettings } from "@/lib/persistence/repository";
import { indexMaterialOutlineById } from "@/lib/story-outline/index";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  try {
    const result = await indexMaterialOutlineById(id, getSettings());
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "剧情向量索引生成失败。";

    return NextResponse.json({ message }, { status: 500 });
  }
}
