import { NextResponse } from "next/server";
import { getSettings } from "@/lib/persistence/repository";
import { listLocalEmbeddingModels } from "@/lib/story-outline/local-embedding";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const directory = searchParams.get("directory");
  const settings = getSettings();
  const effectiveDirectory =
    typeof directory === "string" ? directory : settings.localEmbeddingModelDirectory;

  return NextResponse.json({
    models: listLocalEmbeddingModels(effectiveDirectory),
  });
}
