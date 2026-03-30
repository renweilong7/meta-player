export type LicenseMode = "basic" | "pro";

export type LicenseStatus =
  | "unregistered"
  | "pending"
  | "active"
  | "expired"
  | "disabled";

/**
 * 功能点编码采用“产品层级 + 功能名”的格式。
 *
 * 这样做有两个目的：
 * 1. 让后台配置和代码判断统一使用同一套稳定 key。
 * 2. 新功能上线时，只需要新增一个 key，不需要到处硬编码 `basic/pro` 判断。
 */
export type LicenseFeatureKey =
  | "base.app_access"
  | "base.project_management"
  | "base.material_management"
  | "base.playback"
  | "base.outline_basic"
  | "base.search_basic"
  | "base.settings_basic"
  | "pro.marker"
  | "pro.outline_advanced"
  | "pro.search_advanced"
  | "pro.video_editing"
  | "pro.export"
  | "pro.workflow_advanced";

export type LicenseFeatureStatus = "enabled" | "disabled";

export interface LicenseFeatureEntitlement {
  key: LicenseFeatureKey;
  name: string;
  description: string;
  includedInMode: LicenseMode;
  status: LicenseFeatureStatus;
  expiresAt?: string | null;
}

export interface DeviceFingerprintSnapshot {
  deviceId: string;
  fingerprintText: string;
  algorithm: string;
  collectedAt: string;
  deviceName: string;
  platform: string;
}

export interface AuthorizationSnapshot {
  mode: LicenseMode;
  modeLabel: string;
  status: LicenseStatus;
  statusLabel: string;
  instructions: string;
  expiresAt?: string | null;
  lastSyncAt?: string | null;
  deviceFingerprint: DeviceFingerprintSnapshot;
  features: LicenseFeatureEntitlement[];
}

export interface StoredLicenseConfig {
  mode: LicenseMode;
  status: LicenseStatus;
  expiresAt: string | null;
  lastSyncAt: string | null;
  featureOverrides: Partial<Record<LicenseFeatureKey, boolean>>;
}

export interface LicenseConfigInput {
  mode?: LicenseMode;
  status?: LicenseStatus;
  expiresAt?: string | null;
  lastSyncAt?: string | null;
  featureOverrides?: Partial<Record<LicenseFeatureKey, boolean>>;
}

/**
 * 这是授权服务器返回给客户端的最小快照协议。
 *
 * 主项目本地只关心：
 * - 当前授权模式
 * - 当前授权状态
 * - 到期时间
 * - 最后同步时间
 * - 每个功能点是否开启
 *
 * 这样服务端和客户端之间的协议保持稳定，后续后台面板扩字段时，
 * 不会影响客户端核心授权链路。
 */
export interface RemoteLicenseSnapshot {
  deviceId: string;
  status: LicenseStatus;
  mode: LicenseMode;
  expiresAt: string | null;
  lastSyncAt: string | null;
  features: Partial<Record<LicenseFeatureKey, boolean>>;
}
