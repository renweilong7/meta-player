import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { arch, hostname, networkInterfaces, platform, release } from "node:os";
import { LICENSE_FEATURE_CATALOG } from "@/lib/license/feature-catalog";
import {
  AuthorizationSnapshot,
  DeviceFingerprintSnapshot,
  LicenseConfigInput,
  LicenseFeatureKey,
  LicenseMode,
  LicenseStatus,
  RemoteLicenseSnapshot,
  StoredLicenseConfig,
} from "@/lib/license/types";
import { syncLicenseFromServer } from "@/lib/license/remote-client";
import { readAppSettingMap, saveAppSettingValues } from "@/lib/persistence/repository";
import { StorySearchProvider } from "@/lib/persistence/types";

const LICENSE_SETTING_KEYS = {
  mode: "license.mode",
  status: "license.status",
  expiresAt: "license.expiresAt",
  lastSyncAt: "license.lastSyncAt",
  featureOverrides: "license.featureOverrides",
  deviceSeed: "license.deviceSeed",
} as const;

const DEFAULT_LICENSE_CONFIG: StoredLicenseConfig = {
  mode: "basic",
  status: "active",
  expiresAt: null,
  lastSyncAt: null,
  featureOverrides: {},
};
const LICENSE_SYNC_MIN_INTERVAL_MS = 60 * 1000;
const DEFAULT_LICENSE_SERVER_BASE_URL =
  "https://meta-player-license-server.renweilong7.workers.dev";

export class LicenseAccessError extends Error {
  featureKey: LicenseFeatureKey;

  constructor(featureKey: LicenseFeatureKey, message: string) {
    super(message);
    this.name = "LicenseAccessError";
    this.featureKey = featureKey;
  }
}

/**
 * 当前默认直接使用 Cloudflare 授权服务地址，避免桌面端用户手动配置。
 *
 * 同时仍然保留环境变量覆盖能力：
 * - 默认包直接走线上授权服务。
 * - 本地联调或后续多环境部署时，可注入 `LICENSE_SERVER_BASE_URL`
 *   来替换成其他授权服务器地址，而不需要改业务代码。
 */
const getLicenseServerBaseUrl = () =>
  process.env.LICENSE_SERVER_BASE_URL?.trim() ||
  DEFAULT_LICENSE_SERVER_BASE_URL;

const getAppVersion = () => process.env.npm_package_version?.trim() ?? "0.1.0";

const stableValue = (value: string | undefined | null) => value?.trim() ?? "";

const runCommand = (command: string, args: string[]) => {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
};

const extractMacSerial = () => {
  const output = runCommand("ioreg", [
    "-rd1",
    "-c",
    "IOPlatformExpertDevice",
  ]);
  const match = output.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
  return stableValue(match?.[1]);
};

const extractWindowsUuid = () =>
  stableValue(
    runCommand("powershell", [
      "-NoProfile",
      "-Command",
      "(Get-CimInstance Win32_ComputerSystemProduct).UUID",
    ])
  );

const extractLinuxMachineId = () => {
  const candidates = ["/etc/machine-id", "/var/lib/dbus/machine-id"];

  for (const filePath of candidates) {
    if (!existsSync(filePath)) {
      continue;
    }

    try {
      const value = readFileSync(filePath, "utf8").trim();
      if (value) {
        return value;
      }
    } catch {
      // Ignore and continue with the next candidate.
    }
  }

  return "";
};

const collectPlatformFingerprintSeed = () => {
  switch (platform()) {
    case "darwin":
      return extractMacSerial();
    case "win32":
      return extractWindowsUuid();
    case "linux":
      return extractLinuxMachineId();
    default:
      return "";
  }
};

const collectMacAddresses = () => {
  const interfaces = networkInterfaces();

  return Object.values(interfaces)
    .flatMap((items) => items ?? [])
    .map((item) => stableValue(item?.mac))
    .filter((value) => value && value !== "00:00:00:00:00:00")
    .sort()
    .join("|");
};

