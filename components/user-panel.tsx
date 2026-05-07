"use client";

import { FileArchive, User } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface UserPanelProps {
  isExportingDiagnostics?: boolean;
  onExportDiagnostics?: () => void | Promise<void>;
}

export function UserPanel({
  isExportingDiagnostics = false,
  onExportDiagnostics,
}: UserPanelProps) {
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-background">
      <div className="border-b border-border px-8 py-6">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <User className="h-4 w-4" />
            用户中心
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">问题诊断</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              导出本机运行日志，便于开发者排查问题。
            </p>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
          <Card className="gap-0">
            <CardHeader className="border-b border-border">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileArchive className="h-4 w-4 text-primary" />
                问题诊断
              </CardTitle>
              <CardDescription>
                导出本机诊断包，包含服务端请求日志、客户端异常日志和桌面启动日志。
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/30 p-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">导出诊断日志</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    建议在问题复现后立即导出，再把生成目录发送给开发者。
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void onExportDiagnostics?.()}
                  disabled={isExportingDiagnostics}
                >
                  <FileArchive className="h-4 w-4" />
                  {isExportingDiagnostics ? "导出中..." : "导出诊断包"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
