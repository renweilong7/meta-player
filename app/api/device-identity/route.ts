import { NextResponse } from "next/server";
import { getAuthorizationSnapshot } from "@/lib/license/service";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(
    await getAuthorizationSnapshot({
      forceSync: true,
    })
  );
}
