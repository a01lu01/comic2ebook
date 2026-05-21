# Comic2Ebook 改进方案（中改：安全隔离 + 队列系统 + 配置持久化）

## 1. 目标与范围

### 目标
在“保留总体形态（Electron 单窗口工具）”的同时，补齐工程质量：
- 稳定性：失败隔离、可重试、可取消、日志完善
- 性能：大批量任务更省内存，CPU/IO 更可控
- 离线：打包产物不依赖外网；关键依赖可本地化
- 安全/可维护性：使用 preload 暴露最小 API，减少渲染层 Node 权限

### 非目标
- 不立刻上重型前端框架（仍用原生 HTML/CSS/JS）
- 不要求一次性迁移 TypeScript（可选）

## 2. 架构调整（中改的核心）

### 2.1 Electron 安全模型调整
- BrowserWindow
  - `nodeIntegration: false`
  - `contextIsolation: true`
  - 增加 `preload.js`
- preload 暴露最小 API（示例）
  - `window.api.openDirs()`
  - `window.api.convert()`
  - `window.api.cancel(taskId)`
  - `window.api.onProgress(cb)`
- 目标效果
  - 渲染进程不再 `require('electron') / require('fs')`
  - API 面更清晰、后续扩展更可控

### 2.2 任务系统：统一队列 + 状态机（强烈建议）
将“一个漫画文件夹的一次输出”视为 Task：
- Task 维度
  - `comicId`（文件夹唯一 id）
  - `formats`（cbz/pdf/epub/azw3/mobi）
  - `outputDir`
  - `options`（参数、覆盖策略、质量策略等）
- Task 状态机（建议）
  - `queued -> packing -> converting(format...) -> done`
  - `failed`（可重试）
  - `cancelled`
- 并发策略（建议默认）
  - 打包：1~2 并发（IO 密集）
  - 转换：1 并发（Calibre 外部进程 + IO）
  - 可在设置中调整

### 2.3 CBZ 打包迁移到主进程（性能关键）
- 主进程直接读取图片文件并写入 zip（避免 IPC 来回传每一张图）
- 进度推送：按“已处理图片数/总数”推送百分比
- 结果：渲染进程只负责 UI 与任务编排，数据面更轻

### 2.4 配置持久化（建议落到 userData）
- 配置项
  - calibrePath
  - 默认输出目录策略
  - 覆盖策略
  - 并发数/性能策略
  - 最近使用的输出目录、最近转换格式
- 存储方式
  - 优先：写 JSON 到 `app.getPath('userData')`
  - 或引入轻量 store（需新增依赖）

## 3. 功能增强（中改交付的用户价值）

### 3.1 取消 / 暂停 / 重试
- 取消：终止当前 zip 写入或 kill calibre 子进程（必要时 kill tree）
- 暂停：暂停队列调度（不强行暂停外部进程）
- 重试：对 failed 的任务保留上下文（参数、路径、日志）

### 3.2 更强的输入识别（体验）
- 支持更多输入来源（可选）
  - 单个文件夹
  - 多级目录扫描（把子文件夹当作一本）
- 图片过滤更精细
  - 忽略封面候选/广告图（可配置：如 `cover.*` 规则）
- 自然排序作为默认

### 3.3 转换参数的“配置化”
- 把每种格式参数抽成配置表
- UI 提供“推荐参数 / 兼容参数”两档
  - 推荐：最大化漫画观感（边距 0、封面策略等）
  - 兼容：减少特殊参数，适配部分 Calibre/设备怪癖

## 4. 目录结构建议（中改）
- `main.js`（主进程入口）
- `preload.js`（新增）
- `app.html`（UI）
- 可选拆分（不强制，但推荐）
  - `renderer/ui.js`
  - `renderer/state.js`
  - `renderer/tasks.js`
  - `shared/sort.js`
  - `shared/paths.js`

## 5. 实施里程碑（建议顺序）
1) 引入 preload + contextIsolation（先把现有 IPC 调通）
2) 配置持久化（calibrePath 等）
3) 任务系统（队列 + 状态机 + 进度协议统一）
4) CBZ 打包迁移主进程（性能重点）
5) 取消/重试/日志导出
6) 参数配置化 + 推荐/兼容档

## 6. 验收标准（Definition of Done）
- 离线可用：不依赖 CDN
- 大批量稳定：100 本、每本 500 张图，不崩溃且可取消
- 失败可恢复：任何一本失败不影响其它；可重试并保留日志
- 安全模型：渲染进程无 Node 权限；只通过 preload API

## 7. 风险与对策
- 风险：切到 preload 后，渲染层改动较大
  - 对策：先做“API 适配层”，保持 UI 逻辑不大改
- 风险：kill calibre 子进程在 Windows 上可能残留
  - 对策：实现 kill tree；并在 UI 提示“取消后可能需要稍等资源释放”
