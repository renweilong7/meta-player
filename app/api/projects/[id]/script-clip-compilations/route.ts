import { NextResponse } from "next/server";
import { withRouteLogging } from "@/lib/observability/api-route";
import { assertLicensedFeature, LicenseAccessError } from "@/lib/license/service";
import { compileProjectClips } from "@/lib/persistence/repository";

export const runtime = "nodejs";

const postHandler = async (
  request: Request,
  context: { params: Promise<{ id: string }> }
) => {
  try {
    assertLicensedFeature("base.material_management");
    const { id } = await context.params;
    const body = (await request.json()) as {
      clipIds?: string[];
      label?: string;
    };

    if (!Array.isArray(body.clipIds) || body.clipIds.length === 0) {
      return NextResponse.json({ message: "缺少可合成的片段。" }, { status: 400 });
    }

    const result = compileProjectClips({
      projectId: id,
      clipIds: body.clipIds.map((item) => String(item)),
      label: body.label?.trim() || "项目成片",
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof LicenseAccessError) {
      return NextResponse.json({ message: error.message }, { status: 403 });
    }

    const message = error instanceof Error ? error.message : "合成项目片段失败。";
    return NextResponse.json({ message }, { status: 400 });
  }
};

export const POST = withRouteLogging(
  { route: "/api/projects/[id]/script-clip-compilations" },
  postHandler
);
