import { NextResponse } from "next/server";
import { withRouteLogging } from "@/lib/observability/api-route";
import { assertLicensedFeature, LicenseAccessError } from "@/lib/license/service";
import { createProject, listProjects } from "@/lib/persistence/repository";
import { ProjectCreateInput } from "@/lib/persistence/types";

export const runtime = "nodejs";

const getHandler = async () => {
  return NextResponse.json({ projects: listProjects() });
};

const postHandler = async (request: Request) => {
  try {
    assertLicensedFeature("base.project_management");
    const body = (await request.json()) as ProjectCreateInput;
    const project = createProject({
      name: body.name,
      description: body.description,
      storySearchProvider: body.storySearchProvider,
      embeddingModelSource: body.embeddingModelSource,
      embeddingModelId: body.embeddingModelId,
    });

    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    if (error instanceof LicenseAccessError) {
      return NextResponse.json({ message: error.message }, { status: 403 });
    }

    const message =
      error instanceof Error ? error.message : "创建项目失败，未捕获到具体错误信息。";

    return NextResponse.json({ message }, { status: 400 });
  }
};

export const GET = withRouteLogging({ route: "/api/projects" }, getHandler);
export const POST = withRouteLogging({ route: "/api/projects" }, postHandler);
