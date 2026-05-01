# Comic2Ebook

将图片漫画文件夹批量转换为电子书的桌面工具，支持 CBZ / PDF / EPUB / AZW3 / MOBI 五种格式。

![Dark theme preview](https://img.shields.io/badge/theme-dark%20default-08090a?style=for-the-badge)

---

## 功能特性

- 📂 **批量选择** — 一次选择多个漫画文件夹，批量处理
- 🖼️ **自动打包 CBZ** — 图片自动排序打包为 Comic Book ZIP
- 🔄 **多格式转换** — 基于 Calibre `ebook-convert` 一键生成 PDF / EPUB / AZW3 / MOBI
- ⚙️ **Calibre 集成** — 自动检测本机 Calibre 安装，智能选择转换参数
- 🖥️ **Windows 原生风格** — 暗色主题，文件对话框、进度跟踪、开目录操作均走系统原生 API
- 📦 **单文件 EXE** — 无需安装，直接运行

## 支持格式

| 格式 | 说明 | 适用场景 |
|---|---|---|
| **CBZ** | Comic Book ZIP，纯压缩包 | 本地阅读、漫画管理 |
| **PDF** | 矢量/位图混合 | 通用文档阅读 |
| **EPUB** | 电子书标准格式 | 手机/平板阅读 |
| **AZW3** | Kindle KF8 格式 | Kindle 设备 |
| **MOBI** | 旧版 Kindle 格式 | 老款 Kindle 兼容 |

## 系统要求

- Windows 10/11（x64）
- **Calibre**（可选，转换 PDF/EPUB/AZW3/MOBI 必须）
  - 下载地址：https://calibre-ebook.com/download
  - 安装后将 `ebook-convert.exe` 加入 PATH，或在工具设置中手动指定路径
- **Node.js**（仅开发 / 打包需要）

## 下载使用

### 方式一：直接运行 EXE（推荐）

下载最新版本，解压后双击 `Comic2Ebook.exe` 即可运行。

> ⚠️ 部分安全软件可能拦截，请允许运行。

### 方式二：自行打包

```bash
# 克隆仓库
git clone https://github.com/a01lu01/comic2ebook.git
cd comic2ebook

# 安装依赖
npm install

# 打包为 Windows EXE
npx electron-packager . Comic2Ebook --platform=win32 --arch=x64 --out=dist
```

打包后的 EXE 位于 `dist/Comic2Ebook-win32-x64/Comic2Ebook.exe`。

## 使用方法

1. **选择漫画文件夹** — 点击「选择文件夹」或拖拽文件夹到窗口，支持多选
2. **选择输出格式** — 勾选需要的格式（默认 CBZ + PDF）
3. **指定输出目录** — 点击「选择目录」指定转换文件存放位置
4. **开始转换** — 点击「开始」，实时查看每个格式的转换进度
5. **打开输出目录** — 转换完成后点击底部「📂 打开输出目录」

## 开发

```bash
# 本地运行（开发模式）
npm install
npx electron .
```

修改代码后直接刷新即可，无需重启 Electron。

## 技术栈

- **Electron** ^41.3.0 — 桌面框架
- **JSZip**（CDN）— CBZ 打包
- **Calibre CLI** — 电子书格式转换

## 项目结构

```
comic2ebook/
├── app.html          # 渲染进程：UI + 转换逻辑
├── main.js           # 主进程：IPC handlers + Calibre 调用
├── package.json      # 项目配置
├── TECHNICAL.md      # 详细技术文档
└── dist/             # 打包输出（不在 git 中）
```

## Calibre 参数说明

不同格式有不同的转换参数，以下是关键参数：

| 格式 | 关键参数 | 说明 |
|---|---|---|
| 通用 | `--remove-first-image` | 移除 Calibre 生成的文字封面 |
| PDF | `--pdf-page-margin-*=0` | 页边距归零，最大化漫画展示 |
| EPUB | `--no-default-epub-cover` | 禁用默认文字封面 |
| MOBI | `--mobi-keep-original-images` | 保留原始图片比例 |
| MOBI | `--mobi-file-type=both` | 同时生成 KF7/KF8 格式 |

详见 [TECHNICAL.md](./TECHNICAL.md)。

## License

MIT
