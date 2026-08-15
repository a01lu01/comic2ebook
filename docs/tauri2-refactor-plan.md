# Comic2Ebook Tauri 2 + Rust 重构方案

> 状态：待评审  
> 版本：0.1  
> 日期：2026-08-09  
> 关联规范：`D:\Coding\ntfy-notifier\docs\ui-design.md`

---

## 1. 背景与目标

### 1.1 现状

Comic2Ebook 目前是 Electron 桌面应用，功能上已经完整：批量选择漫画文件夹、自然排序、主进程流式打包 CBZ、通过 Calibre 转换为 PDF / EPUB / AZW3 / MOBI、任务队列（打包并发 2、转换并发 1）、取消、重试、日志、设置持久化。

痛点：

- Electron 打包体积大，绿色版约 223 MB，启动与内存占用偏高。
- 渲染进程仍残留 JSZip、旧 `calibre:convert` IPC 等死代码。
- 存在几个已知缺陷：取消/打包失败后 UI 可能一直 `busy`、设置保存会整体覆盖、自定义 Calibre 路径未在检测时优先使用、`overwritePolicy` 只保存不生效。
- `TECHNICAL.md` 与当前代码严重脱节，维护成本在上升。

### 1.2 目标

1. 使用 **Tauri 2 + Rust** 重写整个应用，去掉 Node/Electron 运行时。
2. 功能与现有 Electron 版保持对等（feature parity）：
   - 批量选择漫画文件夹，支持拖拽；
   - 自然排序，支持中文/日文/特殊字符文件名；
   - CBZ 流式打包，PNG Alpha 白底合成并转 RGB；
   - Calibre 检测、自定义路径、PDF/EPUB/AZW3/MOBI 转换；
   - 并发调度、取消、重试、10 分钟超时；
   - 日志落盘、导出、上限 100 个；
   - 输出目录记忆、冲突自动重命名；
   - 设置持久化与主题切换。
3. 前端 UI 完全对齐 `ntfy-notifier\docs\ui-design.md` 的设计系统：字体、双主题变量、180px 侧边导航、卡片、表格、开关、分段按钮、滚动条、窗口尺寸。
4. 修复上一节列出的已知缺陷，并在新架构中显式保证“任何终止状态都会发出 `job:result`”。
5. 最终交付可安装/便携分发的 Windows 应用，并补齐最小自动化测试与回归清单。

### 1.3 非目标

- 不支持移动端（不做 Tauri Mobile）。
- 不引入 React/Vue/TypeScript；前端保持与 ntfy-notifier 一致的“Vite + 原生 JS”路线。
- 不改变五种输出格式和 Calibre 外部依赖的定位。
- 不要求实现 ComicInfo.xml（保持当前“不写”行为；如未来需要，作为独立设置项追加）。

---

## 2. 现状盘点

### 2.1 现有功能模块

| 模块 | 文件 | 职责 |
|---|---|---|
| 主进程入口 | `main.js` | 窗口、IPC、设置、Calibre 检测、任务入队 |
| 渲染 UI | `app.html` | 页面、任务列表、设置弹窗、进度渲染 |
| 安全桥 | `preload.js` | 暴露 `window.api` |
| 文件服务 | `js/fs.js` | 自然排序、文件名清洗、冲突重命名、图片列表 |
| 打包服务 | `js/pack.js` | archiver 流式 CBZ、PNG 归一化 |
| 转换服务 | `js/convert.js` | Calibre spawn、进度解析、参数构建 |
| 调度器 | `js/orchestrator.js` | 队列、并发、取消、重试、超时、事件广播 |
| 日志服务 | `js/log.js` | 日志目录、追加、修剪 |
| 设置 schema | `docs/settings-schema.md` | 设置字段说明 |
| 回归清单 | `docs/regression-checklist.md` | 手工回归检查 |

### 2.2 需要在新版规避的已知问题

