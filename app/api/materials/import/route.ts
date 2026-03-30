import { NextResponse } from "next/server";
import { assertLicensedFeature, LicenseAccessError } from "@/lib/license/service";
import {
  appendMaterialsToProject,
  importMaterialFromBuffer,
} from "@/lib/persistence/repository";

export const runtime = "nodejs";

type UploadedFileLike = Blob & {
  name?: string;
  type: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

const isUploadedFileLike = (entry: FormDataEntryValue): boolean =>
  typeof entry === "object" &&
  entry !== null &&
  "arrayBuffer" in entry &&
  typeof entry.arrayBuffer === "function";

/**
 * 通过 multipart/form-data 导入一个或多个素材。
 *
 * 路由层只负责：
 * - 解析浏览器上传的文件。
 * - 调用仓储层完成哈希去重和落盘。
 */
export async function POST(request: Request) {
  try {
    assertLicensedFeature("base.material_management");
    const formData = await request.formData();
    const files = formData
      .getAll("files")
      .filter(isUploadedFileLike) as UploadedFileLike[];

    if (files.length === 0) {
      return NextResponse.json({ message: "未选择任何素材文件。" }, { status: 400 });
    }

    const importedMaterials = await Promise.all(
      files.map(async (file, index) => {
        const arrayBuffer = await file.arrayBuffer();
        const originalPath = formData.get(`originalPath:${index}`);

        return importMaterialFromBuffer({
          buffer: Buffer.from(arrayBuffer),
          filename: file.name ?? "untitled.bin",
          mimeType: file.type,
          originalPath: typeof originalPath === "string" ? originalPath : undefined,
        });
      })
    );
    const projectId = formData.get("projectId");

    if (typeof projectId === "string" && projectId.trim()) {
      appendMaterialsToProject(
        projectId,
        importedMaterials.map((item) => item.id)
      );
    }

    return NextResponse.json({ materials: importedMaterials });
  } catch (error) {
    if (error instanceof LicenseAccessError) {
      return NextResponse.json({ message: error.message }, { status: 403 });
    }

    const message =
      error instanceof Error ? error.message : "素材导入失败，未捕获到具体错误信息。";

    return NextResponse.json({ message }, { status: 500 });
  }
}
