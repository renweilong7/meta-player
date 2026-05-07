import { arch, hostname, platform, release } from "node:os";
import { LICENSE_FEATURE_CATALOG } from "@/lib/license/feature-catalog";
import {
  AuthorizationSnapshot,
  DeviceFingerprintSnapshot,
  LicenseConfigInput,
  LicenseFeatureKey,
  StoredLicenseConfig,
} from "@/lib/license/types";
import { StorySearchProvider } from "@/lib/persistence/types";

const OPEN_ACCESS_CONFIG: StoredLicenseConfig = {
  mode: "authorized",
  status: "authorized",
  expiresAt: null,
  lastSyncAt: null,
  featureOverrides: {},
};

export class LicenseAccessError extends Error {
  featureKey: LicenseFeatureKey;

  constructor(featureKey: LicenseFeatureKey, message: string) {
    super(message);
    this.name = "LicenseAccessError";
    this.featureKey = featureKey;
  }
}

const buildLocalDeviceSnapshot = (): DeviceFingerprintSnapshot => ({
  deviceId: "open-access",
  fingerprintText: "OPEN-ACCESS",
  algorithm: "none",
  collectedAt: new Date().toISOString(),
  deviceName: hostname(),
  platform: `${platform()} ${release()} (${arch()})`,
});

export const getStoredLicenseConfig = (): StoredLicenseConfig => ({
  ...OPEN_ACCESS_CONFIG,
});

export const saveStoredLicenseConfig = (_input: LicenseConfigInput) =>
  getStoredLicenseConfig();

export const syncStoredLicenseFromRemote = async () => getStoredLicenseConfig();

export const hasLicensedFeature = (_featureKey: LicenseFeatureKey) => true;

export const assertLicensedFeature = (_featureKey: LicenseFeatureKey) => {};

export const resolveSearchProviderByLicense = (
  requestedProvider: StorySearchProvider
): StorySearchProvider => requestedProvider;

export const getAuthorizationSnapshot =
  async (): Promise<AuthorizationSnapshot> => ({
    mode: "authorized",
    modeLabel: "开放使用",
    status: "authorized",
    statusLabel: "开放使用",
    instructions: "授权功能已移除，应用可直接使用全部功能。",
    expiresAt: null,
    lastSyncAt: null,
    deviceFingerprint: buildLocalDeviceSnapshot(),
    features: LICENSE_FEATURE_CATALOG.map((feature) => ({
      key: feature.key,
      name: feature.name,
      description: feature.description,
      includedInMode: feature.includedInMode,
      status: "enabled",
      expiresAt: null,
    })),
  });
