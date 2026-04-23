"use client";

import { useState } from "react";
import {
  FolderOpen,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  Bot,
  Save,
  Sparkles,
  RefreshCw,
  Clapperboard,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CrossAssetSwitchMode,
  SearchAiProvider,
  StorySearchProvider,
  TextAiProvider,
  VisionAiProvider,
} from "@/lib/persistence/types";
import {
  getEditableProviderApiKey,
  getEditableProviderBaseUrl,
  getEditableProviderSearchModelName,
  getEditableProviderTextModelName,
  getDefaultProviderBaseUrl,
  getProviderDisplayName,
} from "@/lib/ai/provider-config";

export interface AppSettingsValues {
  materialSavePath: string;
  defaultManagedImport: boolean;
  ffmpegExecutablePath: string;
  ffprobeExecutablePath: string;
  aiTextProvider: TextAiProvider;
  openaiApiBaseUrl: string;
  openaiApiKey: string;
  grok2apiBaseUrl: string;
  grok2apiApiKey: string;
  openaiTextModelName: string;
  grok2apiTextModelName: string;
  aiVisionProvider: VisionAiProvider;
  aiVisionBaseUrl: string;
  aiVisionApiKey: string;
  aiVisionModelName: string;
  aiVisionFps: string;
  geminiVisionBaseUrl: string;
  geminiVisionApiKey: string;
  geminiVisionModelName: string;
  storySearchProvider: StorySearchProvider;
  aiSearchProvider: SearchAiProvider;
  openaiSearchModelName: string;
  grok2apiSearchModelName: string;
  localTtsModelName: string;
  autoGenerateProjectScriptTts: boolean;
  crossAssetSwitchMode: CrossAssetSwitchMode;
}

interface SettingsPanelProps {
  values: AppSettingsValues;
  hasPendingChanges?: boolean;
  isSaving?: boolean;
  isCheckingMediaTools?: boolean;
  mediaToolsCheckResult?: {
    ffmpeg: {
      ok: boolean;
      resolvedPath: string | null;
      version: string | null;
      message: string;
    };
    ffprobe: {
      ok: boolean;
      resolvedPath: string | null;
      version: string | null;
      message: string;
    };
  } | null;
  onChangeField: (
    field: keyof AppSettingsValues,
    value: string | boolean
  ) => void;
  onSave: () => void;
  onCheckMediaTools?: () => void;
  onBrowseMaterialDirectory?: () => void;
}

