# Phase 1：Rust 数据层（完成）

状态：✅ 完成  
日期：2026-08-09

## 范围

- 设置持久化与旧 Electron 设置兼容读取。
- 目录扫描与自然排序。
- 文件名清洗与三种覆盖策略。
- Calibre 检测（设置路径优先 → PATH → 常见安装目录）。
- 日志创建/追加/导出/修剪。

## 实现内容

- `src-tauri/src/appdata.rs`：`%APPDATA%\comic2ebook`
- `src-tauri/src/settings.rs`：schemaVersion、原子写、损坏文件备份重置
- `src-tauri/src/scan.rs`：自然排序 + 图片扩展名过滤 + 预览
- `src-tauri/src/naming.rs`：Windows 保留字符清洗 + rename/overwrite/fail
- `src-tauri/src/calibre.rs`：异步检测 `ebook-convert`
- `src-tauri/src/logs.rs`：上限 100 个日志文件
- `src-tauri/src/api.rs` / `models.rs`：统一错误与数据模型

## 验证记录

```text
cargo test → 10 passed, 0 failed
```

覆盖用例：自然排序（无补零/补零/中文）、文件名清洗、保留设备名、冲突重命名、覆盖策略、Calibre 参数、小样本 CBZ 打包。
