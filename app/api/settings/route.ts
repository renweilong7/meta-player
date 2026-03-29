import { NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/persistence/repository";
import { PersistedAppSettings } from "@/lib/persistence/types";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(getSettings());
}

export async function PUT(request: Request) {
  const body = (await request.json()) as PersistedAppSettings;

  return NextResponse.json(
    saveSettings({
      materialSavePath: body.materialSavePath,
      defaultManagedImport: body.defaultManagedImport,
      aiApiBaseUrl: body.aiApiBaseUrl,
      aiApiKey: body.aiApiKey,
      aiModelName: body.aiModelName,
    })
  );
}
