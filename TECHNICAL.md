# Comic2Ebook 技术文档

> 将图片漫画批量转换为电子书的桌面工具。
> 基于 Electron + Calibre CLI，支持 CBZ / PDF / EPUB / AZW3 / MOBI。

---

## 目录

1. [项目架构](#1-项目架构)
2. [打包与分发](#2-打包与分发)
3. [转换流程](#3-转换流程)
4. [格式转换参数详解](#4-格式转换参数详解)
5. [IPC 通信协议](#5-ipc-通信协议)
6. [项目文件清单](#6-项目文件清单)
7. [开发与调试](#7-开发与调试)

---

## 1. 项目架构

### 1.1 技术栈

| 层 | 技术 | 版本 |
|---|---|---|
| 桌面框架 | Electron | ^41.3.0 |
| 前端 | 原生 HTML + CSS (暗色主题) | — |
| 主进程 | Node.js (Electron 内置) | v24.14.0 |
| 电子书转换 | Calibre CLI (`ebook-convert.exe`) | 外部依赖 |

### 1.2 进程模型

```
┌─────────────────────────────────────────────────────┐
│                    Electron App                      │
│                                                      │
│  ┌────────────────────┐    ┌────────────────────┐   │
│  │  主进程 main.js     │◄──►│  渲染进程 app.html   │   │
│  │                    │IPC │                      │   │
│  │  · 文件系统操作     │    │  · 用户界面           │   │
│  │  · Calibre 调用     │    │  · 进度显示           │   │
│  │  · CBZ 打包         │    │  · 结果列表           │   │
│  │  · 原生对话框       │    │                     │   │
│  └───────┬────────────┘    └────────────────────┘   │
│          │                                           │
│          ▼                                           │
│  ┌────────────────────┐                              │
│  │  Calibre CLI        │  (外部进程,通过 spawn 调用)   │
│  │  ebook-convert.exe  │                              │
│  └────────────────────┘                              │
└─────────────────────────────────────────────────────┘
```

### 1.3 通信方式

Electron 标准 IPC（`ipcMain.handle` / `ipcRenderer.invoke`）：

- **主进程** → 注册 8 个 IPC handlers 处理文件系统与 Calibre 操作
- **渲染进程** → 通过 `window.ipcRenderer` 调用（`did-finish-load` 时注入页面）
- **架构约束**：`nodeIntegration: true` + `contextIsolation: false`

---

## 2. 打包与分发

### 2.1 首次打包（electron-packager）

```bash
npx electron-packager . Comic2Ebook --platform=win32 --arch=x64 --out=dist
```

生成的目录结构：

```
dist/Comic2Ebook-win32-x64/
├── Comic2Ebook.exe          ← 主程序入口（约 223MB）
├── resources/
│   └── app/                 ← 我们的源码（main.js + app.html + package.json）
├── locales/
│   ├── zh-CN.pak            ← 中文语言包
│   └── en-US.pak            ← 英文语言包（fallback）
├── chrome_100_percent.pak   ← Chromium 1x 渲染资源
├── chrome_200_percent.pak   ← Chromium 2x 渲染资源（高DPI）
├── d3dcompiler_47.dll       ← Direct3D 编译器
├── dxcompiler.dll / dxil.dll← DirectX 编译支持
├── ffmpeg.dll               ← 媒体编解码
├── icudtl.dat               ← Unicode 支持
├── libEGL.dll / libGLESv2.dll ← 图形渲染
├── resources.pak            ← Chromium 资源包
├── snapshot_blob.bin        ← V8 堆快照
├── v8_context_snapshot.bin  ← V8 上下文快照
├── vk_swiftshader.dll 等    ← Vulkan 软渲染回退
├── LICENSE / version        ← 许可证 / 版本号
```

> **注意**：`locales/` 中冗余的 60 个语言包已清理，仅保留 `zh-CN.pak` 和 `en-US.pak`。

### 2.2 热更新（开发阶段）

修改源码后不需要重新打包 EXE，只需**覆盖 `dist/.../resources/app/` 下的对应文件**：

```bash
# 复制更新后的文件到打包目录
copy /Y main.js    dist\Comic2Ebook-win32-x64\resources\app\
copy /Y app.html   dist\Comic2Ebook-win32-x64\resources\app\
copy /Y package.json dist\Comic2Ebook-win32-x64\resources\app\
```

关闭所有 `Comic2Ebook.exe` 进程后重新打开即可。

### 2.3 打包目录清理

`resources/app/` 只需保留以下文件：

- `main.js` — Electron 主进程
- `app.html` — 渲染进程 UI
- `package.json` — 项目配置
- `node_modules/` — 依赖包（主要为 `electron` 及其子依赖）

其余设计文档、计划、临时脚本等均可删除。

---

## 3. 转换流程

### 3.1 总流程

```
┌──────────────┐    ┌──────────────┐    ┌──────────────────┐
│  用户选择      │    │  用户选择      │    │  选择输出目录      │
│  漫画文件夹    │    │  输出格式      │    │  (可选)          │
└──────┬───────┘    └──────┬───────┘    └──────┬───────────┘
       │                   │                   │
       ▼                   ▼                   ▼
┌──────────────────────────────────────────────────────────┐
│                    开始转换 (startConversion)              │
├──────────────────────────────────────────────────────────┤
│  ① 清空 state.results                                    │
│  ② 遍历每个漫画文件夹 → 执行转换                          │
│     └─ 每个 Comic:                                        │
│        ├─ (1) packCBZ: 打包 CBZ                         │
│        ├─ (2) calibreConvert: 调用 Calibre 转换          │
│        └─ (3) 记录结果                                    │
└──────────────────────────────────────────────────────────┘
```

### 3.2 CBZ（Comic Book ZIP）

CBZ 是所有后续格式的**基础步骤**。渲染进程通过 IPC 逐张读取图片，写入 ZIP 文件。

**流程：**

```
packCBZ(comicDir, outputDir)
  │
  ├─ IPC: fs:list-images(comicDir)     → 获取排序后的图片列表
  │
  ├─ IPC: fs:read-image(dir, fileName) → 逐张读取图片（base64）
  │
  ├─ 用 JSZip 创建 ZIP
  │   ├─ 图片按顺序写入（保持原始文件名）
  │   └─ ComicInfo.xml（可选漫画元数据）
  │
  ├─ IPC: fs:write-file(cbzPath, data) → 写入 .cbz 文件到输出目录
  │
  └─ 返回 CBZ 文件路径
```

**关键实现细节：**

- 图片排序：按文件名自然排序（`Array.sort()`）
- 编码：`base64` → `Buffer`（在渲染进程中通过 `atob` + `Uint8Array` 转二进制）
- Electron 模式：`fs:write-file` 直接通过 IPC 写入本地文件系统，不走浏览器下载

### 3.3 PDF / EPUB / AZW3 / MOBI（Calibre 转换）

在 CBZ 打包完成后，通过 `child_process.spawn` 调用 `ebook-convert.exe`：

```
calibreConvert(cbzPath, outputDir, format, comicName)
  │
  ├─ 拼接命令行参数（格式专用 + 通用参数）
  │
  ├─ spawn("ebook-convert.exe", [args...])
  │
  ├─ 实时输出 stdout/stderr 到渲染进程
  │
  └─ 返回结果：成功路径 / 错误信息
```

**转换模式：**

- **Calibre 已就绪**：自动执行 `spawn`，实时推送进度到 UI
- **Calibre 不可用**：不执行转换，在结果中标注"❌ 待脚本转换"

### 3.4 进度反馈

`calibre:convert` IPC 在转换过程中通过 `event.sender.send('conversion-progress', data)` 推送进度：

```
{ comicName, format, stage: "starting" | "converting" | "done" | "error", message }
```

渲染进程更新对应条目的状态标签。

---

## 4. 格式转换参数详解

### 4.1 通用参数（所有 Calibre 格式）

| 参数 | 作用 |
|---|---|
| `--remove-first-image` | 移除 Calibre 自动生成的文字封面页，确保第一张漫画图作为封面 |
| `--base-font-size=12` | 基础字号（虽然漫画格式不依赖，但避免默认值过大） |
| `--linearize-tables` | 优化表格排版（漫画无表格，无害兼容） |

### 4.2 CBZ → PDF

| 参数 | 作用 |
|---|---|
| `--paper-size=a4` | A4 纸张尺寸（210×297mm） |
| `--pdf-page-margin-top=0` | 页边距归零，最大限度展示漫画 |
| `--pdf-page-margin-bottom=0` | |
| `--pdf-page-margin-left=0` | |
| `--pdf-page-margin-right=0` | |
| `--pdf-add-toc=false` | 不生成目录（漫画不需要） |
| `--pdf-disable-kerning=true` | 禁用字距调整（漫画文字少，加快渲染） |
| `--pdf-default-font-size=0` | 不强制设置字号 |

### 4.3 CBZ → EPUB

| 参数 | 作用 |
|---|---|
| `--no-default-epub-cover` | **关键**：不使用 Calibre 生成的默认文字封面 |
| `--epub-inline-toc` | 内联目录（可选，不影响漫画阅读） |
| `--dont-split-on-page-breaks` | 不拆分页面，保持整页漫画完整 |

> **封面机制**：`--remove-first-image`（通用参数）+ `--no-default-epub-cover` 组合确保 EPUB 第一张漫画图直接被识别为封面，不会插入文字封面页。

### 4.4 CBZ → MOBI

| 参数 | 作用 |
|---|---|
| `--mobi-keep-original-images` | **关键**：保留原始图片比例，不被 Calibre 强制缩放 |
| `--mobi-file-type=both` | 同时生成 `old`（KF7）和 `new`（KF8）格式，兼容更多 Kindle |
| `--prefer-metadata-cover` | 优先使用元数据中指定的封面（即第一张图） |

> **图片比例问题**：MOBI 是问题最多的格式。`--mobi-keep-original-images` 防止 Calibre 将漫画图片拉伸/裁剪到 Kindle 屏幕比例。`--mobi-file-type=both` 确保在新旧 Kindle 上都能正确显示第一页。

### 4.5 CBZ → AZW3

| 参数 | 作用 |
|---|---|
| `--prefer-metadata-cover` | 优先使用元数据封面（第一张漫画图） |
| `--dont-split-on-page-breaks` | 不拆分页面 |

> AZW3（KF8）是 MOBI 的继任格式，图片兼容性通常更好，所以参数较少。

### 4.6 参数对照总表

```
通用参数（所有格式）：
  --remove-first-image
  --base-font-size=12
  --linearize-tables

格式        | 额外参数
────────────┼─────────────────────────────────────────────────────
PDF         | --paper-size=a4
            | --pdf-page-margin-*=0（上下左右）
            | --pdf-add-toc=false
            | --pdf-disable-kerning=true
            | --pdf-default-font-size=0
────────────┼─────────────────────────────────────────────────────
EPUB        | --no-default-epub-cover
            | --epub-inline-toc
            | --dont-split-on-page-breaks
────────────┼─────────────────────────────────────────────────────
MOBI        | --mobi-keep-original-images
            | --mobi-file-type=both
            | --prefer-metadata-cover
────────────┼─────────────────────────────────────────────────────
AZW3        | --prefer-metadata-cover
            | --dont-split-on-page-breaks
```

---

## 5. IPC 通信协议

### 5.1 IPC Handler 清单

| 通道 | 方向 | 参数 | 返回值 | 用途 |
|---|---|---|---|---|
| `calibre:check` | 渲染→主 | — | `{ found, path }` | 检测 Calibre 是否安装 |
| `calibre:convert` | 渲染→主（流式） | `{ cbzPath, outputDir, format, comicName }` | `{ success, path, error }` | 执行格式转换，实时推进度 |
| `fs:open-comic-directories` | 渲染→主 | — | `[{ name, path }]` | 原生多选文件夹对话框 |
| `fs:list-images` | 渲染→主 | `dirPath` | `[fileName]` | 列出目录内的图片文件 |
| `fs:read-image` | 渲染→主 | `{ dirPath, fileName }` | `base64` | 读取图片为 base64 |
| `fs:write-file` | 渲染→主 | `{ filePath, data }` | `boolean` | 写入文件（CBZ） |
| `fs:open-directory` | 渲染→主 | — | `path \| null` | 选择输出目录 |
| `fs:open-path` | 渲染→主 | `path` | — | 用系统文件管理器打开路径 |

### 5.2 推送事件

| 事件 | 方向 | 数据 | 用途 |
|---|---|---|---|
| `conversion-progress` | 主→渲染 | `{ comicName, format, stage, message }` | 实时转换进度 |

### 5.3 初始化顺序

```
1. 渲染进程加载 app.html
2. 调用 detectCalibre()（走 window.ipcRenderer，首次可能为 undefined）
3. main.js 触发 did-finish-load
4. 注入 window.ipcRenderer = require('electron').ipcRenderer
5. 重新运行 detectCalibre() + updateStartBtn()
```

渲染进程使用轮询等待 `window.ipcRenderer` 就绪：

```javascript
function waitForIpcRenderer(retries = 50) {
    return new Promise((resolve, reject) => {
        const check = (n) => {
            if (window.ipcRenderer) resolve();
            else if (n <= 0) reject(new Error('ipcRenderer not available'));
            else setTimeout(() => check(n - 1), 100);
        };
        check(retries);
    });
}
```

---

## 6. 项目文件清单

### 6.1 根目录

```
comic2ebook/
├── app.html              ← 渲染进程 UI（界面 + 转换逻辑）
├── main.js               ← Electron 主进程（IPC handlers + Calibre 调用）
├── package.json          ← 项目配置（electron 依赖）
├── package-lock.json     ← 依赖锁文件
├── node_modules/         ← npm 依赖包
├── dist/                 ← electron-packager 输出目录
│   └── Comic2Ebook-win32-x64/
│       ├── Comic2Ebook.exe
│       └── resources/app/  ← 覆盖更新的目标目录
├── TECHINCAL.md          ← 本文档
```

### 6.2 关键实现文件对照

| 文件 | 行数（约） | 核心功能 |
|---|---|---|
| `main.js` | ~220 行 | 8 个 IPC handlers、Calibre 子进程管理、窗口创建 |
| `app.html` | ~760 行 | 完整 UI 布局、JSZip CBZ 打包、格式选择、进度管理 |

---

## 7. 开发与调试

### 7.1 本地运行

```bash
# 安装依赖
cd comic2ebook
npm install

# 启动 Electron（热加载模式，直接运行）
npx electron .
```

### 7.2 增量更新打包

```bash
# 覆盖打包目录下的对应文件
copy /Y main.js    dist\Comic2Ebook-win32-x64\resources\app\
copy /Y app.html   dist\Comic2Ebook-win32-x64\resources\app\
copy /Y package.json dist\Comic2Ebook-win32-x64\resources\app\
```

### 7.3 Calibre 环境要求

`ebook-convert.exe` 必须在系统 PATH 中，或用户在设置中手动指定路径。

检测逻辑（`main.js`）：

```javascript
// 1. 尝试用户设置的路径
// 2. 尝试环境变量中的 ebook-convert
// 3. 检查默认安装目录
// 4. 返回 { found: true/false, path: "..." }
```

### 7.4 常见问题

**Q: 转换后封面不正确？**  
A: 检查 `--remove-first-image` 和 `--no-default-epub-cover` 是否存在。EPUB/MOBI/AZW3 需要这两个参数配合。

**Q: MOBI 图片比例变形？**  
A: 确认 `--mobi-keep-original-images` 参数生效。这是 MOBI 格式最关键的参数。

**Q: Calibre 检测不到？**  
A: 检查环境变量 PATH 是否包含 Calibre 安装目录（通常为 `C:\Program Files\Calibre2\`），或在设置页面手动填写路径。

**Q: 打包后打开闪退？**  
A: 检查 `resources/app/` 目录下 `main.js` 是否有语法错误。可在控制台 `npx electron .` 直接运行测试。

---

> 文档版本：v1.0 | 最后更新：2026-04-30 | 维护者：雪豹
