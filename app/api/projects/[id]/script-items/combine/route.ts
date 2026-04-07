import { NextResponse } from "next/server";
import { assertLicensedFeature, LicenseAccessError } from "@/lib/license/service";
import {
  combineProjectScriptItems,
  getProjectById,
} from "@/lib/persistence/repository";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    assertLicensedFeature("base.project_management");
    const { id } = await context.params;
    const project = getProjectById(id);

    if (!project) {
      return NextResponse.json({ message: "项目不存在。" }, { status: 404 });
    }

    const payload = (await request.json()) as {
      itemIds?: string[];
    };

    if (!Array.isArray(payload.itemIds) || payload.itemIds.length < 2) {
      return NextResponse.json({ message: "请至少选择两条连续文案。" }, { status: 400 });
    }

    const updatedProject = combineProjectScriptItems(id, {
      itemIds: payload.itemIds,
    });

    if (!updatedProject) {
      return NextResponse.json({ message: "组合文案失败。" }, { status: 400 });
    }

    return NextResponse.json(updatedProject);
  } catch (error) {
    if (error instanceof LicenseAccessError) {
      return NextResponse.json({ message: error.message }, { status: 403 });
    }

    const message = error instanceof Error ? error.message : "组合文案失败。";
    return NextResponse.json({ message }, { status: 400 });
  }
}