1. `orchestrator.js` 的 `cancel()` 和 `_runPacking()` 失败分支不发送 `job:result`，渲染层 `busy` 只在 `job:result` 时解除，取消/打包失败最后一个任务后界面会卡住。
2. `app.html` 选择输出目录时调用 `saveSettings({ outputDir })`，而主进程是整体覆盖写入，会丢掉 Calibre 路径、profile、并发数等配置。
3. `main.js` 的 `calibre:check` 不优先使用 `settings.calibrePath`，自定义路径只在入队时生效，UI 检测状态与真实行为不一致。
4. `overwritePolicy` 已进入设置 schema 和 UI，但实际代码永远走“自动重命名”。
5. `preload.js` 仍暴露 `convertCalibre` / `onCalibrePercent` / `onCalibreProgress`，但主进程没有对应 handler；`app.html` 仍加载 JSZip，均已废弃。
6. `main.js` 残留旧 `CALIBRE_PROFILES`，包含已知非法的 `--base-font-size 0` 与 `--pdf-default-font-size=0`；真实转换走 `js/convert.js`，两处参数不一致，容易误改。
7. 文档滞后：`TECHNICAL.md` 仍描述旧的 `nodeIntegration: true` 架构与渲染层 JSZip 打包。

---

## 3. 目标架构

### 3.1 总体分层

```text
┌──────────────────────────────────────────────────────────┐
│  前端（Vite + 原生 JS + CSS 变量设计系统）                  │
│  · 转换 / 设置 / 关于 三页                                │
│  · 任务表格、状态订阅、主题切换                            │
└──────────────────────┬───────────────────────────────────┘
                       │ @tauri-apps/api invoke + listen
┌──────────────────────▼───────────────────────────────────┐
│  Tauri 2 Rust 后端                                        │
│  lib.rs：命令注册、状态管理、事件广播                        │
│  settings.rs / scan.rs / naming.rs / calibre.rs           │
│  pack.rs / convert.rs / orchestrator.rs / logs.rs          │
│  ui_state.rs / appdata.rs                                 │
└──────────────────────┬───────────────────────────────────┘
                       │ tokio + std::process
┌──────────────────────▼───────────────────────────────────┐
│  外部依赖：Calibre ebook-convert.exe / Windows 文件系统      │
└──────────────────────────────────────────────────────────┘
```

### 3.2 开发期目录结构

为避免破坏仍在使用的 Electron 版，新工程先放在 `tauri/` 子目录（与 ntfy-notifier 仓库布局一致），验收通过后提升为仓库根目录并删除旧文件。

```text
comic2ebook/
├── tauri/
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   ├── src/
│   │   ├── main.js
│   │   ├── styles.css
│   │   ├── jobs-model.js
│   │   ├── ui-state.js
│   │   ├── table-drag.js
│   │   └── public/
│   │       └── assets/fonts/HarmonyOS_Sans_Regular.ttf
│   └── src-tauri/
│       ├── Cargo.toml
│       ├── build.rs
│       ├── tauri.conf.json
│       ├── capabilities/default.json
│       ├── icons/
│       └── src/
│           ├── main.rs
│           ├── lib.rs
│           ├── appdata.rs
│           ├── settings.rs
│           ├── scan.rs
│           ├── naming.rs
│           ├── calibre.rs
│           ├── pack.rs
│           ├── convert.rs
│           ├── orchestrator.rs
│           ├── logs.rs
│           └── ui_state.rs
├── docs/
│   ├── tauri2-refactor-plan.md
│   ├── settings-schema.md
│   └── regression-checklist.md
├── scripts/gen-samples.py
└── samples/
```

### 3.3 技术选型

#### Rust / Tauri 依赖

| crate | 用途 |
|---|---|
| `tauri = "2"` | 应用框架、窗口、事件 |
| `tauri-plugin-dialog = "2"` | 原生文件夹/文件对话框 |
| `tauri-plugin-opener = "2"` | 在资源管理器中打开路径 |
| `tauri-plugin-single-instance = "2"` | 单实例（可选，与 ntfy-notifier 一致） |
| `serde` / `serde_json` | 配置与 IPC 序列化 |
| `tokio` | 异步任务、子进程 |
| `zip = "2"` | CBZ 打包（Stored 压缩，纯流式） |
| `image = { version = "0.25", default-features = false, features = ["png"] }` | PNG 解码/归一化/编码 |
| `chrono = "0.4"` | 日志时间戳 |
| `uuid = { version = "1", features = ["v4"] }` | Job ID |
| `thiserror` | 统一错误类型 |
| `regex = "1"` | Calibre 百分比解析 |

