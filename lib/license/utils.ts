import {
  AuthorizationSnapshot,
  LicenseFeatureKey,
  LicenseStatus,
} from "@/lib/license/types";

/**
 * 前端只做“展示和交互优化”，真正授权以服务端/API 断言为准。
 *
 * 这里提供一个轻量 helper，避免页面层到处手写
 * `authorization.features.find(...)` 这种重复查找逻辑。
 */
export const hasAuthorizedFeature = (
  authorization: AuthorizationSnapshot | null | undefined,
  featureKey: LicenseFeatureKey
) =>
  authorization?.features.some(
    (feature) => feature.key === featureKey && feature.status === "enabled"
  ) ?? false;

export const isAuthorizedStatus = (
  status: LicenseStatus | null | undefined
) => status === "authorized";
