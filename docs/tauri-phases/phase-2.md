# Phase 2：输入列表与 CBZ（完成）

状态：✅ 完成  
日期：2026-08-09

## 范围

- 文件夹多选 + 扫描预览。
- Rust 流式 CBZ 打包。
- PNG Alpha 白底合成并转 RGB。
- 转换页输入卡片与任务表格骨架。

## 实现内容

- `src-tauri/src/pack.rs`：`zip` crate Stored 打包、补零条目名、取消时清理半成品
- `scan_folder` 命令返回 `ComicPreview`
- 前端文件夹列表：名称、页数、主扩展名、移除按钮
- 输出目录选择与记忆

## 验证记录

```text
cargo test pack::tests::pack_small_cbz → ok
npm run build → 成功
```

## 备注

- 打包在 `spawn_blocking` 中执行，不阻塞 WebView2 主线程。
- 进度每 10 张或最后一张回调一次。