#### 前端依赖

| 依赖 | 用途 |
|---|---|
| `@tauri-apps/api ^2` | invoke / listen / window |
| `@tauri-apps/plugin-dialog ^2` | 原生对话框 |
| `@tauri-apps/plugin-opener ^2` | 打开目录 |
| `sortablejs ^1.15.7` | 表格列拖拽（沿用 ui-design.md 交互） |
| `vite ^6` | 构建 |
| `@tauri-apps/cli ^2` | Tauri CLI |

### 3.4 Rust 模块职责

| 模块 | 职责 | 关键点 |
|---|---|---|
| `appdata.rs` | 解析 `%APPDATA%\comic2ebook` 等目录 | 复用 ntfy-notifier `appdata::resolve` 思路 |
| `settings.rs` | 设置读取/保存/迁移 | 原子写（tmp + rename）、损坏文件备份重置、schemaVersion |
| `scan.rs` | 扫描目录图片、自然排序 | 数字段比较；扩展名过滤 |
| `naming.rs` | 文件名清洗、输出冲突策略 | `rename / overwrite / fail` 三态真正生效 |
| `calibre.rs` | 检测 `ebook-convert` | 设置路径优先 → `where.exe` → 常见安装目录 |
| `pack.rs` | CBZ 打包 | `spawn_blocking`；PNG Alpha 白底合成；进度节流 |
| `convert.rs` | Calibre 子进程与参数 | 单一参数来源；stdout 百分比；日志写入 |
| `orchestrator.rs` | 队列、并发、取消、重试、超时 | 所有终止状态必发 `job:result`；取消清理半成品 |
| `logs.rs` | 日志创建/追加/导出/修剪 | 上限 100，可读命名 |
| `ui_state.rs` | 表格列宽/列序持久化 | 对齐 ui-design.md 第 5 节 |
| `lib.rs` | 注册命令、初始化状态、发射事件 | Tauri `invoke_handler` |

---

## 4. 数据模型

```rust
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub schema_version: u32,
    pub calibre_path: String,
    pub output_mode: OutputMode,          // sameAsSource | fixedDir
    pub fixed_output_dir: String,
    pub overwrite_policy: OverwritePolicy, // rename | overwrite | fail
    pub profile: ConversionProfile,        // recommended | compatible
    pub packing_concurrency: u32,          // 默认 2
    pub convert_concurrency: u32,          // 默认 1
    pub theme_mode: ThemeMode,             // system | light | dark
    pub keep_logs: bool,                   // 默认 true
}

#[derive(Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum JobStatus { Queued, Packing, Converting, Done, Failed, Cancelled }

#[derive(Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum SubTaskStatus { Pending, Running, Done, Failed, Skipped }

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SubTask {
    pub format: String,      // cbz | pdf | epub | azw3 | mobi
    pub status: SubTaskStatus,
    pub progress: u8,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct JobResult {
    pub format: String,
    pub path: String,
    pub renamed: Option<String>,
    pub log_path: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub job_id: String,
    pub comic_id: String,
    pub comic_name: String,
    pub folder_path: String,
    pub output_dir: String,
    pub formats: Vec<String>,
    pub profile: ConversionProfile,
    pub calibre_path: Option<String>,
    pub status: JobStatus,
    pub sub_tasks: Vec<SubTask>,
    pub results: Vec<JobResult>,
    pub error: Option<String>,
    pub created_at: u64,
    pub started_at: Option<u64>,
    pub finished_at: Option<u64>,
}
```

