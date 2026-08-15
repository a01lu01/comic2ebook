# Comic2Ebook（Tauri 2 + Rust 版）

将图片漫画文件夹批量转换为电子书的桌面工具，支持 CBZ / PDF / EPUB / AZW3 / MOBI。

## 功能特性

- 批量选择漫画文件夹，支持多选
- 输出格式记忆，重启自动恢复
- 漫画目录记忆，选择器默认打开上次上级目录
- CBZ 流式打包，PNG Alpha 白底合成
- Calibre 多格式转换，静默启动、10 分钟超时
- 任务队列、取消、重试、清除已完成、清空全部
- 多格式合并日志，任务行只有一个日志按钮
- 双主题、自绘标题栏、表格列宽/列序记忆

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
- 发布用便携版：`tauri/portable/Comic2Ebook_1.0.0_x64.exe`

## 使用说明

1. 点击「选择文件夹」添加一个或多个漫画文件夹。
2. 勾选输出格式（默认 CBZ + PDF，选择会记忆）。
3. 选择统一输出目录；不选择时按漫画源文件夹输出。
4. 点击「开始转换」，任务表格实时显示进度。
5. 失败任务可重试；完成后可清除已完成或清空全部。
6. 多格式日志合并为一份，点击任务行的「日志」即可打开。

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