import { NextResponse } from "next/server";
import { withRouteLogging } from "@/lib/observability/api-route";
import { getLibrarySnapshot } from "@/lib/persistence/repository";

export const runtime = "nodejs";

/**
 * 页面初始化统一走这个接口，避免前端首屏拆成多次请求。
 */
const getHandler = async () => {
  return NextResponse.json(getLibrarySnapshot());
};

export const GET = withRouteLogging({ route: "/api/bootstrap" }, getHandler);
