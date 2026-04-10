import { NextResponse } from "next/server";
import { withRouteLogging } from "@/lib/observability/api-route";
import { assertLicensedFeature, LicenseAccessError } from "@/lib/license/service";
import { createMaterialMarker } from "@/lib/persistence/repository";
import { MaterialMarkerCreateInput } from "@/lib/persistence/types";

export const runtime = "nodejs";

const postHandler = async (
  request: Request,
  context: { params: Promise<{ id: string }> }
) => {
  try {
    assertLicensedFeature("pro.marker");
    const { id } = await context.params;
    const body = (await request.json()) as MaterialMarkerCreateInput;
    const updated = createMaterialMarker(id, {
      time: body.time,
      content: body.content,
    });

    if (!updated) {
      return NextResponse.json({ message: "素材不存在。" }, { status: 404 });
    }

    return NextResponse.json(updated, { status: 201 });
  } catch (error) {
    if (error instanceof LicenseAccessError) {
      return NextResponse.json({ message: error.message }, { status: 403 });
    }

    const message =
      error instanceof Error ? error.message : "创建标记失败，未捕获到具体错误信息。";

    return NextResponse.json({ message }, { status: 400 });
  }
};

export const POST = withRouteLogging(
  { route: "/api/materials/[id]/markers" },
  postHandler
);
