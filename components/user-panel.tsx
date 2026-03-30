"use client";

import { useState } from "react";
import {
  CheckCheck,
  Copy,
  Crown,
  MonitorSmartphone,
  RefreshCw,
  Shield,
} from "lucide-react";
import { AuthorizationSnapshot, LicenseFeatureStatus, LicenseStatus } from "@/lib/license/types";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface UserPanelProps {
  authorization?: AuthorizationSnapshot | null;
  isRefreshingAuthorization?: boolean;
  onRefreshAuthorization?: () => void | Promise<void>;
}

export function UserPanel({
  authorization = null,
  isRefreshingAuthorization = false,
  onRefreshAuthorization,
}: UserPanelProps) {
  const [hasCopiedFingerprint, setHasCopiedFingerprint] = useState(false);

  const statusBadgeVariantByStatus: Record<
    LicenseStatus,
    "default" | "secondary" | "destructive" | "outline"
  > = {
    active: "default",
    pending: "secondary",
    unregistered: "secondary",
    expired: "destructive",
    disabled: "destructive",
  };
  const featureBadgeVariantByStatus: Record<
    LicenseFeatureStatus,
    "default" | "outline"
  > = {
    enabled: "default",
    disabled: "outline",
  };

  const handleCopyFingerprint = async () => {
    if (!authorization?.deviceFingerprint.fingerprintText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(
        authorization.deviceFingerprint.fingerprintText
      );
      setHasCopiedFingerprint(true);
      window.setTimeout(() => setHasCopiedFingerprint(false), 2000);
    } catch {
      setHasCopiedFingerprint(false);
    }
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-background">
      <div className="border-b border-border px-8 py-6">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Shield className="h-4 w-4" />
            用户中心
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">设备授权</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              查看本机指纹和功能授权状态，联系管理员完成后续开通。
            </p>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
          <Card className="gap-0">
            <CardHeader className="border-b border-border">
              <CardTitle className="flex items-center gap-2 text-base">
                <Shield className="h-4 w-4 text-primary" />
                设备授权
              </CardTitle>
              <CardDescription>
                展示本机指纹和后台下发的功能授权状态，便于联系管理员完成机器授权。
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              {!authorization ? (
                <div className="rounded-lg border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
                  正在加载设备授权信息...
                </div>
              ) : (
                <div className="flex flex-col gap-6">
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
                    <div className="rounded-xl border border-border bg-muted/30 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                            <MonitorSmartphone className="h-4 w-4 text-primary" />
                            本机指纹
                          </div>
                          <p className="text-sm text-muted-foreground">
                            将该指纹发送给管理员，后台可按设备维度控制功能授权。
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={handleCopyFingerprint}
                        >
                          {hasCopiedFingerprint ? (
                            <CheckCheck className="h-4 w-4" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                          {hasCopiedFingerprint ? "已复制" : "复制指纹"}
                        </Button>
                      </div>
                      <div className="mt-3 flex justify-end">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void onRefreshAuthorization?.()}
                          disabled={isRefreshingAuthorization}
                        >
                          <RefreshCw
                            className={
                              isRefreshingAuthorization ? "h-4 w-4 animate-spin" : "h-4 w-4"
                            }
                          />
                          {isRefreshingAuthorization ? "同步中..." : "刷新授权"}
                        </Button>
                      </div>
                      <div className="mt-4 rounded-lg bg-background px-4 py-3 font-mono text-xs leading-6 text-foreground">
                        {authorization.deviceFingerprint.fingerprintText}
                      </div>
                      <div className="mt-4 grid gap-3 text-sm text-muted-foreground md:grid-cols-2">
                        <div>
                          <p className="text-xs uppercase tracking-[0.14em]">
                            设备名
                          </p>
                          <p className="mt-1 text-sm text-foreground">
                            {authorization.deviceFingerprint.deviceName}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-[0.14em]">
                            平台
                          </p>
                          <p className="mt-1 text-sm text-foreground">
                            {authorization.deviceFingerprint.platform}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-border bg-card p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                            <Crown className="h-4 w-4 text-primary" />
                            当前授权模式
                          </p>
                          <p className="mt-1 text-lg font-semibold text-foreground">
                            {authorization.modeLabel}
                          </p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {authorization.instructions}
                          </p>
                        </div>
                        <Badge variant="outline">{authorization.mode.toUpperCase()}</Badge>
                      </div>
                      <div className="mt-4 border-t border-border pt-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-foreground">
                              当前授权状态
                            </p>
                            <p className="mt-1 text-sm text-muted-foreground">
                              授权状态决定功能是否可执行，到期后会自动按策略降级。
                            </p>
                          </div>
                          <Badge
                            variant={
                              statusBadgeVariantByStatus[authorization.status]
                            }
                          >
                            {authorization.statusLabel}
                          </Badge>
                        </div>
                        <div className="mt-4 space-y-3 text-sm">
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-muted-foreground">到期时间</span>
                            <span className="text-foreground">
                              {authorization.expiresAt ?? "由后台控制"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-muted-foreground">最近同步</span>
                            <span className="text-foreground">
                              {authorization.lastSyncAt ?? "尚未同步"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-muted-foreground">指纹算法</span>
                            <span className="max-w-[14rem] truncate text-right text-foreground">
                              {authorization.deviceFingerprint.algorithm}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-border bg-card p-4">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        功能授权粒度
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        后台可针对每个功能单独设置启用状态和有效期。
                      </p>
                    </div>
                    <div className="mt-4 grid gap-3">
                      {authorization.features.map((feature) => (
                        <div
                          key={feature.key}
                          className="flex flex-col gap-3 rounded-lg border border-border px-4 py-3 md:flex-row md:items-center md:justify-between"
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-foreground">
                                {feature.name}
                              </span>
                              <Badge
                                variant={
                                  featureBadgeVariantByStatus[feature.status]
                                }
                              >
                                {feature.status === "enabled"
                                  ? "已启用"
                                  : "未启用"}
                              </Badge>
                              <Badge variant="outline">
                                默认归属 {feature.includedInMode === "pro" ? "高级" : "基础"}
                              </Badge>
                            </div>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {feature.description}
                            </p>
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {feature.expiresAt
                              ? `有效期至 ${feature.expiresAt}`
                              : "有效期由后台控制"}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
