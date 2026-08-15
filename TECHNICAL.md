# Comic2Ebook 技术文档

> Tauri 2 + Rust 版。旧 Electron 文档已由本文档取代。

---

## 1. 项目架构

### 1.1 技术栈

| 层 | 技术 |
|---|---|
| 桌面框架 | Tauri 2 |
| Rust 后端 | Rust 2021 edition |
| 前端 | Vite + 原生 HTML / CSS / JavaScript |
| 图片打包 | `zip` crate（Stored 压缩） |
| PNG 归一化 | `image` crate |
| 电子书转换 | Calibre CLI（`ebook-convert.exe`，外部依赖） |

### 1.2 进程模型

```text
┌─────────────────────────────────────────────┐
│ WebView2 前端（Vite 构建）                    │
│ 转换 / 设置 / 关于 三页                       │
└──────────────────┬──────────────────────────┘
                   │ invoke + event
┌──────────────────▼──────────────────────────┐
│ Rust 后端                                   │
│ settings / scan / naming / calibre          │
│ pack / convert / orchestrator / logs        │
│ ui_state                                    │
└──────────────────┬──────────────────────────┘
                   │ CREATE_NO_WINDOW 子进程
┌──────────────────▼──────────────────────────┐
│ Calibre ebook-convert.exe                   │
└─────────────────────────────────────────────┘
```

### 1.3 窗口与标题栏

- 窗口使用 `decorations: false`，自绘标题栏，仅显示文字与窗口控制按钮。
- 标题栏通过 `core:window:allow-start-dragging` 和 `startDragging()` 支持拖动。

---

## 2. Rust 模块

| 模块 | 职责 |
|---|---|
| `appdata.rs` | `%APPDATA%\comic2ebook` 路径 |
| `settings.rs` | 设置读写、原子保存、损坏备份重置 |
| `scan.rs` | 图片扫描、自然排序 |
| `naming.rs` | 文件名清洗、rename / overwrite / fail 策略 |
| `calibre.rs` | `ebook-convert` 检测 |
| `pack.rs` | CBZ 流式打包、PNG Alpha 归一化 |
| `convert.rs` | Calibre 参数、子进程、进度解析、静默启动 |
| `orchestrator.rs` | 队列、并发、取消、重试、清空、事件广播 |
| `logs.rs` | 合并日志、追加、导出、上限 100 |
| `ui_state.rs` | 任务表格列宽/列序持久化 |
| `lib.rs` | Tauri 命令注册与状态管理 |

---

## 3. IPC 契约

### 3.1 Commands

| 命令 | 说明 |
|---|---|
| `scan_folder` | 扫描文件夹并返回图片数量与主扩展名 |
| `check_calibre` | 检测 Calibre 路径 |
| `get_settings` / `save_settings` | 设置读取与保存 |
| `enqueue_jobs` | 入队转换任务 |
| `cancel_job` | 取消单个运行任务 |
| `clear_jobs` | 清空队列并取消全部运行任务 |
| `retry_job` | 重试失败任务 |
| `export_log` | 读取日志内容 |
| `get_ui_state` / `save_ui_state` | 表格状态持久化 |
| `get_app_info` | 关于页版本信息 |

文件/文件夹选择通过 `tauri-plugin-dialog` 前端 API 完成；打开路径通过 `tauri-plugin-opener` 完成。

### 3.2 Events

| 事件 | 说明 |
|---|---|
| `job:update` | 任务状态、子任务进度 |
| `job:result` | 任务终态结果 |
| `job:log` | Calibre stdout/stderr 实时流 |

---

## 4. 核心流程

1. 前端选择漫画文件夹，调用 `scan_folder` 生成预览。
2. `enqueue_jobs` 创建 Job，`Orchestrator` 控制打包并发与转换并发。
3. 需要 CBZ 时先由 `pack.rs` 流式打包；PNG 带 Alpha 时白底合成并输出 RGB。不勾选 CBZ 时会在系统临时目录生成临时 CBZ，转换完成后自动删除。
4. 每个漫画使用一份合并日志（`{漫画名}_all_{时间}.log`），所有 Calibre 格式追加写入。
5. Calibre 子进程以 `CREATE_NO_WINDOW` 静默启动，解析 `NN%` 进度。
6. 任务进入 done / failed / cancelled 时发送 `job:result`；取消、失败、重试、清空均不会阻塞后续任务。

---

## 5. 数据目录

- 设置：`%APPDATA%\comic2ebook\settings.json`
- 表格状态：`%APPDATA%\comic2ebook\ui_state.json`
- 日志：`%APPDATA%\comic2ebook\logs\`

设置字段见 [settings-schema.md](./docs/settings-schema.md)。

---

## 6. 打包与发布

```bash
cd tauri
npm install
npm run tauri build
```

产物：

- 安装包：`tauri/src-tauri/target/release/bundle/nsis/Comic2Ebook_1.0.0_x64-setup.exe`
- 免安装 EXE：`tauri/src-tauri/target/release/comic2ebook.exe`
- 发布用便携版：`tauri/portable/Comic2Ebook_1.0.0_x64.exe`

---

## 7. 测试

```bash
cd tauri
npm test

cd src-tauri
cargo test
```

回归清单：[tauri2-regression-checklist.md](./docs/tauri2-regression-checklist.md)。

---

> 文档版本：v2.0 | 最后更新：2026-08-15