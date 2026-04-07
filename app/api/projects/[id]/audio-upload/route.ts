import { mkdirSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { assertLicensedFeature, LicenseAccessError } from "@/lib/license/service";
import { getProjectById, getSettings, updateProject } from "@/lib/persistence/repository";

export const runtime = "nodejs";

const sanitizeExtension = (filename: string) => {
  const extension = extname(filename).toLowerCase();
  if (!extension || extension.length > 12) {
    return "";
  }

  return extension;
};

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

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ message: "缺少音频文件。" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const settings = getSettings();
    const directory = join(settings.materialSavePath, "project-audio");
    mkdirSync(directory, { recursive: true });

    const storedFilename = `${id}-${randomUUID()}${sanitizeExtension(file.name)}`;
    const absolutePath = join(directory, storedFilename);
    writeFileSync(absolutePath, buffer);

    const updated = updateProject(id, {
      scriptAudio: {
        filename: file.name,
        absolutePath,
        fileSize: file.size,
      },
    });

    if (!updated) {
      return NextResponse.json({ message: "项目不存在。" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof LicenseAccessError) {
      return NextResponse.json({ message: error.message }, { status: 403 });
    }

    const message = error instanceof Error ? error.message : "导入项目音频失败。";
    return NextResponse.json({ message }, { status: 400 });
  }
}