export function SettingsPanel({
  values,
  hasPendingChanges = false,
  isSaving = false,
  isCheckingMediaTools = false,
  mediaToolsCheckResult = null,
  onChangeField,
  onSave,
  onCheckMediaTools,
  onBrowseMaterialDirectory,
}: SettingsPanelProps) {
  const [showApiKey, setShowApiKey] = useState(false);
  const [showVisionApiKey, setShowVisionApiKey] = useState(false);
  const [showGeminiVisionApiKey, setShowGeminiVisionApiKey] = useState(false);
  const normalizedValues: AppSettingsValues = {
    materialSavePath: values.materialSavePath ?? "",
    defaultManagedImport: values.defaultManagedImport ?? false,
    ffmpegExecutablePath: values.ffmpegExecutablePath ?? "",
    ffprobeExecutablePath: values.ffprobeExecutablePath ?? "",
    aiTextProvider: values.aiTextProvider ?? "openai_compatible",
    openaiApiBaseUrl: values.openaiApiBaseUrl ?? "",
    openaiApiKey: values.openaiApiKey ?? "",
    grok2apiBaseUrl: values.grok2apiBaseUrl ?? "",
    grok2apiApiKey: values.grok2apiApiKey ?? "",
    openaiTextModelName: values.openaiTextModelName ?? "",
    grok2apiTextModelName: values.grok2apiTextModelName ?? "",
    aiVisionProvider: values.aiVisionProvider ?? "dashscope",
    aiVisionBaseUrl: values.aiVisionBaseUrl ?? "",
    aiVisionApiKey: values.aiVisionApiKey ?? "",
    aiVisionModelName: values.aiVisionModelName ?? "",
    aiVisionFps: values.aiVisionFps ?? "2",
    geminiVisionBaseUrl: values.geminiVisionBaseUrl ?? "",
    geminiVisionApiKey: values.geminiVisionApiKey ?? "",
    geminiVisionModelName: values.geminiVisionModelName ?? "",
    storySearchProvider: values.storySearchProvider ?? "keyword",
    aiSearchProvider: values.aiSearchProvider ?? "openai_compatible",
    openaiSearchModelName: values.openaiSearchModelName ?? "",
    grok2apiSearchModelName: values.grok2apiSearchModelName ?? "",
    localTtsModelName: values.localTtsModelName ?? "Tingting",
    autoGenerateProjectScriptTts: values.autoGenerateProjectScriptTts ?? true,
    crossAssetSwitchMode: values.crossAssetSwitchMode ?? "frame_hold",
  };
  const textProviderBaseUrlPlaceholder = getDefaultProviderBaseUrl(
    normalizedValues.aiTextProvider
  );
  const textProviderName = getProviderDisplayName(normalizedValues.aiTextProvider);
  const searchProviderName = getProviderDisplayName(normalizedValues.aiSearchProvider);
  const editableTextProviderBaseUrl = getEditableProviderBaseUrl(
    normalizedValues,
    normalizedValues.aiTextProvider
  );
  const editableTextProviderApiKey = getEditableProviderApiKey(
    normalizedValues,
    normalizedValues.aiTextProvider
  );
  const editableTextProviderModelName = getEditableProviderTextModelName(
    normalizedValues,
    normalizedValues.aiTextProvider
  );
  const editableSearchProviderModelName = getEditableProviderSearchModelName(
    normalizedValues,
    normalizedValues.aiSearchProvider
  );

  const handleCurrentProviderBaseUrlChange = (value: string) => {
    onChangeField(
      normalizedValues.aiTextProvider === "grok2api"
        ? "grok2apiBaseUrl"
        : "openaiApiBaseUrl",
      value
    );
  };

  const handleCurrentProviderApiKeyChange = (value: string) => {
    onChangeField(
      normalizedValues.aiTextProvider === "grok2api"
        ? "grok2apiApiKey"
        : "openaiApiKey",
      value
    );
  };

  const handleCurrentProviderTextModelNameChange = (value: string) => {
    onChangeField(
      normalizedValues.aiTextProvider === "grok2api"
        ? "grok2apiTextModelName"
        : "openaiTextModelName",
      value
    );
  };

  const handleCurrentSearchProviderModelNameChange = (value: string) => {
    onChangeField(
      normalizedValues.aiSearchProvider === "grok2api"
        ? "grok2apiSearchModelName"
        : "openaiSearchModelName",
      value
    );
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-background">
      <div className="border-b border-border px-8 py-6">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Sparkles className="h-4 w-4" />
            系统配置
          </div>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">设置</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                先完成基础配置，后续可直接接入持久化和系统能力。
              </p>
            </div>
            <Button onClick={onSave} disabled={!hasPendingChanges || isSaving}>
              <Save className="h-4 w-4" />
              {isSaving ? "保存中..." : "保存设置"}
            </Button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
          <Card className="gap-0">
            <CardHeader className="border-b border-border">
              <CardTitle className="flex items-center gap-2 text-base">
                <FolderOpen className="h-4 w-4 text-primary" />
                存储设置
              </CardTitle>
              <CardDescription>
                设置应用保存素材的位置，方便集中管理项目文件和处理结果。
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="material-save-path">素材保存地址</FieldLabel>
                  <FieldContent>
                    <div className="flex flex-col gap-3 md:flex-row">
                      <Input
                        id="material-save-path"
                        value={normalizedValues.materialSavePath}
                        onChange={(event) =>
                          onChangeField("materialSavePath", event.target.value)
                        }
                        placeholder="/Users/renyi/Movies/meta-player-assets"
                        className="h-10"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="md:w-auto"
                        onClick={onBrowseMaterialDirectory}
                      >
                        <FolderOpen className="h-4 w-4" />
                        选择目录
                      </Button>
                    </div>
                    <FieldDescription>
                      建议选择一个空间充足、便于查找的本地目录。后续导入的素材和相关结果会优先保存在这里。
                    </FieldDescription>
                  </FieldContent>
                </Field>

                <Field>
                  <FieldLabel htmlFor="default-managed-import">
                    默认托管导入素材
                  </FieldLabel>
                  <FieldContent>
                    <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-4 py-3">
                      <div className="space-y-1">
                        <p className="text-sm text-foreground">
                          导入时复制到素材库
                        </p>
                        <p className="text-sm text-muted-foreground">
                          开启后，新导入素材会复制到应用托管目录；关闭后默认直接引用原文件。
                        </p>
                      </div>
                      <Switch
                        id="default-managed-import"
                        checked={normalizedValues.defaultManagedImport}
                        onCheckedChange={(checked) =>
                          onChangeField("defaultManagedImport", checked)
                        }
                      />
                    </div>
                    <FieldDescription>
                      关闭更节省磁盘空间；开启更适合需要完全自托管素材的项目。
                    </FieldDescription>
                  </FieldContent>
                </Field>
              </FieldGroup>
            </CardContent>
          </Card>

          <Card className="gap-0">
            <CardHeader className="border-b border-border">
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4 text-primary" />
                AI 服务
              </CardTitle>
              <CardDescription>
                支持为文本模型和大模型剧情搜索分别选择 OpenAI 兼容链路或 grok2api 链路。
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <FieldGroup>
                <div className="rounded-lg border border-border/70 p-4">
                  <div className="mb-4">
                    <p className="text-sm font-medium text-foreground">文本模型</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      用于剧情大纲提取等通用文本任务。
                    </p>
                  </div>
                  <Field>
                    <FieldLabel htmlFor="ai-text-provider">文本模型 Provider</FieldLabel>
                    <FieldContent>
                      <Select
                        value={normalizedValues.aiTextProvider}
                        onValueChange={(value) =>
                          onChangeField("aiTextProvider", value as TextAiProvider)
                        }
                      >
                        <SelectTrigger id="ai-text-provider" className="h-10 w-full">
                          <SelectValue placeholder="选择文本模型 Provider" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="openai_compatible">OpenAI 兼容</SelectItem>
                          <SelectItem value="grok2api">grok2api</SelectItem>
                        </SelectContent>
                      </Select>
                      <FieldDescription>
                        控制剧情大纲提取等文本任务走哪条模型链路。
                      </FieldDescription>
                    </FieldContent>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="ai-api-base-url">
                      文本模型 Base URL
                    </FieldLabel>
                    <FieldContent>
                      <div className="relative">
                        <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="ai-api-base-url"
                          value={editableTextProviderBaseUrl}
                          onChange={(event) =>
                            handleCurrentProviderBaseUrlChange(event.target.value)
                          }
                          placeholder={textProviderBaseUrlPlaceholder}
                          className="h-10 pl-9"
                        />
                      </div>
                      <FieldDescription>
                        当前 Provider 为 {textProviderName}，兼容 OpenAI 格式即可，例如官方接口、自部署网关或本地 grok2api 服务。
                      </FieldDescription>
                    </FieldContent>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="ai-model-name">文本模型名称</FieldLabel>
                    <FieldContent>
                      <div className="relative">
                        <Bot className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="ai-model-name"
                          value={editableTextProviderModelName}
                          onChange={(event) =>
                            handleCurrentProviderTextModelNameChange(event.target.value)
                          }
                          placeholder="gpt-4o-mini"
                          className="h-10 pl-9"
                        />
                      </div>
                      <FieldDescription>
                        指定用于提取剧情大纲等纯文本任务的模型名称。
                      </FieldDescription>
                    </FieldContent>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="ai-api-key">文本模型 API Key</FieldLabel>
                    <FieldContent>
                      <div className="flex gap-3">
                        <div className="relative flex-1">
                          <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            id="ai-api-key"
                            value={editableTextProviderApiKey}
                            onChange={(event) =>
                              handleCurrentProviderApiKeyChange(event.target.value)
                            }
                            type={showApiKey ? "text" : "password"}
                            placeholder="sk-..."
                            className="h-10 pl-9 pr-11"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="absolute right-1 top-1 h-8 w-8"
                            onClick={() => setShowApiKey((current) => !current)}
                            aria-label={
                              showApiKey
                                ? "隐藏文本模型 API Key"
                                : "显示文本模型 API Key"
                            }
                          >
                            {showApiKey ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>
                      <FieldDescription>
                        文本任务单独使用的 API Key。
                      </FieldDescription>
                    </FieldContent>
                  </Field>
                </div>

                <div className="rounded-lg border border-border/70 p-4">
                  <div className="mb-4">
                    <p className="text-sm font-medium text-foreground">
                      剧情搜索
                    </p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      配置剧情搜索策略。当前保留关键词检索和直接大模型搜索两条路径。
                    </p>
                  </div>
                  <Field>
                    <FieldLabel htmlFor="story-search-provider">剧情搜索方案</FieldLabel>
                    <FieldContent>
                      <Select
                        value={normalizedValues.storySearchProvider}
                        onValueChange={(value) =>
                          onChangeField("storySearchProvider", value as StorySearchProvider)
                        }
                      >
                        <SelectTrigger id="story-search-provider" className="h-10 w-full">
                          <SelectValue placeholder="选择剧情搜索方案" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="keyword">关键词检索</SelectItem>
                          <SelectItem value="llm">直接大模型搜索</SelectItem>
                        </SelectContent>
                      </Select>
                      <FieldDescription>
                        关键词检索不依赖额外模型；大模型搜索会调用文本模型对候选剧情片段进行理解和排序。
                      </FieldDescription>
                    </FieldContent>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="ai-search-provider">
                      大模型剧情搜索 Provider
                    </FieldLabel>
                    <FieldContent>
                      <Select
                        value={normalizedValues.aiSearchProvider}
                        onValueChange={(value) =>
                          onChangeField("aiSearchProvider", value as SearchAiProvider)
                        }
                      >
                        <SelectTrigger id="ai-search-provider" className="h-10 w-full">
                          <SelectValue placeholder="选择大模型搜索 Provider" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="openai_compatible">OpenAI 兼容</SelectItem>
                          <SelectItem value="grok2api">grok2api</SelectItem>
                        </SelectContent>
                      </Select>
                      <FieldDescription>
                        当前 Provider 为 {searchProviderName}。它会自动读取该 Provider 自己保存的 Base URL 和 API Key，不会覆盖另一套配置。
                      </FieldDescription>
                    </FieldContent>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="ai-search-model-name">
                      大模型搜索模型名称
                    </FieldLabel>
                    <FieldContent>
                      <div className="relative">
                        <Bot className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="ai-search-model-name"
                          value={editableSearchProviderModelName}
                          onChange={(event) =>
                            handleCurrentSearchProviderModelNameChange(event.target.value)
                          }
                          placeholder="gpt-4o-mini"
                          className="h-10 pl-9"
                        />
                      </div>
                      <FieldDescription>
                        指定直接调用大模型执行剧情搜索时使用的模型名称。
                      </FieldDescription>
                    </FieldContent>
                  </Field>
                </div>

                <div className="rounded-lg border border-border/70 p-4">
                  <div className="mb-4">
                    <p className="text-sm font-medium text-foreground">视觉模型</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      用于镜头解读和视频理解任务，支持 DashScope、Gemini 和 grok2api 三条链路。
                    </p>
                  </div>
                  <Field>
                    <FieldLabel htmlFor="ai-vision-provider">视觉模型 Provider</FieldLabel>
                    <FieldContent>
                      <Select
                        value={normalizedValues.aiVisionProvider}
                        onValueChange={(value) =>
                          onChangeField("aiVisionProvider", value as VisionAiProvider)
                        }
                      >
                        <SelectTrigger id="ai-vision-provider" className="h-10 w-full">
                          <SelectValue placeholder="选择视觉模型 Provider" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="dashscope">DashScope</SelectItem>
                          <SelectItem value="gemini">Gemini</SelectItem>
                          <SelectItem value="grok2api">grok2api</SelectItem>
                        </SelectContent>
                      </Select>
                      <FieldDescription>
                        控制镜头解读与视频理解走哪条模型链路。
                      </FieldDescription>
                    </FieldContent>
                  </Field>
                  {normalizedValues.aiVisionProvider === "dashscope" ? (
                    <>
                  <Field>
                    <FieldLabel htmlFor="ai-vision-base-url">
                      视觉模型 Base URL
                    </FieldLabel>
                    <FieldContent>
                      <div className="relative">
                        <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="ai-vision-base-url"
                          value={normalizedValues.aiVisionBaseUrl}
                          onChange={(event) =>
                            onChangeField("aiVisionBaseUrl", event.target.value)
                          }
                          placeholder="https://dashscope.aliyuncs.com/api/v1"
                          className="h-10 pl-9"
                        />
                      </div>
                      <FieldDescription>
                        镜头解读通过 DashScope Python SDK 调用本地视频上传，请填写对应地域的 API 地址。
                      </FieldDescription>
                    </FieldContent>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="ai-vision-model-name">
                      视觉模型名称
                    </FieldLabel>
                    <FieldContent>
                      <div className="relative">
                        <Bot className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="ai-vision-model-name"
                          value={normalizedValues.aiVisionModelName}
                          onChange={(event) =>
                            onChangeField("aiVisionModelName", event.target.value)
                          }
                          placeholder="qwen3.6-plus"
                          className="h-10 pl-9"
                        />
                      </div>
                      <FieldDescription>
                        用于镜头解读的视频多模态模型名称，例如百炼视觉模型。
                      </FieldDescription>
                    </FieldContent>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="ai-vision-fps">镜头解读 FPS</FieldLabel>
                    <FieldContent>
                      <div className="relative">
                        <Bot className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="ai-vision-fps"
                          value={normalizedValues.aiVisionFps}
                          onChange={(event) =>
                            onChangeField("aiVisionFps", event.target.value)
                          }
                          placeholder="2"
                          className="h-10 pl-9"
                        />
                      </div>
                      <FieldDescription>
                        控制视频抽帧频率，默认 2，建议范围 0.1 到 10。
                      </FieldDescription>
                    </FieldContent>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="ai-vision-api-key">视觉模型 API Key</FieldLabel>
                    <FieldContent>
                      <div className="flex gap-3">
                        <div className="relative flex-1">
                          <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            id="ai-vision-api-key"
                            value={normalizedValues.aiVisionApiKey}
                            onChange={(event) =>
                              onChangeField("aiVisionApiKey", event.target.value)
                            }
                            type={showVisionApiKey ? "text" : "password"}
                            placeholder="sk-..."
                            className="h-10 pl-9 pr-11"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="absolute right-1 top-1 h-8 w-8"
                            onClick={() => setShowVisionApiKey((current) => !current)}
                            aria-label={
                              showVisionApiKey
                                ? "隐藏视觉模型 API Key"
                                : "显示视觉模型 API Key"
                            }
                          >
                            {showVisionApiKey ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>
                      <FieldDescription>
                        视觉任务单独使用的 API Key。
                      </FieldDescription>
                    </FieldContent>
                  </Field>
                    </>
                  ) : normalizedValues.aiVisionProvider === "gemini" ? (
                    <>
                      <Field>
                        <FieldLabel htmlFor="gemini-vision-base-url">
                          Gemini Base URL
                        </FieldLabel>
                        <FieldContent>
                          <div className="relative">
                            <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                              id="gemini-vision-base-url"
                              value={normalizedValues.geminiVisionBaseUrl}
                              onChange={(event) =>
                                onChangeField("geminiVisionBaseUrl", event.target.value)
                              }
                              placeholder="https://generativelanguage.googleapis.com/v1beta"
                              className="h-10 pl-9"
                            />
                          </div>
                          <FieldDescription>
                            Gemini 视频理解默认使用 Google AI Studio 的 `v1beta` 接口根路径。
                          </FieldDescription>
                        </FieldContent>
                      </Field>

                      <Field>
                        <FieldLabel htmlFor="gemini-vision-model-name">
                          Gemini 模型名称
                        </FieldLabel>
                        <FieldContent>
                          <div className="relative">
                            <Bot className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                              id="gemini-vision-model-name"
                              value={normalizedValues.geminiVisionModelName}
                              onChange={(event) =>
                                onChangeField("geminiVisionModelName", event.target.value)
                              }
                              placeholder="gemini-2.5-flash"
                              className="h-10 pl-9"
                            />
                          </div>
                          <FieldDescription>
                            用于视频理解与镜头解读的 Gemini 模型名称。
                          </FieldDescription>
                        </FieldContent>
                      </Field>

                      <Field>
                        <FieldLabel htmlFor="gemini-vision-api-key">Gemini API Key</FieldLabel>
                        <FieldContent>
                          <div className="flex gap-3">
                            <div className="relative flex-1">
                              <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                              <Input
                                id="gemini-vision-api-key"
                                value={normalizedValues.geminiVisionApiKey}
                                onChange={(event) =>
                                  onChangeField("geminiVisionApiKey", event.target.value)
                                }
                                type={showGeminiVisionApiKey ? "text" : "password"}
                                placeholder="AIza..."
                                className="h-10 pl-9 pr-11"
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="absolute right-1 top-1 h-8 w-8"
                                onClick={() => setShowGeminiVisionApiKey((current) => !current)}
                                aria-label={
                                  showGeminiVisionApiKey
                                    ? "隐藏 Gemini API Key"
                                    : "显示 Gemini API Key"
                                }
                              >
                                {showGeminiVisionApiKey ? (
                                  <EyeOff className="h-4 w-4" />
                                ) : (
                                  <Eye className="h-4 w-4" />
                                )}
                              </Button>
                            </div>
                          </div>
                          <FieldDescription>
                            Gemini 视频理解单独使用的 API Key。
                          </FieldDescription>
                        </FieldContent>
                      </Field>

                      <Field>
                        <FieldLabel htmlFor="ai-vision-fps">镜头解读 FPS</FieldLabel>
                        <FieldContent>
                          <div className="relative">
                            <Bot className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                              id="ai-vision-fps"
                              value={normalizedValues.aiVisionFps}
                              onChange={(event) =>
                                onChangeField("aiVisionFps", event.target.value)
                              }
                              placeholder="2"
                              className="h-10 pl-9"
                            />
                          </div>
                          <FieldDescription>
                            用于本地裁片和上传控制，默认 2，建议范围 0.1 到 10。
                          </FieldDescription>
                        </FieldContent>
                      </Field>
                    </>
                  ) : (
                    <>
                      <Field>
                        <FieldLabel htmlFor="ai-vision-base-url">
                          grok2api Base URL
                        </FieldLabel>
                        <FieldContent>
                          <div className="relative">
                            <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                              id="ai-vision-base-url"
                              value={normalizedValues.aiVisionBaseUrl}
                              onChange={(event) =>
                                onChangeField("aiVisionBaseUrl", event.target.value)
                              }
                              placeholder="http://127.0.0.1:8000/v1"
                              className="h-10 pl-9"
                            />
                          </div>
                          <FieldDescription>
                            grok2api 走 OpenAI 兼容 `/chat/completions`，镜头解读会先本地抽帧，再把多张图片作为输入发送。
                          </FieldDescription>
                        </FieldContent>
                      </Field>

                      <Field>
                        <FieldLabel htmlFor="ai-vision-model-name">
                          grok2api 模型名称
                        </FieldLabel>
                        <FieldContent>
                          <div className="relative">
                            <Bot className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                              id="ai-vision-model-name"
                              value={normalizedValues.aiVisionModelName}
                              onChange={(event) =>
                                onChangeField("aiVisionModelName", event.target.value)
                              }
                              placeholder="grok-2-vision-latest"
                              className="h-10 pl-9"
                            />
                          </div>
                          <FieldDescription>
                            请填写支持图片输入的视觉模型名称，例如支持 `image_url` 内容块的 grok2api 模型。
                          </FieldDescription>
                        </FieldContent>
                      </Field>

                      <Field>
                        <FieldLabel htmlFor="ai-vision-api-key">grok2api API Key</FieldLabel>
                        <FieldContent>
                          <div className="flex gap-3">
                            <div className="relative flex-1">
                              <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                              <Input
                                id="ai-vision-api-key"
                                value={normalizedValues.aiVisionApiKey}
                                onChange={(event) =>
                                  onChangeField("aiVisionApiKey", event.target.value)
                                }
                                type={showVisionApiKey ? "text" : "password"}
                                placeholder="sk-..."
                                className="h-10 pl-9 pr-11"
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="absolute right-1 top-1 h-8 w-8"
                                onClick={() => setShowVisionApiKey((current) => !current)}
                                aria-label={
                                  showVisionApiKey
                                    ? "隐藏 grok2api API Key"
                                    : "显示 grok2api API Key"
                                }
                              >
                                {showVisionApiKey ? (
                                  <EyeOff className="h-4 w-4" />
                                ) : (
                                  <Eye className="h-4 w-4" />
                                )}
                              </Button>
                            </div>
                          </div>
                          <FieldDescription>
                            镜头解读会使用这组 API Key 调用 grok2api 视觉接口。
                          </FieldDescription>
                        </FieldContent>
                      </Field>

                      <Field>
                        <FieldLabel htmlFor="ai-vision-fps">镜头解读 FPS</FieldLabel>
                        <FieldContent>
                          <div className="relative">
                            <Bot className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                              id="ai-vision-fps"
                              value={normalizedValues.aiVisionFps}
                              onChange={(event) =>
                                onChangeField("aiVisionFps", event.target.value)
                              }
                              placeholder="2"
                              className="h-10 pl-9"
                            />
                          </div>
                          <FieldDescription>
                            用于控制本地抽帧密度。值越高，发送到 grok2api 的图片越多，成本和延迟也会更高。
                          </FieldDescription>
                        </FieldContent>
                      </Field>
                    </>
                  )}
                </div>
              </FieldGroup>
            </CardContent>
          </Card>

          <Card className="gap-0">
            <CardHeader className="border-b border-border">
              <CardTitle className="flex items-center gap-2 text-base">
                <Clapperboard className="h-4 w-4 text-primary" />
                媒体工具
              </CardTitle>
              <CardDescription>
                配置本地 `ffmpeg` 和 `ffprobe` 路径，用于镜头解读裁片、视频裁剪与片段合成。
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="ffmpeg-executable-path">
                    ffmpeg 可执行文件路径
                  </FieldLabel>
                  <FieldContent>
                    <Input
                      id="ffmpeg-executable-path"
                      value={normalizedValues.ffmpegExecutablePath}
                      onChange={(event) =>
                        onChangeField("ffmpegExecutablePath", event.target.value)
                      }
                      placeholder="/opt/homebrew/bin/ffmpeg"
                      className="h-10"
                    />
                    <FieldDescription>
                      用于镜头解读生成临时视频片段，以及项目片段裁剪、合成。留空时会尝试系统默认路径。
                    </FieldDescription>
                  </FieldContent>
                </Field>

                <Field>
                  <FieldLabel htmlFor="ffprobe-executable-path">
                    ffprobe 可执行文件路径
                  </FieldLabel>
                  <FieldContent>
                    <Input
                      id="ffprobe-executable-path"
                      value={normalizedValues.ffprobeExecutablePath}
                      onChange={(event) =>
                        onChangeField("ffprobeExecutablePath", event.target.value)
                      }
                      placeholder="/opt/homebrew/bin/ffprobe"
                      className="h-10"
                    />
                    <FieldDescription>
                      用于读取视频时长，主要影响导入时的片头片尾裁剪。留空时会尝试系统默认路径。
                    </FieldDescription>
                  </FieldContent>
                </Field>

                <div className="flex flex-col gap-3 rounded-lg border border-border/70 p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-sm font-medium text-foreground">路径检测</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        检测当前填写的 `ffmpeg` / `ffprobe` 是否可以实际执行。
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={onCheckMediaTools}
                      disabled={isCheckingMediaTools}
                    >
                      <RefreshCw
                        className={isCheckingMediaTools ? "h-4 w-4 animate-spin" : "h-4 w-4"}
                      />
                      {isCheckingMediaTools ? "检测中..." : "检测工具路径"}
                    </Button>
                  </div>

                  {mediaToolsCheckResult ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      {[
                        {
                          key: "ffmpeg" as const,
                          label: "ffmpeg",
                          result: mediaToolsCheckResult.ffmpeg,
                        },
                        {
                          key: "ffprobe" as const,
                          label: "ffprobe",
                          result: mediaToolsCheckResult.ffprobe,
                        },
                      ].map(({ key, label, result }) => (
                        <div
                          key={key}
                          className={
                            result.ok
                              ? "rounded-lg border border-emerald-200 bg-emerald-50/80 p-3"
                              : "rounded-lg border border-red-200 bg-red-50/80 p-3"
                          }
                        >
                          <p className="text-sm font-medium text-foreground">
                            {label} {result.ok ? "可用" : "不可用"}
                          </p>
                          <p className="mt-1 break-all text-xs text-muted-foreground">
                            {result.resolvedPath ?? "未解析到可执行路径"}
                          </p>
                          <p className="mt-2 text-sm text-foreground">{result.message}</p>
                          {result.version ? (
                            <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
                              {result.version}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </FieldGroup>
            </CardContent>
          </Card>

        </div>
      </div>
    </div>
  );
}
