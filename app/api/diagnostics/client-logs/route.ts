import { NextResponse } from "next/server";
import { withRouteLogging } from "@/lib/observability/api-route";
import { createServerLogger } from "@/lib/observability/logger";

export const runtime = "nodejs";

type ClientLogPayload = {
  level?: "info" | "warn" | "error";
  event?: string;
  clientSessionId?: string;
  clientRequestId?: string;
  href?: string;
  details?: Record<string, unknown>;
  error?: unknown;
};

const clientLogger = createServerLogger("client", {
  component: "browser",
});

const postHandler = async (request: Request) => {
  const body = (await request.json()) as ClientLogPayload;

  if (!body.event?.trim()) {
    return NextResponse.json({ message: "缺少客户端事件名称。" }, { status: 400 });
  }

  const level = body.level ?? "info";
  const context = {
    event: body.event,
    clientSessionId: body.clientSessionId,
    clientRequestId: body.clientRequestId,
    href: body.href,
    details: body.details,
    error: body.error,
    userAgent: request.headers.get("user-agent") ?? undefined,
  };

  if (level === "error") {
    clientLogger.error("client.event", context);
  } else if (level === "warn") {
    clientLogger.warn("client.event", context);
  } else {
    clientLogger.info("client.event", context);
  }

  return NextResponse.json({ ok: true }, { status: 201 });
};

export const POST = withRouteLogging(
  {
    route: "/api/diagnostics/client-logs",
  },
  postHandler
);
