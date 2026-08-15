# Comic2Ebook

将图片漫画文件夹批量转换为电子书的 Windows 桌面工具，基于 Tauri 2 + Rust，支持 CBZ / PDF / EPUB / AZW3 / MOBI。

## 功能特性

- **批量选择** - 一次选择多个漫画文件夹，批量处理
- **输出格式记忆** - 上次勾选的格式会在重启后自动恢复
- **漫画目录记忆** - 文件对话框默认打开上次选择漫画的上级目录
- **自动打包 CBZ** - 图片自然排序打包为 Comic Book ZIP，PNG Alpha 自动白底合成
- **可跳过 CBZ** - 不勾选 CBZ 时内部临时打包后直接转 AZW3 / MOBI / PDF / EPUB，用户目录不生成 CBZ
- **多格式转换** - 基于 Calibre `ebook-convert` 生成 PDF / EPUB / AZW3 / MOBI
- **Calibre 集成** - 自动检测，也支持设置页手动指定路径
- **任务管理** - 队列、并发调度、取消、重试、清除已完成、清空全部
- **合并日志** - 同一漫画的多格式转换共用一份日志，任务行只有一个日志按钮
- **自绘窗口** - 双主题、侧边导航、可拖动标题栏、无原生窗口图标
- **免安装分发** - 单个 EXE 直接运行，安装包约 2.6 MB

## 支持格式

| 格式 | 说明 | 适用场景 |
|---|---|---|
| CBZ | Comic Book ZIP，纯压缩包 | 本地阅读、漫画管理 |
| PDF | 位图页面 | 通用文档阅读 |
| EPUB | 电子书标准格式 | 手机/平板阅读 |
| AZW3 | Kindle KF8 格式 | Kindle 设备 |
| MOBI | 旧版 Kindle 格式 | 老款 Kindle 兼容 |

## 系统要求

- Windows 10/11（x64）
- WebView2 运行时（Windows 10/11 默认自带）
- Calibre（可选，转换 PDF / EPUB / AZW3 / MOBI 必须）
  - 下载地址：https://calibre-ebook.com/download
  - 安装后会自动检测，也可在设置页手动指定 `ebook-convert.exe`
- Node.js 与 Rust（仅开发 / 打包需要）

## 下载使用

### 免安装版

`tauri/portable/Comic2Ebook_1.0.0_x64.exe`，双击直接运行。

### 安装包

`tauri/src-tauri/target/release/bundle/nsis/Comic2Ebook_1.0.0_x64-setup.exe`。

### 自行打包

```bash
cd tauri
npm install
npm run tauri build
```

## 使用方法

1. 点击「选择文件夹」添加一个或多个漫画文件夹。
2. 勾选输出格式，选择统一输出目录；不选择时按漫画源文件夹输出。
3. 点击「开始转换」，任务表格实时显示进度。
4. 任务失败可重试，取消后可清除；多格式日志合并为一份。
5. 转换完成后可通过任务行日志按钮或「打开输出目录」查看结果。

## 开发

```bash
cd tauri
npm install
npm run tauri dev
```

## 技术栈

- Tauri 2 + Rust
- Vite + 原生 JavaScript
- `zip` / `image` crate
- Calibre CLI（外部依赖）

## 项目结构

```text
comic2ebook/
├── tauri/                 # Tauri 2 + Rust 重构版
│   ├── src/               # 前端页面与样式
│   ├── src-tauri/         # Rust 后端
│   └── portable/          # 免安装 EXE 产物（不提交）
├── docs/                  # 方案、阶段记录、回归清单
└── samples/               # 测试样本
```

## Calibre 参数说明

| 格式 | 关键参数 |
|---|---|
| 通用 | `--no-process --dont-grayscale --dont-normalize --dont-sharpen --landscape` |
| PDF | A4 纸张、四边零边距 |
| EPUB | `--no-chapters-in-toc --prefer-metadata-cover --no-default-epub-cover` |
| MOBI | `--mobi-keep-original-images --mobi-file-type=new` |
| AZW3 | `--no-chapters-in-toc --prefer-metadata-cover` |

## License

MIT