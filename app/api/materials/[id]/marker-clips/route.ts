import { NextResponse } from "next/server";
import { withRouteLogging } from "@/lib/observability/api-route";
import { assertLicensedFeature, LicenseAccessError } from "@/lib/license/service";
import { createMaterialMarkerClips } from "@/lib/persistence/repository";

export const runtime = "nodejs";

const postHandler = async (
  request: Request,
  context: { params: Promise<{ id: string }> }
) => {
  try {
    assertLicensedFeature("pro.marker");
    assertLicensedFeature("pro.export");

    const { id } = await context.params;
    const body = (await request.json()) as {
      projectId?: string;
      markerId?: string;
    };

    if (!body.projectId?.trim()) {
      return NextResponse.json({ message: "缺少项目 ID。" }, { status: 400 });
    }

    const clips = createMaterialMarkerClips({
      materialId: id,
      projectId: body.projectId.trim(),
      markerId: body.markerId?.trim() || undefined,
    });

    return NextResponse.json({ clips }, { status: 201 });
  } catch (error) {
    if (error instanceof LicenseAccessError) {
      return NextResponse.json({ message: error.message }, { status: 403 });
    }

    const message = error instanceof Error ? error.message : "切割标记片段失败。";
    return NextResponse.json({ message }, { status: 400 });
  }
};

export const POST = withRouteLogging(
  { route: "/api/materials/[id]/marker-clips" },
  postHandler
);
