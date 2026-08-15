# Comic2Ebook（Tauri 2 + Rust 版）

将图片漫画文件夹批量转换为电子书的桌面工具，支持 CBZ / PDF / EPUB / AZW3 / MOBI。

本目录是重构版前端与 Rust 后端，旧 Electron 版仍保留在仓库根目录，验收通过后可移除。

## 开发运行

```bash
cd tauri
npm install
npm run tauri dev
```

## 测试

```bash
# 前端模型测试
npm test

# Rust 单元测试
cd src-tauri
cargo test
```

## 打包

```bash
cd tauri
npm run tauri build
```

产物：

- 安装包：`tauri/src-tauri/target/release/bundle/nsis/Comic2Ebook_1.0.0_x64-setup.exe`
- 免安装 exe：`tauri/src-tauri/target/release/comic2ebook.exe`

## 使用说明

1. 点击“选择文件夹”添加一个或多个漫画文件夹。
2. 勾选输出格式（默认 CBZ + PDF）。
3. 选择统一输出目录；不选择时按漫画源文件夹输出。
4. 点击“开始转换”，任务表格实时显示进度。
5. 失败任务可重试，转换日志可在任务行打开。

PDF / EPUB / AZW3 / MOBI 需要本机安装 Calibre，或在设置页手动指定 `ebook-convert.exe`。

## 数据目录

- 设置：`%APPDATA%\comic2ebook\settings.json`
- 表格状态：`%APPDATA%\comic2ebook\ui_state.json`
- 日志：`%APPDATA%\comic2ebook\logs\`

## 技术栈

- Tauri 2 + Rust
- Vite + 原生 JS
- `zip` / `image` crate
- Calibre CLI（外部依赖）
- 前端设计规范：`D:\Coding\ntfy-notifier\docs\ui-design.md`
