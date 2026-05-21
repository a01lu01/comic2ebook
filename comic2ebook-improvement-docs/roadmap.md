# Comic2Ebook 渐进式改进路线图（最终版：便携绿色版 / ComicInfo 可选 / 统一输出目录）

## 0. 你的偏好（已确认）
- 发布形态：便携绿色版优先
- CBZ 元数据（ComicInfo.xml）：做成可选项（默认 off）
- 输出目录策略：默认统一输出到同一个目录（不按书名分子目录）

## 1. 推荐技术取向
推荐：JS + electron-builder（不强制 TypeScript）
- 原因：当前代码量小、目标明确；优先把离线/稳定/性能/发布补齐，避免 TS/Vite 带来额外迁移成本。
- 后续：当服务拆分与 IPC 协议稳定后，再评估是否引入 TS（作为可选增强）。

## 2. 最终目标与质量门槛（Definition of Done）

### 2.1 稳定性
- 任意一本漫画失败不会中断队列
- Calibre 缺失/路径错误/转换失败都有明确提示与可导出日志
- 支持取消（至少能取消 Calibre 转换；打包阶段可中止并清理半成品）

### 2.2 性能
- 大页数（例如 1000 张图）不出现明显 UI 卡死
- 内存峰值相对当前方案显著下降（主进程流式打包，避免 IPC 搬运图片）

### 2.3 离线与绿色版分发
- 打包产物不依赖任何 CDN
- 绿色版：解压即用（不需要安装、尽量不要求管理员权限）
- 设置与日志落在用户目录（userData），删除目录后可干净移除

### 2.4 体验
- 图片排序可靠（自然排序）
- 输出默认统一目录，并提供覆盖策略避免误覆盖
- 失败任务可一键重试/导出日志/打开输出目录

## 3. 最终目标架构（终点形态）

### 3.1 分层与职责
- 主进程（Main）
  - TaskOrchestrator：队列调度、并发控制、取消/重试、进度广播
  - FsService：扫描、自然排序、输出命名、覆盖策略、路径清洗
  - PackService：流式打包 CBZ（主进程完成）
  - ConvertService：Calibre 调用、进度解析、错误标准化
  - SettingsService：配置持久化与默认值
  - LogService：按 jobId 记录、导出日志
- 预加载（Preload）
  - 暴露 window.api 最小能力集
- 渲染进程（Renderer）
  - TaskStore：只负责状态与展示，不搬运大文件数据

### 3.2 统一 IPC 契约（建议最终版）
invoke（请求-响应）：
- `api.openComicDirs() -> [{id,name,path}]`
- `api.chooseOutputDir() -> {path}|null`
- `api.getSettings() -> settings`
- `api.setSettings(patch) -> settings`
- `api.enqueueJobs({comics, formats, output, options}) -> {jobIds}`
- `api.cancelJob(jobId) -> {ok}`
- `api.retryJob(jobId) -> {newJobId}`
- `api.exportLogs({scope, jobId?}) -> {path}`

events（推送）：
- `job:update`：`{jobId, comicId, comicName, stage, format?, percent, message, severity, ts}`
- `job:result`：`{jobId, ok, outputs, durationMs, warnings?, error?}`

stage 枚举：
- `queued | precheck | packing | converting | done | failed | cancelled`

error 标准结构：
- `{ code, message, detail?, command?, exitCode?, stack? }`

## 4. 渐进式实施路线（Phase 1→4）

### Phase 1：小改（快速收益，低风险）
目标：先把离线/页序/参数一致性/错误提示修稳。
- 本地化 JSZip（移除 CDN）
- 自然排序
- 输出命名清洗 + 覆盖策略（默认 rename）
- 参数集中化（为 profile 做准备）
- IPC 错误结构化 + 最小日志可观测

### Phase 2：中改（工程能力补齐）
目标：把边界立住（隔离、配置、可取消），为大改打基础。
- preload + contextIsolation（渲染无 Node 权限）
- SettingsService（userData/settings.json）
- 设置 UI（calibrePath/outputMode/overwritePolicy/profile/cbzComicInfo）
- 取消转换（先覆盖 converting）
- 导出日志

### Phase 3：大改核心（性能与稳定跃迁）
目标：任务系统 + 主进程流式打包 + 统一协议。
- Job 模型 + Orchestrator（packing=2, converting=1）
- PackService 主进程打包（支持取消）
- ConvertService 收口 Calibre 调用与进度解析
- 统一 job:update/job:result
- Retry（失败/取消可重试，保留历史）
- LogService 聚合日志

### Phase 4：产品化发布（绿色版闭环）
目标：electron-builder portable + 离线资源彻底本地化 + 最小测试。
- electron-builder（portable 优先）
- 移除所有外链（字体/脚本/资源）
- 最小单元测试（排序/命名/参数拼装）
- 版本与变更记录

## 5. 推荐交付顺序（最稳）
1) Phase 1 全部
2) Phase 2：preload + settings
3) Phase 2：cancel + exportLogs
4) Phase 3：enqueueJobs + job:update（事件驱动先跑通）
5) Phase 3：主进程 pack（性能跃迁）
6) Phase 4：portable 发布闭环
7) 可选：再评估 TypeScript
