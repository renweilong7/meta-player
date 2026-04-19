import { NextResponse } from "next/server";
import { withRouteLogging } from "@/lib/observability/api-route";
import { assertLicensedFeature, LicenseAccessError } from "@/lib/license/service";
import { getSettings } from "@/lib/persistence/repository";
import { indexMaterialOutlineById } from "@/lib/story-outline/index";

export const runtime = "nodejs";

const postHandler = async (
  _request: Request,
  context: { params: Promise<{ id: string }> }
) => {
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
      error instanceof Error ? error.message : "剧情搜索索引生成失败。";

    return NextResponse.json({ message }, { status: 500 });
  }
};

export const POST = withRouteLogging(
  { route: "/api/materials/[id]/outline-index" },
  postHandler
);