/**
 * 当操作系统无法提供稳定机器标识时，回退到本地持久化安装种子。
 *
 * 这个种子一旦生成就写入本地设置：
 * - 重启应用不会变化。
 * - 切换授权状态不会变化。
 * - 只有删除本地数据目录时才会丢失。
 *
 * 这样至少可以保证“同一份安装实例”的设备 ID 长期稳定，
 * 避免因为网络环境、主机名等易变字段导致重复注册。
 */
const getOrCreateDeviceSeed = () => {
  const settings = readAppSettingMap();
  const existingSeed = stableValue(settings.get(LICENSE_SETTING_KEYS.deviceSeed));

  if (existingSeed) {
    return existingSeed;
  }

  const nextSeed = randomUUID();
  saveAppSettingValues({
    [LICENSE_SETTING_KEYS.deviceSeed]: nextSeed,
  });

  return nextSeed;
};

/**
 * 设备指纹只负责提供“稳定设备身份”，不直接承担授权逻辑。
 *
 * 指纹策略改成“稳定硬件标识优先，本地安装种子兜底”。
 *
 * 原因：
 * - `hostname`、虚拟网卡、VPN 网卡等信息非常容易变化。
 * - 一旦把这些字段混入主身份，同一台机器重启后就可能生成新指纹。
 *
 * 当前优先级：
 * 1. 平台级稳定 ID：
 *    - macOS: IOPlatformUUID
 *    - Windows: 机器 UUID
 *    - Linux: machine-id
 * 2. 若拿不到，再退回本地持久化 `deviceSeed`
 *
 * 同时保留平台和架构作为哈希命名空间，避免不同平台的兜底值偶然碰撞。
 */
const buildFingerprintSnapshot = (): DeviceFingerprintSnapshot => {
  const platformSeed = collectPlatformFingerprintSeed();
  const fallbackSeed = getOrCreateDeviceSeed();
  const macAddresses = collectMacAddresses();
  const stableMachineSeed = platformSeed || fallbackSeed;
  const seed = [platform(), arch(), stableMachineSeed].map(stableValue).join("::");
  const deviceId = createHash("sha256").update(seed).digest("hex");
  const algorithm = platformSeed
    ? "sha256(platform-arch-stableMachineId)"
    : "sha256(platform-arch-localDeviceSeed)";

  return {
    deviceId,
    fingerprintText: deviceId.toUpperCase(),
    algorithm,
    collectedAt: new Date().toISOString(),
    deviceName: hostname(),
    platform: `${platform()} ${release()} (${arch()})${
      macAddresses ? " · network-detected" : ""
    }`,
  };
};

const parseFeatureOverrides = (
  rawValue: string | undefined
): StoredLicenseConfig["featureOverrides"] => {
  if (!rawValue?.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawValue) as Record<string, unknown>;

    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [LicenseFeatureKey, boolean] =>
          typeof entry[0] === "string" && typeof entry[1] === "boolean"
      )
    ) as StoredLicenseConfig["featureOverrides"];
  } catch {
    return {};
  }
};

const normalizeNullableStoredValue = (value: string | undefined) =>
  value?.trim() ? value : null;

/**
 * 本地授权配置使用 `app_setting` 做最小持久化。
 *
 * 当前版本没有远端授权后台，所以先把模式、状态和 override 落在本地。
 * 后续接后台时，这里只需要把“本地写入来源”从人工写入换成服务端同步即可。
 */
export const getStoredLicenseConfig = (): StoredLicenseConfig => {
  const settings = readAppSettingMap();
  const mode = settings.get(LICENSE_SETTING_KEYS.mode);
  const status = settings.get(LICENSE_SETTING_KEYS.status);

  return {
    mode: mode === "pro" ? "pro" : DEFAULT_LICENSE_CONFIG.mode,
    status: isKnownLicenseStatus(status) ? status : DEFAULT_LICENSE_CONFIG.status,
    expiresAt: normalizeNullableStoredValue(
      settings.get(LICENSE_SETTING_KEYS.expiresAt)
    ),
    lastSyncAt: normalizeNullableStoredValue(
      settings.get(LICENSE_SETTING_KEYS.lastSyncAt)
    ),
    featureOverrides: parseFeatureOverrides(
      settings.get(LICENSE_SETTING_KEYS.featureOverrides)
    ),
  };
};

