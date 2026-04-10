import { NextResponse } from "next/server";
import { withRouteLogging } from "@/lib/observability/api-route";
import { assertLicensedFeature, LicenseAccessError } from "@/lib/license/service";
import { getMaterialById, getSettings, updateMaterial } from "@/lib/persistence/repository";
import { generateSceneShotAnalysis } from "@/lib/story-outline/shot-analysis";
import {
  indexMaterialOutlineSceneById,
  reindexMaterialOutlineSceneForAttachedProjects,
} from "@/lib/story-outline/index";

export const runtime = "nodejs";

const postHandler = async (
  request: Request,
  context: { params: Promise<{ id: string }> }
) => {
  try {
    assertLicensedFeature("base.outline_basic");
    const { id } = await context.params;
    const body = (await request.json()) as { sceneId?: string };
    const sceneId = body.sceneId?.trim();

    if (!sceneId) {
      return NextResponse.json({ message: "缺少场景 ID。" }, { status: 400 });
    }

    const material = getMaterialById(id);
    if (!material) {
      return NextResponse.json({ message: "素材不存在。" }, { status: 404 });
    }

    const scene = material.storyOutline?.find((item) => item.id === sceneId);
    if (!scene) {
      return NextResponse.json({ message: "场景不存在。" }, { status: 404 });
    }

    const settings = getSettings();

    const shotAnalysis = await generateSceneShotAnalysis({
      material,
      scene,
      settings,
    });

    const updated = updateMaterial(id, {
      storyOutline: (material.storyOutline ?? []).map((item) =>
        item.id === sceneId
          ? {
              ...item,
              shotAnalysis,
            }
          : item
      ),
    });

    if (!updated) {
      return NextResponse.json({ message: "素材更新失败。" }, { status: 404 });
    }

    await indexMaterialOutlineSceneById(id, sceneId, settings);
    await reindexMaterialOutlineSceneForAttachedProjects(id, sceneId, settings);

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof LicenseAccessError) {
      return NextResponse.json({ message: error.message }, { status: 403 });
    }

    const message = error instanceof Error ? error.message : "镜头解读生成失败。";
    return NextResponse.json({ message }, { status: 400 });
  }
};

export const POST = withRouteLogging(
  { route: "/api/materials/[id]/shot-analysis" },
  postHandler
);
