import { NextResponse } from "next/server";
import { assertLicensedFeature, LicenseAccessError } from "@/lib/license/service";
import { getSettings, saveSettings } from "@/lib/persistence/repository";
import { PersistedAppSettings } from "@/lib/persistence/types";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(getSettings());
}

export async function PUT(request: Request) {
  try {
    assertLicensedFeature("base.settings_basic");
    const body = (await request.json()) as PersistedAppSettings;

    return NextResponse.json(
      saveSettings({
        materialSavePath: body.materialSavePath,
        defaultManagedImport: body.defaultManagedImport,
        aiApiBaseUrl: body.aiApiBaseUrl,
        aiApiKey: body.aiApiKey,
        aiModelName: body.aiModelName,
        storySearchProvider: body.storySearchProvider,
        aiEmbeddingModelName: body.aiEmbeddingModelName,
        localEmbeddingModelName: body.localEmbeddingModelName,
        aiSearchModelName: body.aiSearchModelName,
      })
    );
  } catch (error) {
    if (error instanceof LicenseAccessError) {
      return NextResponse.json({ message: error.message }, { status: 403 });
    }

    const message = error instanceof Error ? error.message : "保存设置失败。";
    return NextResponse.json({ message }, { status: 400 });
  }
}
