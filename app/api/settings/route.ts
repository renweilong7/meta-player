import { NextResponse } from "next/server";
import { withRouteLogging } from "@/lib/observability/api-route";
import { assertLicensedFeature, LicenseAccessError } from "@/lib/license/service";
import { getSettings, saveSettings } from "@/lib/persistence/repository";
import { PersistedAppSettings } from "@/lib/persistence/types";

export const runtime = "nodejs";

type SettingsRequestBody = Partial<PersistedAppSettings> & {
  aiApiBaseUrl?: string;
  aiApiKey?: string;
  aiModelName?: string;
};

const getHandler = async () => {
  return NextResponse.json(getSettings());
};

const putHandler = async (request: Request) => {
  try {
    assertLicensedFeature("base.settings_basic");
    const body = (await request.json()) as SettingsRequestBody;
    const current = getSettings();

    return NextResponse.json(
      saveSettings({
        materialSavePath: body.materialSavePath ?? current.materialSavePath,
        defaultManagedImport: body.defaultManagedImport ?? current.defaultManagedImport,
        ffmpegExecutablePath:
          body.ffmpegExecutablePath ?? current.ffmpegExecutablePath,
        ffprobeExecutablePath:
          body.ffprobeExecutablePath ?? current.ffprobeExecutablePath,
        aiTextProvider: body.aiTextProvider ?? current.aiTextProvider,
        openaiApiBaseUrl:
          body.openaiApiBaseUrl ??
          (body.aiTextProvider === "openai_compatible" ? body.aiApiBaseUrl : undefined) ??
          current.openaiApiBaseUrl,
        openaiApiKey:
          body.openaiApiKey ??
          (body.aiTextProvider === "openai_compatible" ? body.aiApiKey : undefined) ??
          current.openaiApiKey,
        grok2apiBaseUrl:
          body.grok2apiBaseUrl ??
          (body.aiTextProvider === "grok2api" ? body.aiApiBaseUrl : undefined) ??
          current.grok2apiBaseUrl,
        grok2apiApiKey:
          body.grok2apiApiKey ??
          (body.aiTextProvider === "grok2api" ? body.aiApiKey : undefined) ??
          current.grok2apiApiKey,
        openaiTextModelName:
          body.openaiTextModelName ??
          (body.aiTextProvider === "openai_compatible" ? body.aiModelName : undefined) ??
          current.openaiTextModelName,
        grok2apiTextModelName:
          body.grok2apiTextModelName ??
          (body.aiTextProvider === "grok2api" ? body.aiModelName : undefined) ??
          current.grok2apiTextModelName,
        aiVisionBaseUrl: body.aiVisionBaseUrl ?? current.aiVisionBaseUrl,
        aiVisionApiKey: body.aiVisionApiKey ?? current.aiVisionApiKey,
        aiVisionModelName: body.aiVisionModelName ?? current.aiVisionModelName,
        aiVisionFps: body.aiVisionFps ?? current.aiVisionFps,
        storySearchProvider: body.storySearchProvider ?? current.storySearchProvider,
        aiSearchProvider: body.aiSearchProvider ?? current.aiSearchProvider,
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