const isKnownLicenseStatus = (value: string | undefined): value is LicenseStatus =>
  value === "unregistered" ||
  value === "pending" ||
  value === "active" ||
  value === "expired" ||
  value === "disabled";

export const saveStoredLicenseConfig = (input: LicenseConfigInput) => {
  const current = getStoredLicenseConfig();
  const nextConfig: StoredLicenseConfig = {
    mode: input.mode ?? current.mode,
    status: input.status ?? current.status,
    expiresAt:
      input.expiresAt !== undefined ? input.expiresAt : current.expiresAt,
    lastSyncAt:
      input.lastSyncAt !== undefined ? input.lastSyncAt : current.lastSyncAt,
    featureOverrides: input.featureOverrides ?? current.featureOverrides,
  };

  saveAppSettingValues({
    [LICENSE_SETTING_KEYS.mode]: nextConfig.mode,
    [LICENSE_SETTING_KEYS.status]: nextConfig.status,
    [LICENSE_SETTING_KEYS.expiresAt]: nextConfig.expiresAt ?? "",
    [LICENSE_SETTING_KEYS.lastSyncAt]: nextConfig.lastSyncAt ?? "",
    [LICENSE_SETTING_KEYS.featureOverrides]: JSON.stringify(
      nextConfig.featureOverrides
    ),
  });

  return nextConfig;
};

const mapRemoteSnapshotToLicenseConfig = (
  snapshot: RemoteLicenseSnapshot
): LicenseConfigInput => ({
  mode: snapshot.mode,
  status: snapshot.status,
  expiresAt: snapshot.expiresAt,
  lastSyncAt: snapshot.lastSyncAt,
  featureOverrides: snapshot.features,
});

const shouldSyncLicense = (
  config: StoredLicenseConfig,
  force: boolean
) => {
  if (force) {
    return true;
  }

  if (!config.lastSyncAt) {
    return true;
  }

  const lastSyncAtMs = Date.parse(config.lastSyncAt);
  if (Number.isNaN(lastSyncAtMs)) {
    return true;
  }

  return Date.now() - lastSyncAtMs >= LICENSE_SYNC_MIN_INTERVAL_MS;
};

/**
 * 远端同步策略：
 * - 默认走内置授权服务地址，也允许环境变量覆盖。
 * - 成功后把授权快照回写到本地缓存。
 * - 失败时保留本地缓存，不让单次网络故障直接打断整个应用。
 *
 * 这样 Electron/Next 本地端仍然以“本地快照”为授权真相，
 * 远端只是负责刷新这份快照。
 */
export const syncStoredLicenseFromRemote = async (options?: {
  force?: boolean;
}) => {
  const baseUrl = getLicenseServerBaseUrl();
  if (!baseUrl) {
    return getStoredLicenseConfig();
  }

  const currentConfig = getStoredLicenseConfig();
  if (!shouldSyncLicense(currentConfig, options?.force ?? false)) {
    return currentConfig;
  }

  const fingerprint = buildFingerprintSnapshot();
  const remoteSnapshot = await syncLicenseFromServer(baseUrl, {
    deviceId: fingerprint.deviceId,
    deviceName: fingerprint.deviceName,
    platform: fingerprint.platform,
    appVersion: getAppVersion(),
  });

  return saveStoredLicenseConfig(mapRemoteSnapshotToLicenseConfig(remoteSnapshot));
};

/**
 * 默认功能开启规则：
 * - `basic` 只包含基础功能。
 * - `pro` 自动包含基础 + 高级。
 *
 * override 总是后置，这样后台以后既可以“赠送单项高级功能”，
 * 也可以“在高级版里临时关闭某个功能”。
 */
const isFeatureEnabledByMode = (
  mode: LicenseMode,
  featureKey: LicenseFeatureKey
) => {
  if (mode === "pro") {
    return true;
  }

  return featureKey.startsWith("base.");
};

