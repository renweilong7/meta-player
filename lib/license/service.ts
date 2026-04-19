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
  mode: "unauthorized",
  status: "unauthorized",
  expiresAt: null,
  lastSyncAt: null,
  featureOverrides: {},
};
const LICENSE_SYNC_MIN_INTERVAL_MS = 60 * 1000;
const DEFAULT_LICENSE_SERVER_BASE_URL =
  "http://47.95.227.51:8787";

const parseIsoTimestamp = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
};

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
 * 默认值必须是“未授权”而不是“已授权”：
 * - 新设备首次启动前，远端服务还没确认它是谁。
 * - 如果这时本地默认就是 active，就会造成“未注册设备默认放行”。
 *
 * 所以这里的原则是：
 * - 只有远端授权服务明确返回 active，客户端才进入已授权状态。
 * - 任何未同步、同步失败、或本地没有历史授权记录的设备，都先视为未授权。
 */
export const getStoredLicenseConfig = (): StoredLicenseConfig => {
  const settings = readAppSettingMap();
  const mode = settings.get(LICENSE_SETTING_KEYS.mode);
  const status = settings.get(LICENSE_SETTING_KEYS.status);

  return {
    mode: mode === "authorized" ? "authorized" : DEFAULT_LICENSE_CONFIG.mode,
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
  value === "authorized" || value === "unauthorized";

const isRemoteAuthorized = (snapshot: RemoteLicenseSnapshot) =>
  stableValue(snapshot.status).toLowerCase() === "authorized" ||
  stableValue(snapshot.status).toLowerCase() === "active";

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
  mode: isRemoteAuthorized(snapshot) ? "authorized" : "unauthorized",
  status: isRemoteAuthorized(snapshot) ? "authorized" : "unauthorized",
  expiresAt: snapshot.expiresAt,
  lastSyncAt: snapshot.lastSyncAt,
  featureOverrides: {},
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

const resolveEffectiveLicenseConfig = (
  config: StoredLicenseConfig
): StoredLicenseConfig => {
  const expiresAtMs = parseIsoTimestamp(config.expiresAt);

  if (
    config.status === "authorized" &&
    expiresAtMs !== null &&
    Date.now() >= expiresAtMs
  ) {
    return {
      ...config,
      mode: "unauthorized",
      status: "unauthorized",
    };
  }

  return config;
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

const resolveFeatureEnabled = (
  config: StoredLicenseConfig,
  featureKey: LicenseFeatureKey
) => {
  if (featureKey === "base.app_access") {
    return true;
  }

  return config.status === "authorized";
};

const getModeLabel = (mode: LicenseMode) =>
  mode === "authorized" ? "已授权" : "未授权";

const getStatusLabel = (status: LicenseStatus) => {
  return status === "authorized" ? "已授权" : "未授权";
};

const getStatusInstructions = (config: StoredLicenseConfig) => {
  if (config.status === "authorized") {
    return "当前设备已授权，全部功能已开放。";
  }

  return "当前设备未授权，请将本机指纹发送给管理员，授权后即可开放全部功能。";
};

export const hasLicensedFeature = (featureKey: LicenseFeatureKey) =>
  resolveFeatureEnabled(
    resolveEffectiveLicenseConfig(getStoredLicenseConfig()),
    featureKey
  );

/**
 * 所有真正有业务含义的写操作或高级能力，都应走这一层显式断言。
 *
 * 这样后续加新功能时，不需要在接口里硬编码“是不是已授权”，
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
 * 当前策略：
 * - 已授权：放行用户选择的搜索方案。
 * - 未授权：统一退回关键词检索，避免高级搜索能力进入未授权状态。
 */
export const resolveSearchProviderByLicense = (
  requestedProvider: StorySearchProvider
): StorySearchProvider => {
  if (!hasLicensedFeature("pro.search_advanced")) {
    return "keyword";
  }

  return requestedProvider;
};

export const getAuthorizationSnapshot = async (options?: {
  forceSync?: boolean;
}): Promise<AuthorizationSnapshot> => {
  const deviceFingerprint = buildFingerprintSnapshot();
  let config = resolveEffectiveLicenseConfig(getStoredLicenseConfig());

  try {
    config = resolveEffectiveLicenseConfig(
      await syncStoredLicenseFromRemote({
        force: options?.forceSync ?? false,
      })
    );
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
