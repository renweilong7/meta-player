import { NextResponse } from "next/server";
import { assertLicensedFeature, LicenseAccessError } from "@/lib/license/service";
import { getSettings } from "@/lib/persistence/repository";
import { indexMaterialOutlineById } from "@/lib/story-outline/index";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    assertLicensedFeature("base.outline_basic");
    const { id } = await context.params;
    const result = await indexMaterialOutlineById(id, getSettings());
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof LicenseAccessError) {
      return NextResponse.json({ message: error.message }, { status: 403 });
    }

    const message =
      error instanceof Error ? error.message : "剧情向量索引生成失败。";

    return NextResponse.json({ message }, { status: 500 });
  }
}
