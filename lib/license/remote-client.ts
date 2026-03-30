import { RemoteLicenseSnapshot } from "@/lib/license/types";

interface RemoteLicenseRequest {
  deviceId: string;
  deviceName: string;
  platform: string;
  appVersion: string;
}

const normalizeBaseUrl = (baseUrl: string) => baseUrl.replace(/\/+$/, "");

/**
 * 远端授权客户端只负责和 `license-server` 通信。
 *
 * 它不做任何本地权限决策，避免把“网络请求逻辑”和“授权解析逻辑”耦合在一起。
 */
export const syncLicenseFromServer = async (
  baseUrl: string,
  payload: RemoteLicenseRequest
): Promise<RemoteLicenseSnapshot> => {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/api/license/sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  const data = (await response.json()) as RemoteLicenseSnapshot & { message?: string };

  if (!response.ok) {
    throw new Error(data.message ?? "授权服务同步失败。");
  }

  return data;
};
