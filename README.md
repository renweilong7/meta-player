# Meta Player

Meta Player 是一款面向本地视频素材整理、剧情理解与片段定位的桌面工作台。

它把项目管理、素材导入、视频播放、AI 剧情大纲提取、剧情检索和关键时间点标记整合到一个 Electron 桌面应用中，适合用于长视频内容整理、审片辅助、剧情片段回查和素材结构化管理。

## 产品价值

面对长视频、素材多、信息散的问题，Meta Player 关注的是两件事：

- 让素材管理更清晰：按项目组织素材，统一维护简介、字幕和分析结果
- 让片段定位更高效：从“拖时间轴找内容”变成“看大纲、搜剧情、点结果直接跳转”

它适合以下场景：

- 节目、短剧、访谈、课程等长视频内容整理
- 审片、回看、标记关键时间点
- 根据剧情、字幕或描述快速回查片段
- 为后续剪辑、切片和内容复用做结构化准备

## 核心能力

### 项目化管理

- 支持新建、编辑、删除和搜索项目
- 支持按项目组织素材与分析结果
- 支持快速切换不同项目工作台

### 本地素材导入

- 支持批量导入本地视频和图片素材
- 支持托管导入和引用导入两种模式
- 支持内容哈希去重，避免重复入库
- 支持为素材补充剧情简介和 SRT 字幕文本

### 视频播放与定位

- 支持桌面端本地视频播放
- 支持跳转到指定时间点
- 支持与剧情检索、标记结果联动定位
- 支持关键时间点高亮辅助浏览

### AI 剧情大纲

- 基于素材简介和字幕文本调用 OpenAI 兼容接口
- 自动提取结构化剧情场景
- 展示场景标题、描述、起止时间和时长
- 支持从大纲直接定位到视频片段

### 剧情检索

- 支持关键词检索剧情片段
- 支持远端 Embedding 检索
- 支持大模型搜索/排序
- 支持搜索结果一键跳转到对应视频时间

### 标记与审片

- 支持为素材添加、编辑、删除标记
- 支持点击标记回看对应时间点
- 支持标记时间微调

### 授权与分层能力

- 支持设备指纹识别
- 支持远端授权同步
- 支持基础授权和高级授权的功能分层

## 当前版本已实现

当前代码已经落地的能力包括：

- 项目管理
- 本地素材导入与素材库管理
- 视频播放与时间定位
- 素材级标记管理
- AI 剧情大纲提取与浏览
- 项目范围内的剧情检索
- 本地 SQLite 持久化
- 设备指纹与授权状态展示

## 当前限制

为避免误解，当前版本也有几个明确边界：

- 图片素材目前只参与管理，不在播放器面板内预览
- 场景编辑和场景排序仍是 UI 预留
- 本地 Embedding 模型能力尚未真正打通
- 视频编辑、导出等高级工作流仍在规划中

## 授权模型

Meta Player 当前采用基础授权与高级授权两档能力分层。

基础授权覆盖：

- 应用基础访问
- 项目管理
- 素材管理
- 基础播放
- 基础剧情大纲
- 基础剧情检索
- 基础设置

高级授权覆盖：

- 标记与审片
- 高级剧情大纲能力
- 高级剧情搜索能力
- 后续视频编辑、导出和高级工作流能力

## 技术架构

- Electron
- Next.js 16
- React 19
- TypeScript
- Tailwind CSS 4
- SQLite

项目同时包含：

- 桌面端 Electron 壳层
- 本地 Web 工作台界面
- SQLite 持久化层
- 授权与设备指纹模块
- 剧情大纲提取与检索模块

## 快速开始

### 安装依赖

```bash
npm install
```

如果要启用本地 Embedding 模型推理，还需要准备 Python 依赖：

```bash
pip install -r requirements-local-embedding.txt
```

### 启动开发环境

```bash
npm run electron:dev
```

这个命令会同时启动 Next.js 开发服务和 Electron 桌面应用。

如果要启用 `sqlite-vec` 本地向量检索，请先把对应平台的动态库放到仓库内：

```text
bin/sqlite-vec/darwin-arm64/vec0.dylib
bin/sqlite-vec/darwin-x64/vec0.dylib
bin/sqlite-vec/linux-x64/vec0.so
bin/sqlite-vec/win32-x64/vec0.dll
```

开发环境也可以用环境变量覆盖默认路径：

```bash
META_PLAYER_SQLITE_VEC_PATH=/absolute/path/to/vec0.dylib npm run electron:dev
```

项目自带本地 Embedding 模型请放在：

```text
models/embeddings/<model-name>/
```

用户自定义模型可放在任意目录，然后在设置页指定“本地 Embedding 模型目录”。应用会扫描该目录下的一级子目录。

### 构建应用

```bash
npm run package:app
```

## 打包

### Windows

类 Unix 环境可直接执行：

```bash
npm run dist:win
```

如果在 Windows PowerShell 下执行，建议使用：

```powershell
npm install
npm run package:app
$env:ELECTRON_OVERRIDE_DIST_PATH="node_modules/electron/dist"
npx electron-builder --win nsis portable
```

### macOS

```bash
npm run dist:mac
```

## 打包版特性

当前打包版 Electron 应用已做基础安全收口：

- 隐藏顶部菜单
- 禁用 DevTools
- 拦截常见调试快捷键
- 屏蔽右键上下文菜单
- 禁止页面打开新窗口
- 生产环境关闭 `nodeIntegration`，开启 `contextIsolation`

打包时如果仓库内存在 `bin/sqlite-vec/`，会自动把动态库带入应用产物，供本地向量检索使用。

## 目录结构

```text
app/                  Next.js App Router 页面与 API
components/           前端界面组件
electron/             Electron 主进程入口
lib/license/          授权、设备指纹、远端同步
lib/persistence/      SQLite 持久化与仓储
lib/story-outline/    剧情大纲提取与检索
scripts/              构建与打包脚本
docs/                 功能与规划文档
```

## 相关文档

- [功能清单](./docs/feature-inventory.md)
- [授权矩阵设计](./docs/license-matrix.md)
- [视频工作台规划](./docs/video-editor-workspace-plan.md)