错误统一为：

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiError {
    pub code: String,       // E_OUTPUT_EXISTS / E_NO_IMAGES / E_CALIBRE_NOT_FOUND ...
    pub message: String,
    pub detail: Option<String>,
}
```

---

## 5. IPC 契约

### 5.1 Commands（invoke）

| 命令 | 入参 | 返回 | 说明 |
|---|---|---|---|
| `scan_folder` | `folder: String` | `ComicPreview` | 图片数量、主扩展名、预览信息；空目录返回 `E_NO_IMAGES` |
| `check_calibre` | — | `CalibreStatus` | `{ found, path }`，优先使用设置路径 |
| `get_settings` | — | `Settings` | 含默认值与迁移结果 |
| `save_settings` | `settings: Settings` | `Settings` | 整体替换 + 原子写；前端始终传完整对象，Rust 侧再兜底 merge |
| `enqueue_jobs` | `jobs: Vec<JobInput>` | `Vec<String>` | 返回 jobId 列表 |
| `cancel_job` | `jobId: String` | `()` | 失败返回 `E_JOB_NOT_ACTIVE` |
| `retry_job` | `jobId: String` | `String` | 返回新 jobId |
| `export_log` | `logPath: String` | `LogContent` | `{ path, content }` |
| `get_ui_state` | — | `UiState` | 表格列宽/列序 |
| `save_ui_state` | `order: Vec<String>, widths: Map<String,i64>` | `UiState` | 同 ntfy-notifier |
| `open_path` | `path: String` | `()` | 通过 opener 插件 |

文件/文件夹选择走 `tauri-plugin-dialog` 的前端 API，不再需要自定义命令。

### 5.2 Events（listen）

| 事件 | 数据 | 触发时机 |
|---|---|---|
| `job:update` | `{ jobId, comicName, status, subTasks[], error? }` | 任何状态/进度变化 |
| `job:result` | `{ jobId, comicName, status, results[], error? }` | done / failed / cancelled 终态，**必发** |
| `job:log` | `{ jobId, chunk, isError }` | Calibre stdout/stderr 实时流 |

前端约定：`busy` 只能由 `job:result` 解除；Rust 侧保证任何进入终态的 Job 只发一次 `job:result`。

---

## 6. 核心流程

### 6.1 添加漫画

1. 前端调用 dialog 多选文件夹。
2. 逐个调用 `scan_folder`，得到 `{ path, name, imageCount, mainExt }`。
3. 空文件夹给出 toast/行内错误，不加入列表；重复路径合并。

### 6.2 入队与调度

```text
enqueue_jobs
  → JobManager 生成 jobId，进入 queue
  → tick：packing 并发 packingConcurrency 个
  → tick：converting 并发 convertConcurrency 个（默认 1）
  → 每本漫画：CBZ（如需）→ 逐个 Calibre 格式
  → 终态：done / failed / cancelled，emit job:result
```

调度规则与现状一致，但新增：

- 取消中的任务从 `active` 移除，并清理已写入的半成品 CBZ；
- 打包失败分支同样 `emit job:result`；
- 取消、失败、完成只发一次结果事件；
- 并发上限在 `save_settings` 后即时生效。

### 6.3 CBZ 打包（Rust）

- `spawn_blocking` 内用 `zip` crate 创建 `.cbz`；
- 图片条目名按总页数补零（`001.jpg`）；
- PNG 只对 Alpha 通道类型（Gray+A / RGBA）做解码 → 白底合成 → RGB8 → 重编码 PNG；
- 其余格式原样 `File` 流式写入，不整体读入内存；
- 进度每 10 张或最后一张回调一次，IPC 事件做节流；
- 输出名经 `naming.rs` 按 `overwrite_policy` 解析。

### 6.4 Calibre 转换（Rust）

- 参数统一在 `convert.rs`，不再存在两份 profile：

| 格式 | recommended 关键参数 |
|---|---|
| 通用 | `--no-process --dont-grayscale --dont-normalize --dont-sharpen --landscape` |
| PDF | A4 + 四边 0 边距 |
| EPUB | `--no-chapters-in-toc --prefer-metadata-cover --preserve-cover-aspect-ratio --no-default-epub-cover` |
| MOBI | `--no-chapters-in-toc --prefer-metadata-cover --mobi-keep-original-images --mobi-file-type=new` |
| AZW3 | `--no-chapters-in-toc --prefer-metadata-cover` |

- 不使用旧版 `--base-font-size 0` / `--pdf-default-font-size=0`；
- `tokio::process::Command` 启动，解析 stdout 的 `NN%`；
- 超时 10 分钟自动 kill；取消时 kill 并标记 cancelled；
- 命令行与 stdout/stderr 全部写入日志。

### 6.5 日志

- 目录：`%APPDATA%\comic2ebook\logs\`；
- 命名：`{comicName}_{format}_{YYYYMMDD-HHMMSS}.log`；
- 上限 100，超出按 mtime 删除最旧；
- 前端“日志”按钮读取并打开日志文件。

---

## 7. 前端设计（对齐 ui-design.md）

### 7.1 字体

```css
@font-face {
  font-family: "HarmonyOS Sans SC";
  src: url("./assets/fonts/HarmonyOS_Sans_Regular.ttf");
}

