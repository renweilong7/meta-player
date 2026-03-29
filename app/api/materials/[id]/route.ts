import { NextResponse } from "next/server";
import { deleteMaterial, updateMaterial } from "@/lib/persistence/repository";
import { MaterialPatchInput } from "@/lib/persistence/types";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const patch = (await request.json()) as MaterialPatchInput;
  const updated = updateMaterial(id, patch);

  if (!updated) {
    return NextResponse.json({ message: "素材不存在。" }, { status: 404 });
  }

  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const deleted = deleteMaterial(id);

  if (!deleted) {
    return NextResponse.json({ message: "素材不存在。" }, { status: 404 });
  }

  return new NextResponse(null, { status: 204 });
}
