import { NextResponse } from "next/server";
import { withRouteLogging } from "@/lib/observability/api-route";
import { assertLicensedFeature, LicenseAccessError } from "@/lib/license/service";
import { getSettings, saveSettings } from "@/lib/persistence/repository";
import { PersistedAppSettings } from "@/lib/persistence/types";

export const runtime = "nodejs";

const getHandler = async () => {
  return NextResponse.json(getSettings());
};

const putHandler = async (request: Request) => {
  try {
    assertLicensedFeature("base.settings_basic");
    const body = (await request.json()) as Partial<PersistedAppSettings>;
    const current = getSettings();

    return NextResponse.json(
      saveSettings({
        materialSavePath: body.materialSavePath ?? current.materialSavePath,
        defaultManagedImport: body.defaultManagedImport ?? current.defaultManagedImport,
        ffmpegExecutablePath:
          body.ffmpegExecutablePath ?? current.ffmpegExecutablePath,
        ffprobeExecutablePath:
          body.ffprobeExecutablePath ?? current.ffprobeExecutablePath,
        aiApiBaseUrl: body.aiApiBaseUrl ?? current.aiApiBaseUrl,
        aiApiKey: body.aiApiKey ?? current.aiApiKey,
        aiModelName: body.aiModelName ?? current.aiModelName,
        aiVisionBaseUrl: body.aiVisionBaseUrl ?? current.aiVisionBaseUrl,
        aiVisionApiKey: body.aiVisionApiKey ?? current.aiVisionApiKey,
        aiVisionModelName: body.aiVisionModelName ?? current.aiVisionModelName,
        aiVisionFps: body.aiVisionFps ?? current.aiVisionFps,
        storySearchProvider: body.storySearchProvider ?? current.storySearchProvider,
        aiEmbeddingModelName: body.aiEmbeddingModelName ?? current.aiEmbeddingModelName,
        localEmbeddingModelDirectory:
          body.localEmbeddingModelDirectory ?? current.localEmbeddingModelDirectory,
        localEmbeddingModelName:
          body.localEmbeddingModelName ?? current.localEmbeddingModelName,
        aiSearchModelName: body.aiSearchModelName ?? current.aiSearchModelName,
        localTtsModelName: body.localTtsModelName ?? current.localTtsModelName,
        autoGenerateProjectScriptTts:
          body.autoGenerateProjectScriptTts ?? current.autoGenerateProjectScriptTts,
        crossAssetSwitchMode: body.crossAssetSwitchMode ?? current.crossAssetSwitchMode,
      })
    );
  } catch (error) {
    if (error instanceof LicenseAccessError) {
      return NextResponse.json({ message: error.message }, { status: 403 });
    }

    const message = error instanceof Error ? error.message : "保存设置失败。";
    return NextResponse.json({ message }, { status: 400 });
  }
};

export const GET = withRouteLogging({ route: "/api/settings" }, getHandler);
export const PUT = withRouteLogging({ route: "/api/settings" }, putHandler);