:root {
  font-family: "HarmonyOS Sans SC", "Segoe UI", system-ui, sans-serif;
  font-size: 14px;
}

button, input, select, textarea {
  font-family: inherit;
}
```

字体文件从 ntfy-notifier 的 `public/assets/fonts/HarmonyOS_Sans_Regular.ttf` 复制并附带许可证说明；若无法打包则回退 `Segoe UI`。

### 7.2 颜色主题

严格采用规范中的 CSS 变量：

| 变量 | 浅色 | 深色 |
|---|---|---|
| `--window-bg` | `#f3f3f3` | `#202020` |
| `--card-bg` | `#ffffff` | `#2b2b2b` |
| `--text` | `#1f1f1f` | `#ffffff` |
| `--subtext` | `#5d5d5d` | `#c7c7c7` |
| `--hover` | `#e9e9e9` | `#333333` |
| `--selected` | `#e3e3e3` | `#3a3a3a` |
| `--accent` | `#6c357c` | `#7d3d8e` |
| `--accent-text` | `#6c357c` | `#a96bb8` |
| `--border` | `#e0e0e0` | `#3c3c3c` |
| `--input-border` | `#c9c9c9` | `#4a4a4a` |
| `--danger` | `#c42b1c` | `#ff99a0` |

主题切换：

- `html[data-theme="light"]` / `dark` 由设置页“界面主题”分段按钮控制；
- `system` 模式监听 `matchMedia('(prefers-color-scheme: dark)')`；
- 设置项持久化到 `settings.json`。

### 7.3 窗口与布局

`tauri.conf.json`：

```json
{
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "Comic2Ebook",
        "width": 1350,
        "height": 800,
        "minWidth": 900,
        "minHeight": 500,
        "center": true
      }
    ]
  }
}
```

页面骨架：

```text
┌────────────┬──────────────────────────────┐
│ 导航 180px  │  内容区（flex: 1）             │
│ 转换        │  页面标题 → 工具栏 → 卡片/表格   │
│ 设置        │                              │
│ 关于        │                              │
└────────────┴──────────────────────────────┘
```

主内容内边距 `20px 28px`。

### 7.4 页面映射

#### 转换页

- `.page-title`：漫画转电子书
- `.page-subtitle`：显示已选文件夹数、图片总数、Calibre 状态
- 工具栏：
  - `.btn-secondary`“选择文件夹”
  - 输出目录输入框 + `.btn-secondary`“浏览”
  - 格式多选（`checkbox` 样式化为 chip，默认 CBZ + PDF）
  - `.btn-primary`“开始转换”
  - `.btn-secondary`“打开输出目录” / “复制路径”
- 卡片 1“输入漫画”：每项显示文件夹名、路径省略、页数、主扩展名、移除按钮；空状态 `.empty`“尚未选择文件夹”
- 卡片 2“转换任务”：任务表格 + 操作列（取消/重试/日志/打开输出）

#### 设置页

- 卡片“Calibre”：路径输入框 + 浏览按钮 + 检测状态文字（已就绪/未检测到）
- 卡片“转换选项”：
  - Profile 分段按钮：推荐 / 兼容
  - 覆盖策略分段按钮：自动重命名 / 覆盖 / 失败
  - 打包并发、转换并发下拉框
  - 开关：保留转换日志
- 卡片“界面”：主题分段按钮（跟随系统 / 浅色 / 深色）
- 底部 `.btn-secondary`“取消” + `.btn-primary`“保存”

#### 关于页

- `.page-title`：Comic2Ebook
- `.page-subtitle`：版本信息（Rust/Tauri）
- 卡片：简介、技术栈、依赖说明（Calibre）、许可证

### 7.5 组件尺寸

