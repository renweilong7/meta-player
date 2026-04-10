import { NextResponse } from "next/server";
import { withRouteLogging } from "@/lib/observability/api-route";
import {
  getAuthorizationSnapshot,
  getStoredLicenseConfig,
  LicenseAccessError,
  saveStoredLicenseConfig,
  syncStoredLicenseFromRemote,
} from "@/lib/license/service";
import { LicenseConfigInput } from "@/lib/license/types";

export const runtime = "nodejs";

const getHandler = async () => {
  try {
    await syncStoredLicenseFromRemote({
      force: true,
    });
  } catch {
    // 远端同步失败时退回本地缓存，避免影响授权面板打开。
  }

  return NextResponse.json(getStoredLicenseConfig());
};

/**
 * 这个同步入口给前端或排查脚本手动触发远端刷新。
 *
 * 和 `/api/device-identity` 的区别是：
 * - `/api/device-identity` 返回的是给用户页展示的完整授权快照。
 * - 这里更偏“同步动作本身”，返回本地落盘后的授权配置。
 */
const postHandler = async () => {
  try {
    const synced = await syncStoredLicenseFromRemote({
      force: true,
    });

    return NextResponse.json(synced);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "授权同步失败。";

    return NextResponse.json({ message }, { status: 502 });
  }
};

/**
 * 当前版本还没有远端授权后台，这里先保留一个本地写入口。
 *
 * 用途：
 * - 本地开发验证基础版/高级版行为。
 * - 后续接后台同步时，复用同一套落盘结构。
 *
 * 正式接远端授权后，这个入口可以收敛成仅后台同步调用。
 */
const putHandler = async (request: Request) => {
  try {
    const body = (await request.json()) as LicenseConfigInput;
    return NextResponse.json(saveStoredLicenseConfig(body));
  } catch (error) {
    if (error instanceof LicenseAccessError) {
      return NextResponse.json({ message: error.message }, { status: 403 });
    }

    const message =
      error instanceof Error ? error.message : "更新本地授权配置失败。";

    return NextResponse.json({ message }, { status: 400 });
  }
};

export const GET = withRouteLogging({ route: "/api/license" }, getHandler);
export const POST = withRouteLogging({ route: "/api/license" }, postHandler);
export const PUT = withRouteLogging({ route: "/api/license" }, putHandler);
