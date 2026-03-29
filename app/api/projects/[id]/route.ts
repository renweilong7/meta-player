import { NextResponse } from "next/server";
import { deleteProject, updateProject } from "@/lib/persistence/repository";
import { ProjectUpdateInput } from "@/lib/persistence/types";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const patch = (await request.json()) as ProjectUpdateInput;
    const updated = updateProject(id, patch);

    if (!updated) {
      return NextResponse.json({ message: "项目不存在。" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "更新项目失败，未捕获到具体错误信息。";

    return NextResponse.json({ message }, { status: 400 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const deleted = deleteProject(id);

  if (!deleted) {
    return NextResponse.json({ message: "项目不存在。" }, { status: 404 });
  }

  return new NextResponse(null, { status: 204 });
}
