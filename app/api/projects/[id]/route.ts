import { NextResponse } from "next/server";
import { withRouteLogging } from "@/lib/observability/api-route";
import { assertLicensedFeature, LicenseAccessError } from "@/lib/license/service";
import {
  deleteProject,
  getProjectById,
  updateProject,
} from "@/lib/persistence/repository";
import { ProjectUpdateInput } from "@/lib/persistence/types";

export const runtime = "nodejs";

const getHandler = async (
  _request: Request,
  context: { params: Promise<{ id: string }> }
) => {
  const { id } = await context.params;
  const project = getProjectById(id);

  if (!project) {
    return NextResponse.json({ message: "项目不存在。" }, { status: 404 });
  }

  return NextResponse.json(project);
};

const patchHandler = async (
  request: Request,
  context: { params: Promise<{ id: string }> }
) => {
  try {
    assertLicensedFeature("base.project_management");
    const { id } = await context.params;
    const patch = (await request.json()) as ProjectUpdateInput;
    const updated = updateProject(id, patch);

    if (!updated) {
      return NextResponse.json({ message: "项目不存在。" }, { status: 404 });
    }

    return NextResponse.json(getProjectById(id) ?? updated);
  } catch (error) {
    if (error instanceof LicenseAccessError) {
      return NextResponse.json({ message: error.message }, { status: 403 });
    }

    const message =
      error instanceof Error ? error.message : "更新项目失败，未捕获到具体错误信息。";

    return NextResponse.json({ message }, { status: 400 });
  }
};

const deleteHandler = async (
  _request: Request,
  context: { params: Promise<{ id: string }> }
) => {
  try {
    assertLicensedFeature("base.project_management");
    const { id } = await context.params;
    const deleted = deleteProject(id);

    if (!deleted) {
      return NextResponse.json({ message: "项目不存在。" }, { status: 404 });
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof LicenseAccessError) {
      return NextResponse.json({ message: error.message }, { status: 403 });
    }

    const message = error instanceof Error ? error.message : "删除项目失败。";
    return NextResponse.json({ message }, { status: 400 });
  }
};

export const GET = withRouteLogging({ route: "/api/projects/[id]" }, getHandler);
export const PATCH = withRouteLogging(
  { route: "/api/projects/[id]" },
  patchHandler
);
export const DELETE = withRouteLogging(
  { route: "/api/projects/[id]" },
  deleteHandler
);
