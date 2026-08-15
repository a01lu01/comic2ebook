# Phase 3：转换编排与 Calibre（完成）

状态：✅ 完成  
日期：2026-08-09

## 范围

- 任务队列与并发调度（打包 2、转换 1）。
- Calibre 转换、进度解析、日志流。
- 取消、重试、10 分钟超时。
- 统一 `job:update / job:result / job:log` 事件。

## 实现内容

- `src-tauri/src/orchestrator.rs`：`JobManager` 队列、active/results、终态必发 `job:result`
- `src-tauri/src/convert.rs`：Calibre 参数单一来源、stdout/stderr 解析、退出码判断
- `src-tauri/src/ui_state.rs`：任务表格列宽/列序持久化
- 前端任务表格：状态、进度、格式标签、取消/重试/日志操作

## 关键设计

- 取消与打包失败都进入 `finalize_job` 路径，解决旧 Electron 版 `busy` 卡死问题。
- 转换失败按 Calibre 退出码记录，不再无条件标记成功。
- 事件带 `jobId`，前端按 job 合并更新。

## 验证记录

```text
cargo check → 通过
cargo test → 10/10 通过
npm test → 6/6 通过
```
