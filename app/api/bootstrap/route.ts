import { NextResponse } from "next/server";
import { getLibrarySnapshot } from "@/lib/persistence/repository";

export const runtime = "nodejs";

/**
 * 页面初始化统一走这个接口，避免前端首屏拆成多次请求。
 */
export async function GET() {
  return NextResponse.json(getLibrarySnapshot());
}
