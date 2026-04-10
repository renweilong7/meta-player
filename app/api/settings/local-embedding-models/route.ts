import { NextResponse } from "next/server";
import { withRouteLogging } from "@/lib/observability/api-route";
import { getSettings } from "@/lib/persistence/repository";
import { getDefaultLocalEmbeddingModelDirectory } from "@/lib/runtime/resource-paths";
import { listLocalEmbeddingModels } from "@/lib/story-outline/local-embedding";

export const runtime = "nodejs";

const getHandler = async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const directory = searchParams.get("directory");
  const settings = getSettings();
  const effectiveDirectory =
    typeof directory === "string" && directory.trim()
      ? directory
      : settings.localEmbeddingModelDirectory || getDefaultLocalEmbeddingModelDirectory();

  return NextResponse.json({
    directory: effectiveDirectory,
    models: listLocalEmbeddingModels(effectiveDirectory),
  });
};

export const GET = withRouteLogging(
  { route: "/api/settings/local-embedding-models" },
  getHandler
);