const resolveFeatureEnabled = (
  config: StoredLicenseConfig,
  featureKey: LicenseFeatureKey
) => {
  if (config.status === "disabled" || config.status === "unregistered") {
    return featureKey === "base.app_access";
  }

  if (config.status === "pending") {
    return featureKey === "base.app_access";
  }

  if (config.status === "expired") {
    return featureKey.startsWith("base.");
  }

  const override = config.featureOverrides[featureKey];
  if (typeof override === "boolean") {
    return override;
  }

  return isFeatureEnabledByMode(config.mode, featureKey);
};

const getModeLabel = (mode: LicenseMode) =>
  mode === "pro" ? "高级授权" : "基础授权";

const getStatusLabel = (status: LicenseStatus) => {
  switch (status) {
    case "active":
      return "已授权";
    case "pending":
      return "待管理员授权";
    case "expired":
      return "已过期";
    case "disabled":
      return "已禁用";
    case "unregistered":
      return "未注册";
    default:
      return "未知状态";
  }
};

const getStatusInstructions = (config: StoredLicenseConfig) => {
  switch (config.status) {
    case "active":
      return config.mode === "pro"
        ? "当前设备已开通高级授权，可使用基础能力和高级专业能力。"
        : "当前设备已开通基础授权，可使用基础工作台能力。";
    case "expired":
      return "当前授权已过期，系统已自动降级为基础只读/基础能力模式。";
    case "disabled":
      return "当前设备已被后台禁用，仅保留基础访问入口用于查看授权信息。";
    case "unregistered":
    case "pending":
    default:
      return "请将本机指纹发送给管理员，后台完成授权后客户端即可按功能粒度生效。";
  }
};

export const hasLicensedFeature = (featureKey: LicenseFeatureKey) =>
  resolveFeatureEnabled(getStoredLicenseConfig(), featureKey);

/**
 * 所有真正有业务含义的写操作或高级能力，都应走这一层显式断言。
 *
 * 这样后续加新功能时，不需要在接口里硬编码“是不是 pro”，
 * 只需要声明它依赖哪个 `featureKey` 即可。
 */
export const assertLicensedFeature = (featureKey: LicenseFeatureKey) => {
  if (hasLicensedFeature(featureKey)) {
    return;
  }

  const catalogEntry = LICENSE_FEATURE_CATALOG.find(
    (entry) => entry.key === featureKey
  );
  const featureName = catalogEntry?.name ?? featureKey;

  throw new LicenseAccessError(
    featureKey,
    `${featureName} 当前未授权，请联系管理员开通对应权限。`
  );
};

/**
 * 搜索能力需要把“产品级权限”翻译成“技术级搜索策略”。
 *
 * 规则：
 * - 基础授权始终退回关键词检索。
 * - 高级授权才允许走 Embedding / LLM 等高级策略。
 */
export const resolveSearchProviderByLicense = (
  requestedProvider: StorySearchProvider
): StorySearchProvider => {
  if (!hasLicensedFeature("pro.search_advanced")) {
    return "local_embedding";
  }

  return requestedProvider;
};

export const getAuthorizationSnapshot = async (options?: {
  forceSync?: boolean;
}): Promise<AuthorizationSnapshot> => {
  const deviceFingerprint = buildFingerprintSnapshot();
  let config = getStoredLicenseConfig();

  try {
    config = await syncStoredLicenseFromRemote({
      force: options?.forceSync ?? false,
    });
  } catch {
    /**
     * 授权页要尽量可打开：
     * - 如果远端同步失败，仍然展示本地缓存。
     * - 避免因为授权服务器短时不可达，用户连设备指纹都看不到。
     */
  }

  return {
    mode: config.mode,
    modeLabel: getModeLabel(config.mode),
    status: config.status,
    statusLabel: getStatusLabel(config.status),
    instructions: getStatusInstructions(config),
    expiresAt: config.expiresAt,
    lastSyncAt: config.lastSyncAt,
    deviceFingerprint,
    features: LICENSE_FEATURE_CATALOG.map((feature) => ({
      key: feature.key,
      name: feature.name,
      description: feature.description,
      includedInMode: feature.includedInMode,
      status: resolveFeatureEnabled(config, feature.key) ? "enabled" : "disabled",
      expiresAt: null,
    })),
  };
};
