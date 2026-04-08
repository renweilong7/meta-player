"use client";

import { useEffect, useMemo, useState } from "react";
import {
  PersistedAiUsageRecord,
  PersistedAiUsageSnapshot,
} from "@/lib/persistence/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";

const PAGE_SIZE = 20;

const actionLabels: Record<PersistedAiUsageRecord["action"], string> = {
  story_outline_generation: "剧情大纲",
  story_outline_embedding_index: "剧情索引",
  story_outline_embedding_search: "剧情检索向量",
  story_outline_llm_search: "剧情检索重排",
  scene_shot_analysis: "镜头解读",
  project_script_tts: "文案 TTS",
};

const providerLabels: Record<PersistedAiUsageRecord["provider"], string> = {
  openai_compatible: "OpenAI 兼容",
  dashscope: "DashScope",
  local_embedding: "本地 Embedding",
  system_tts: "系统 TTS",
};

const timeFilterOptions = [
  { value: "all", label: "全部时间" },
  { value: "1h", label: "近 1 小时" },
  { value: "6h", label: "近 6 小时" },
  { value: "1d", label: "近 1 天" },
  { value: "7d", label: "近 7 天" },
] as const;

type TimeFilterValue = (typeof timeFilterOptions)[number]["value"];

const formatNumber = (value: number | null) =>
  value === null ? "-" : new Intl.NumberFormat("zh-CN").format(value);

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));

const summaryItems = (snapshot: PersistedAiUsageSnapshot) => [
  {
    label: "总调用次数",
    value: snapshot.summary.totalCalls,
    helper: `${snapshot.summary.successCalls} 次成功 / ${snapshot.summary.errorCalls} 次失败`,
  },
  {
    label: "输入 Token",
    value: snapshot.summary.totalInputTokens,
    helper: "累计请求 token",
  },
  {
    label: "输出 Token",
    value: snapshot.summary.totalOutputTokens,
    helper: "累计响应 token",
  },
  {
    label: "总 Token",
    value: snapshot.summary.totalTokens,
    helper: "输入 + 输出",
  },
];

const getTimeFilterThreshold = (value: TimeFilterValue) => {
  const now = Date.now();

  switch (value) {
    case "1h":
      return now - 60 * 60 * 1000;
    case "6h":
      return now - 6 * 60 * 60 * 1000;
    case "1d":
      return now - 24 * 60 * 60 * 1000;
    case "7d":
      return now - 7 * 24 * 60 * 60 * 1000;
    default:
      return null;
  }
};

export function UsagePanel({
  usage,
  isLoading,
}: {
  usage: PersistedAiUsageSnapshot;
  isLoading?: boolean;
}) {
  const [timeFilter, setTimeFilter] = useState<TimeFilterValue>("all");
  const [modelFilter, setModelFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);

  const modelOptions = useMemo(
    () =>
      [...new Set(usage.records.map((record) => record.model.trim()).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right, "zh-CN")),
    [usage.records]
  );

  const filteredRecords = useMemo(() => {
    const threshold = getTimeFilterThreshold(timeFilter);

    return usage.records.filter((record) => {
      const matchesTime =
        threshold === null || new Date(record.createdAt).getTime() >= threshold;
      const matchesModel = modelFilter === "all" || record.model === modelFilter;

      return matchesTime && matchesModel;
    });
  }, [modelFilter, timeFilter, usage.records]);

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / PAGE_SIZE));

  useEffect(() => {
    setCurrentPage(1);
  }, [modelFilter, timeFilter]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const pagedRecords = useMemo(() => {
    const startIndex = (currentPage - 1) * PAGE_SIZE;
    return filteredRecords.slice(startIndex, startIndex + PAGE_SIZE);
  }, [currentPage, filteredRecords]);

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden bg-background">
      <ScrollArea className="h-full">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-6">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              AI 用量统计
            </h1>
            <p className="text-sm text-muted-foreground">
              这里会记录每次模型调用的动作、模型、来源、输入输出 token 和执行结果。
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {summaryItems(usage).map((item) => (
              <Card key={item.label}>
                <CardHeader className="gap-1">
                  <CardDescription>{item.label}</CardDescription>
                  <CardTitle className="text-3xl">{formatNumber(item.value)}</CardTitle>
                </CardHeader>
                <CardContent className="pt-0 text-sm text-muted-foreground">
                  {item.helper}
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="min-h-[420px]">
            <CardHeader className="gap-3">
              <div>
                <CardTitle>调用明细</CardTitle>
                <CardDescription>
                  {isLoading
                    ? "正在刷新最新用量记录..."
                    : `当前筛选后共 ${filteredRecords.length} 条，分页展示，每页 ${PAGE_SIZE} 条`}
                </CardDescription>
              </div>
              <div className="flex flex-col gap-3 md:flex-row">
                <Select
                  value={timeFilter}
                  onValueChange={(value) => setTimeFilter(value as TimeFilterValue)}
                >
                  <SelectTrigger className="w-full md:w-[150px]">
                    <SelectValue placeholder="选择时间范围" />
                  </SelectTrigger>
                  <SelectContent>
                    {timeFilterOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={modelFilter} onValueChange={setModelFilter}>
                  <SelectTrigger className="w-full md:w-[260px]">
                    <SelectValue placeholder="筛选模型" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部模型</SelectItem>
                    {modelOptions.map((model) => (
                      <SelectItem key={model} value={model}>
                        {model}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {filteredRecords.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
                  当前筛选条件下暂无调用记录。
                </div>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>时间</TableHead>
                        <TableHead>动作</TableHead>
                        <TableHead>来源</TableHead>
                        <TableHead>模型</TableHead>
                        <TableHead>输入</TableHead>
                        <TableHead>输出</TableHead>
                        <TableHead>总量</TableHead>
                        <TableHead>状态</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagedRecords.map((record) => (
                        <TableRow key={record.id}>
                          <TableCell>{formatDateTime(record.createdAt)}</TableCell>
                          <TableCell>{actionLabels[record.action]}</TableCell>
                          <TableCell>{providerLabels[record.provider]}</TableCell>
                          <TableCell className="max-w-[260px] truncate">{record.model}</TableCell>
                          <TableCell>{formatNumber(record.inputTokens)}</TableCell>
                          <TableCell>{formatNumber(record.outputTokens)}</TableCell>
                          <TableCell>{formatNumber(record.totalTokens)}</TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                record.status === "success" ? "secondary" : "destructive"
                              }
                            >
                              {record.status === "success" ? "成功" : "失败"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>

                  <div className="flex flex-col gap-3 border-t border-border pt-4 text-sm md:flex-row md:items-center md:justify-between">
                    <span className="text-muted-foreground">
                      第 {currentPage} / {totalPages} 页
                    </span>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={currentPage <= 1}
                        onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                      >
                        上一页
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={currentPage >= totalPages}
                        onClick={() =>
                          setCurrentPage((page) => Math.min(totalPages, page + 1))
                        }
                      >
                        下一页
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </div>
  );
}
