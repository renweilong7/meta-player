import { NextResponse } from "next/server";
import { withRouteLogging } from "@/lib/observability/api-route";
import { getAuthorizationSnapshot } from "@/lib/license/service";

export const runtime = "nodejs";

const getHandler = async () => {
  return NextResponse.json(
    await getAuthorizationSnapshot({
      forceSync: false,
    })
  );
};

export const GET = withRouteLogging(
  { route: "/api/device-identity" },
  getHandler
);
