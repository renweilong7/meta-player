import { NextResponse } from "next/server";
import { assertLicensedFeature, LicenseAccessError } from "@/lib/license/service";
import {
  deleteMaterialMarker,
  updateMaterialMarker,
} from "@/lib/persistence/repository";
import { MaterialMarkerUpdateInput } from "@/lib/persistence/types";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; markerId: string }> }
) {
  try {
    assertLicensedFeature("pro.marker");
    const { id, markerId } = await context.params;
    const body = (await request.json()) as MaterialMarkerUpdateInput;
    const updated = updateMaterialMarker(id, markerId, body);

    if (!updated) {
      return NextResponse.json({ message: "标记不存在。" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof LicenseAccessError) {
      return NextResponse.json({ message: error.message }, { status: 403 });
    }

    const message =
      error instanceof Error ? error.message : "更新标记失败，未捕获到具体错误信息。";

    return NextResponse.json({ message }, { status: 400 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; markerId: string }> }
) {
  try {
    assertLicensedFeature("pro.marker");
    const { id, markerId } = await context.params;
    const deleted = deleteMaterialMarker(id, markerId);

    if (!deleted) {
      return NextResponse.json({ message: "标记不存在。" }, { status: 404 });
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof LicenseAccessError) {
      return NextResponse.json({ message: error.message }, { status: 403 });
    }

    const message = error instanceof Error ? error.message : "删除标记失败。";
    return NextResponse.json({ message }, { status: 400 });
  }
}
