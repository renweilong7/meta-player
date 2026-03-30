import { NextResponse } from "next/server";
import {
  assertLicensedFeature,
  LicenseAccessError,
  resolveSearchProviderByLicense,
} from "@/lib/license/service";
import { getSettings } from "@/lib/persistence/repository";
import { searchProjectOutline } from "@/lib/story-outline/index";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    projectId?: string;
    query?: string;
    limit?: number;
  };

  if (!body.projectId?.trim()) {
    return NextResponse.json({ message: "缺少项目 ID。" }, { status: 400 });
  }

  if (!body.query?.trim()) {
    return NextResponse.json({ mode: "keyword", results: [] });
  }

  try {
    assertLicensedFeature("base.search_basic");
    const settings = getSettings();
    const result = await searchProjectOutline({
      projectId: body.projectId,
      query: body.query,
      limit: body.limit,
      settings: {
        ...settings,
        storySearchProvider: resolveSearchProviderByLicense(
          settings.storySearchProvider
        ),
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof LicenseAccessError) {
      return NextResponse.json({ message: error.message }, { status: 403 });
    }

    const message = error instanceof Error ? error.message : "剧情搜索失败。";
    return NextResponse.json({ message }, { status: 500 });
  }
}
