import { NextResponse } from "next/server";
import { withRouteLogging } from "@/lib/observability/api-route";
import { getAiUsageSnapshot, recordAiUsageEvent } from "@/lib/persistence/repository";
import { PersistedAiUsageRecord } from "@/lib/persistence/types";

export const runtime = "nodejs";

const getHandler = async () => {
  return NextResponse.json(getAiUsageSnapshot());
};

const postHandler = async (request: Request) => {
  try {
    const body = (await request.json()) as Partial<PersistedAiUsageRecord>;

    if (
      !body.action ||
      !body.provider ||
      !body.model ||
      !body.status
    ) {
      return NextResponse.json({ message: "缺少必要的用量记录字段。" }, { status: 400 });
    }

    recordAiUsageEvent({
      action: body.action,
      provider: body.provider,
      model: body.model,
      endpoint: body.endpoint,
      inputTokens: body.inputTokens,
      outputTokens: body.outputTokens,
      totalTokens: body.totalTokens,
      inputCount: body.inputCount,
      status: body.status,
      errorMessage: body.errorMessage,
      projectId: body.projectId,
      materialId: body.materialId,
      sceneId: body.sceneId,
      metadata: body.metadata,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "写入用量记录失败。";
    return NextResponse.json({ message }, { status: 400 });
  }
};

export const GET = withRouteLogging({ route: "/api/usage" }, getHandler);
export const POST = withRouteLogging({ route: "/api/usage" }, postHandler);