| 组件 | 关键值 |
|---|---|
| `.btn` | 内边距 `7px 16px`，13px，圆角 5px |
| `.btn-primary` | 背景 `--accent`，白字，悬停 `brightness(1.08)` |
| `.seg-btn` | `7px 14px`，13px，容器圆角 6px，选中白字 |
| `input/select` | `7px 10px`，14px，圆角 5px，聚焦边框 `--accent` |
| `.switch` | 40×22px，滑块 18×18px，`translateX(18px)`，0.2s |
| `.card` | 内边距 16px，圆角 8px，边框，下间距 14px |
| 侧边导航 | 宽 180px，项 `9px 12px`，圆角 6px，选中左侧 3px 指示条 |
| 表格 | `th 8px 10px`、`td 7px 10px`、sticky 表头、单行省略 |
| 滚动条 | 8px，滑块 `--selected`，悬停 `--accent` |

### 7.6 任务表格与 ui_state

沿用 ui-design.md 的表格交互：

- 任务表格列：

| 列 | 默认宽 | 最小宽 |
|---|---|---|
| 漫画 | 240px | 120px |
| 状态 | 110px | 90px |
| 进度 | 160px | 120px |
| 格式 | 300px | 160px |
| 操作 | 180px | 140px |

- 表头可拖拽排序（SortableJS `forceFallback` + `fallbackOnBody`）；
- 列宽调整用右侧 8px `.resize-handle`，相邻列补偿；
- 列序/列宽保存到 `%APPDATA%\comic2ebook\ui_state.json`，Rust 侧做最小宽度兜底；
- 表格外层最大高度 `calc(100vh - 150px)`，滚动条按规范。

### 7.7 与规范差异说明

- 规范中的“开关”用于二元设置（保留日志等）；格式多选不硬套分段按钮，使用 checkbox chip，避免单选语义误导。
- 规范表格是“推送列表”，Comic2Ebook 对应“任务列表”，列名不同但组件规范一致。

---

## 8. 迁移阶段

### Phase 0：脚手架与设计系统

范围：

- 创建 `tauri/` 工程（Vite + Tauri 2）；
- 引入字体、CSS 变量、三页面骨架；
- 确认 WebView2、`tauri build` 在 Windows 可跑通。

验收：

- `npm run tauri dev` 显示 转换/设置/关于 三页，主题切换正常；
- 窗口 1350×800，最小 900×500。

### Phase 1：Rust 数据层

范围：

- `appdata.rs`、`settings.rs`、`scan.rs`、`naming.rs`、`calibre.rs`、`logs.rs`；
- 单元测试先行（TDD）。

验收：

- `cargo test` 通过；
- 设置支持损坏文件备份重置；
- 自然排序覆盖 `1..10`、`001..010`、中文、特殊字符样本。

### Phase 2：输入列表与 CBZ

范围：

- 文件夹多选 + `scan_folder`；
- `pack.rs` 流式 CBZ + PNG 归一化；
- 转换页输入卡片 + 任务表骨架。

验收：

- 用 `samples/Comic-A~E` 打包 CBZ，顺序正确、300 张不卡 UI；
- 冲突重命名 / 覆盖 / 失败三种策略均生效。

### Phase 3：转换编排与 Calibre

范围：

- `orchestrator.rs` + `convert.rs`；
- `job:update / job:result / job:log` 事件；
- 取消、重试、10 分钟超时、半成品清理；
- 任务表格完整交互。

验收：

- 5 种格式链路全部跑通；
- 取消最后一个任务后 UI 不卡死（`busy` 可恢复）；
- 打包失败也会出现 `job:result` 并解除 `busy`；
- 日志可导出，上限 100。

### Phase 4：设置、主题、打包与清理

范围：

- 设置页完整落地并持久化；
- `ui_state.rs` 列宽/列序持久化；
- 输出目录记忆与 `sameAsSource / fixedDir`；
- Tauri NSIS/便携打包；
- 更新 README、TECHNICAL、settings-schema、回归清单；
- 删除 `app.html`、`preload.js`、`main.js`、`js/`、`vendor/` 与 Electron 依赖。

验收：

- `npm run tauri build` 产出安装包与便携目录；
- 断网启动/打包 CBZ 正常；
- 旧 `%APPDATA%\comic2ebook\settings.json` 可迁移到新配置；
- 按回归清单跑完所有手工用例。

---

## 9. 旧版已知问题修复对照

