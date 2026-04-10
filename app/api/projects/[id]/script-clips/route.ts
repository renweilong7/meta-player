import { NextResponse } from "next/server";
import { withRouteLogging } from "@/lib/observability/api-route";
import { assertLicensedFeature, LicenseAccessError } from "@/lib/license/service";
import { createProjectScriptClip } from "@/lib/persistence/repository";

export const runtime = "nodejs";

const postHandler = async (
  request: Request,
  context: { params: Promise<{ id: string }> }
) => {
  try {
    assertLicensedFeature("base.material_management");
    const { id } = await context.params;
    const body = (await request.json()) as {
      scriptItemId?: string;
      scriptContent?: string;
      assetId?: string;
      startSeconds?: number;
      audioStartSeconds?: number;
      durationSeconds?: number;
      label?: string;
    };

    if (!body.scriptItemId) {
      return NextResponse.json({ message: "缺少文案条目 ID。" }, { status: 400 });
    }

    if (!body.assetId) {
      return NextResponse.json({ message: "缺少素材 ID。" }, { status: 400 });
    }

    const result = createProjectScriptClip({
      projectId: id,
      scriptItemId: body.scriptItemId,
      scriptContent: body.scriptContent?.trim() || "",
      assetId: body.assetId,
      startSeconds: Number(body.startSeconds ?? 0),
      audioStartSeconds: Number(body.audioStartSeconds ?? 0),
      durationSeconds: Number(body.durationSeconds ?? 0),
      label: body.label?.trim() || "片段",
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof LicenseAccessError) {
      return NextResponse.json({ message: error.message }, { status: 403 });
    }

    const message = error instanceof Error ? error.message : "生成片段失败。";
    return NextResponse.json({ message }, { status: 400 });
  }
};

export const POST = withRouteLogging(
  { route: "/api/projects/[id]/script-clips" },
  postHandler
);
