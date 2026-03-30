"use client";

import { ArrowRight, QrCode, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

interface UnauthorizedHomeProps {
  onOpenUserPage: () => void;
}

const adminQrUrl = process.env.NEXT_PUBLIC_LICENSE_ADMIN_QR_URL?.trim() ?? "";
const adminContact = process.env.NEXT_PUBLIC_LICENSE_ADMIN_CONTACT?.trim() ?? "";

export function UnauthorizedHome({
  onOpenUserPage,
}: UnauthorizedHomeProps) {
  return (
    <div className="flex h-full min-w-0 flex-1 items-center justify-center px-6 py-8">
      <div className="grid w-full max-w-6xl gap-6 xl:grid-cols-[minmax(0,1.5fr)_24rem]">
        <section className="rounded-3xl border border-border bg-card/80 p-8 shadow-sm">
          <div className="flex items-center gap-3 text-sm font-medium text-muted-foreground">
            <ShieldAlert className="h-4 w-4 text-primary" />
            授权状态提醒
          </div>
          <div className="mt-4 max-w-2xl">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              当前设备未授权
            </h1>
            <p className="mt-4 text-sm leading-7 text-muted-foreground">
              当前设备还不能访问项目、素材、播放和设置等业务能力。请进入“用户”页面查看
              设备指纹和授权状态，并联系管理员完成开通。
            </p>
          </div>

          <div className="mt-8 rounded-2xl border border-border bg-muted/30 p-5">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              当前说明
            </p>
            <div className="mt-3 space-y-2 text-sm text-foreground">
              <p>状态：未授权</p>
              <p>可访问页面：首页、用户</p>
              <p>业务功能：已全部收起，等待管理员开通</p>
              {adminContact ? <p>联系管理员：{adminContact}</p> : null}
            </div>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button type="button" onClick={onOpenUserPage}>
              查看授权详情
              <ArrowRight className="h-4 w-4" />
            </Button>
            <p className="text-sm text-muted-foreground">
              授权开通后，在用户页点击“刷新授权”即可同步最新状态。
            </p>
          </div>
        </section>

        <aside className="rounded-3xl border border-dashed border-border bg-card/60 p-6">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <QrCode className="h-4 w-4 text-primary" />
            管理员二维码
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            这里预留给管理员二维码或客服联系方式。后续打包时可以通过环境变量注入图片地址，
            不需要改业务代码。
          </p>

          <div className="mt-6 flex items-center justify-center rounded-2xl border border-border bg-background p-4">
            {adminQrUrl ? (
              <img
                src={adminQrUrl}
                alt="管理员联系二维码"
                className="h-64 w-64 rounded-xl object-contain"
              />
            ) : (
              <div className="flex h-64 w-64 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 text-center">
                <QrCode className="h-10 w-10 text-muted-foreground" />
                <p className="mt-4 max-w-[12rem] text-sm leading-6 text-muted-foreground">
                  未配置二维码
                </p>
                <p className="mt-1 max-w-[14rem] text-xs leading-5 text-muted-foreground">
                  打包时注入 `NEXT_PUBLIC_LICENSE_ADMIN_QR_URL`
                </p>
              </div>
            )}
          </div>

          <div className="mt-4 rounded-2xl bg-muted/30 p-4 text-xs leading-6 text-muted-foreground">
            可选注入项：
            <br />
            `NEXT_PUBLIC_LICENSE_ADMIN_QR_URL`
            <br />
            `NEXT_PUBLIC_LICENSE_ADMIN_CONTACT`
          </div>
        </aside>
      </div>
    </div>
  );
}