| 旧问题 | 新架构做法 |
|---|---|
| 取消/打包失败不发 `job:result`，UI busy 卡死 | Orchestrator 终态统一走 `finish_job()`，必发一次结果事件 |
| 保存设置整体覆盖丢字段 | `save_settings` 传完整 `Settings`；Rust 合并缺失字段 |
| Calibre 自定义路径不优先 | `calibre.rs` 先读 `settings.calibre_path` |
| `overwritePolicy` 不生效 | `naming.rs` 三种策略都实现 |
| 旧 IPC / JSZip 死代码 | 全新工程，无 Electron、无 preload、无渲染层打包 |
| 双份 Calibre 参数不一致 | 参数只在 `convert.rs` 定义一份 |
| 文档滞后 | 重构完成后统一重写技术文档 |

---

## 10. 测试与验收

### 10.1 Rust 单元测试

- `natural_sort`：数字/补零/中文/特殊字符；
- `sanitize_filename`：Windows 保留字符；
- `resolve_output_path`：rename / overwrite / fail；
- `build_calibre_args`：recommended / compatible 各格式；
- `settings`：默认值、roundtrip、损坏备份；
- `orchestrator`：状态机、取消必发 result、打包失败必发 result、并发上限；
- `pack`：小样本 CBZ 条目顺序、PNG Alpha 归一化。

### 10.2 前端测试

- `jobs-model`：任务状态合并、格式校验、busy 解除逻辑；
- `ui-state`：列宽/列序持久化边界。

### 10.3 手工回归

更新 `docs/regression-checklist.md` 后覆盖：

- 5 套 `samples/` 数据；
- 全部 5 格式；
- 多文件夹、失败不阻断、取消、重试；
- Calibre 缺失/路径错误；
- 断网、特殊字符、同名输出、大页数；
- 安装包与便携包启动。

---

## 11. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| WebView2 缺失或版本旧 | 白屏 | Windows 10/11 默认自带；安装包可带 bootstrap 检测 |
| Calibre CLI 参数跨版本差异 | 某格式失败 | 保留已知可用的参数集；日志记录完整命令行；兼容 profile 兜底 |
| 大本子打包内存高 | UI 卡顿/内存峰值 | `spawn_blocking` + 流式写入 + 事件节流；PNG 只处理带 Alpha 的图片 |
| 中日文/特殊字符路径 | 找不到文件或 zip 条目乱码 | Rust `PathBuf/OsString`；zip 条目使用清洗后的 UTF-8 名称；补回归样本 |
| 字体文件授权/体积 | 字体缺失 | 回退 `Segoe UI / system-ui`；字体打包前确认许可证 |
| 迁移期双版本并存 | 仓库混乱 | Tauri 工程放 `tauri/`，验收后再提升为根目录 |
| 并发状态竞态 | 事件丢失/重复 | `Arc<Mutex<JobManager>>` 串行化状态变更；终态幂等 |

---

## 12. 交付物

1. `tauri/` 完整工程（前端 + Rust）；
2. 安装包与便携产物（`tauri build` 输出）；
3. 更新后的 README / TECHNICAL / settings-schema / regression-checklist；
4. Rust 与前端自动化测试；
5. 本方案评审通过后的逐阶段实施记录。

---

## 13. 实施记录

实施状态：✅ 已完成至可打包测试（2026-08-09）

| 阶段 | 文档 | 状态 |
|---|---|---|
| Phase 0 脚手架与设计系统 | [phase-0.md](tauri-phases/phase-0.md) | ✅ |
| Phase 1 Rust 数据层 | [phase-1.md](tauri-phases/phase-1.md) | ✅ |
| Phase 2 输入与 CBZ | [phase-2.md](tauri-phases/phase-2.md) | ✅ |
| Phase 3 转换编排 | [phase-3.md](tauri-phases/phase-3.md) | ✅ |
| Phase 4 设置/主题/打包/文档 | [phase-4.md](tauri-phases/phase-4.md) | ✅ |
| 前端问题修复（页面切换/对齐/图标） | [frontend-fixes.md](tauri-phases/frontend-fixes.md) | ✅ |

验证结果：

- `npm test`：6/6 通过
- `cargo test`：10/10 通过
- `npm run tauri build`：成功生成 `Comic2Ebook_1.0.0_x64-setup.exe`

回归入口：[tauri2-regression-checklist.md](tauri2-regression-checklist.md)
