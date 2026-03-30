import { NextResponse } from "next/server";
import { assertLicensedFeature, LicenseAccessError } from "@/lib/license/service";
import { deleteMaterial, updateMaterial } from "@/lib/persistence/repository";
import { MaterialPatchInput } from "@/lib/persistence/types";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    assertLicensedFeature("base.material_management");
    const { id } = await context.params;
    const patch = (await request.json()) as MaterialPatchInput;
    const updated = updateMaterial(id, patch);

    if (!updated) {
      return NextResponse.json({ message: "素材不存在。" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof LicenseAccessError) {
      return NextResponse.json({ message: error.message }, { status: 403 });
    }

    const message = error instanceof Error ? error.message : "更新素材失败。";
    return NextResponse.json({ message }, { status: 400 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    assertLicensedFeature("base.material_management");
    const { id } = await context.params;
    const deleted = deleteMaterial(id);

    if (!deleted) {
      return NextResponse.json({ message: "素材不存在。" }, { status: 404 });
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof LicenseAccessError) {
      return NextResponse.json({ message: error.message }, { status: 403 });
    }

    const message = error instanceof Error ? error.message : "删除素材失败。";
    return NextResponse.json({ message }, { status: 400 });
  }
}
