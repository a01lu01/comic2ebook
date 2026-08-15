# 前端问题修复记录（完成）

状态：✅ 完成  
日期：2026-08-09

## 问题

1. 切换页面无效，三个标签的内容实际上都显示在同一个页面。
2. “选择文件”等按钮与输入框/标签对齐不整齐。
3. 界面缺少符合漫画/电子书项目内容的图标。

## 修复内容

### 1. 页面切换

- 根因：`.page { display: flex }` 覆盖了 HTML `hidden` 属性的 UA 默认 `display: none`，导致三个 section 始终显示。
- 修复：在 [styles.css](D:/Coding/comic2ebook/tauri/src/styles.css) 增加：

```css
.page[hidden],
.toast[hidden] {
  display: none;
}
```

### 2. 工具栏对齐

- “漫画文件夹”按钮改为带标签的 `.field` 容器，与其他字段（输出目录、输出格式）共享标签 + 控件结构。
- `.toolbar-field` 固定宽度 170px，按钮占满宽度，底部与输入框/下拉框对齐。
- `.toolbar-actions` 使用 `margin-left: auto` 靠右对齐。

### 3. 图标

- 引入 `lucide-static` 图标包。
- 导航：转换 / 设置 / 关于 使用 book-open / settings / info。
- 按钮：选择文件夹、浏览、打开输出目录、复制路径、开始转换、移除、取消、重试、日志、保存均使用 lucide 线性图标。
- 应用图标：新增 [app-icon.svg](D:/Coding/comic2ebook/tauri/app-icon.svg)，紫色圆角底 + 白色翻开的书，使用 `tauri icon` 重新生成 `src-tauri/icons`。

## 验证记录

```text
npm test          → 6/6 通过
npm run build     → vite build 成功（27 modules）
npm run tauri build → 成功生成 Comic2Ebook_1.0.0_x64-setup.exe
```

## 相关文件

- `tauri/index.html`
- `tauri/src/styles.css`
- `tauri/src/main.js`
- `tauri/app-icon.svg`
- `tauri/src-tauri/icons/*`

---

# 第二次修复：exe 图标 + 视觉检查（完成）

状态：✅ 完成  
日期：2026-08-09

## 问题

1. exe 图标准确识别为 ntfy 的绿色铃铛，`icon.ico` 已是书本但 exe 资源未更新。
2. 使用视觉能力检查后发现：窗口标题栏与侧边栏重复显示 Comic2Ebook；选择文件夹按钮与输出目录控件宽度落差大。

## 修复内容

### exe 图标

- 根因：`cargo clean -p` 未删除构建脚本产出的窗口资源目录，`tauri-winres` 一直复用旧铃铛资源。
- 修复：删除 `src-tauri/target/release/build/comic2ebook-*` 与 `.fingerprint/comic2ebook-*` 后强制重编，书本图标已写入 exe。
- 用视觉脚本确认：exe 内图标为紫色底 + 白色打开书本，不再是铃铛。

### 双重标题

- 侧边栏品牌文字删除，只保留书本图标，不再与窗口标题栏重复。
- 关于页主标题改为“关于”，副标题只显示版本号。
- 视觉确认：Comic2Ebook 名称仅在窗口标题栏出现一次。

### 对齐

- 选择文件夹按钮字段宽度 170px → 220px，与输出目录控件更协调。
- 空列表增加最小高度并垂直居中，减少大片空白。
- 视觉确认：三页按钮、输入框、分段控件对齐良好，无重叠。

## 验证记录

```text
npm test              → 6/6 通过
npm run tauri build   → 成功
视觉脚本三页截图检查   → 无标题重复、无对齐/重叠问题
```

---

# 第三次修复：铃铛缓存 + 幽灵标题图标 + 纯文字导航（完成）

状态：✅ 完成  
日期：2026-08-09

## 问题

1. Explorer 仍显示绿色铃铛：旧路径 `portable/Comic2Ebook.exe` 被 Windows 图标缓存命中，测试残留 `Comic2Ebook-v2.exe` 也是旧资源。
2. 视觉截图确认“幽灵标题”是窗口标题栏自带的书本图标，以及三个导航标签的小图标。

## 修复内容

### exe 图标与缓存

- 删除测试残留 `Comic2Ebook-v2.exe`。
- 免安装版改为新文件名 `Comic2Ebook_1.0.0_x64.exe`，新路径无图标缓存，视觉确认是书本图标。
- 运行 `ie4uinit.exe -show` 刷新 Explorer 图标缓存，旧路径也会更新显示。

### 幽灵标题

- 关闭系统原生标题栏（`decorations: false`），改为自绘标题栏：
  - 只显示文字 `Comic2Ebook`
  - 右侧提供最小化 / 最大化 / 关闭按钮
  - 不再显示任何窗口图标
- 侧边栏顶部残留的书本图标整体删除。

### 纯文字导航

- “转换 / 设置 / 关于”三个标签移除所有 lucide 小图标，只保留文字。

## 验证记录

```text
npm run tauri build       → 成功
视觉脚本 exe 图标         → 紫色底 + 白色书本，不是铃铛
视觉脚本界面截图          → 标题栏无图标、导航纯文字、无重叠
```

---

# 第四次修复：Calibre 转换失败与命令窗口弹窗（完成）

状态：✅ 完成  
日期：2026-08-09

## 问题

- PDF / EPUB / AZW3 / MOBI 全部报 `Calibre 转换失败，退出码 1`。
- 转换时弹出命令窗口，没有静默启动。

## 根因

日志显示 Calibre Comic Input 报：

```text
ValueError: Could not find any pages in the comic: ...cbz
```

检查 CBZ 后发现条目名为 `001jpg`、`002jpg`，缺少 `.` 扩展名分隔符。原因是 Rust `Path::extension()` 返回不带点的扩展名，而旧 Electron 版用的是带点扩展名。Calibre 因此识别不出图片页面。

命令窗口弹窗是因为 `std::process::Command` 没有设置 Windows `CREATE_NO_WINDOW` 标志。

## 修复内容

- [pack.rs](D:/Coding/comic2ebook/tauri/src-tauri/src/pack.rs)：CBZ 条目扩展名改为带点格式（`001.jpg`）。
- [convert.rs](D:/Coding/comic2ebook/tauri/src-tauri/src/convert.rs)：Windows 下子进程增加 `creation_flags(0x08000000)`（CREATE_NO_WINDOW），静默启动 Calibre。
- 新增回归测试：打包断言条目名带点；Calibre 存在时执行真实 PDF 转换集成测试。

## 验证记录

```text
cargo test                          → 11/11 通过（含真实 Calibre PDF 转换）
npm run tauri build                 → 成功
```

---

# 第五次修复：窗口拖动 / 清除任务 / 深色描边 / 漫画列表（完成）

状态：✅ 完成  
日期：2026-08-15

## 修复内容

- 标题栏拖动：新增 `core:window:allow-start-dragging` 权限，并在 `.titlebar` 非按钮区域调用 `startDragging()`。
- 清除任务：任务卡片新增“清除已完成”与“清空全部”按钮；新增 Rust `clear_jobs` 命令，清空队列并取消运行中的任务。
- 深色主题分段按钮：外框与内部分隔线改用 `var(--border)`，选中项及相邻分隔线透明化，避免描边过重。
- 输入漫画列表：改为单行“文件张数 + 漫画名 + 移除”，漫画名使用主题色加粗，路径移入 `title` 提示。

## 验证记录

```text
npm test       → 6/6 通过
cargo test     → 11/11 通过
npm run tauri build → 成功
```


---

# 第六次修复：格式记忆 / 漫画目录记忆 / 合并日志（完成）

状态：✅ 完成
日期：2026-08-15

## 修复内容

- 输出格式：新增 `selectedFormats` 设置，勾选后立即保存，启动时自动恢复。
- 漫画目录：新增 `lastComicDir` 设置，记录上次选择漫画文件夹的父目录，下次文件对话框默认打开该目录。
- 合并日志：同一任务的多个格式共用一份日志文件（`{comicName}_all_{ts}.log`），任务行只显示一个“日志”按钮。

## 验证记录

```text
npm test       → 6/6 通过
cargo test     → 11/11 通过
npm run tauri build → 成功
```

---

# 第七次修复：漫画名居左与张数对齐（完成）

状态：✅ 完成
日期：2026-08-15

- 漫画名显式左对齐。
- 文件张数改为固定宽度列，两位数与三位数张数下漫画名仍保持对齐。

---

# 第八次修复：opener 权限与日志打开（完成）

状态：✅ 完成
日期：2026-08-15

- 首次修复：新增 `opener:allow-open-path` 权限。
- 二次修复：为 `open_path` 配置 `allow: [{ "path": "**" }]` 路径范围，解决 `Not allowed to open path` 报错。
- 日志按钮与“打开输出目录”均可正常使用。


---

# 第九次修复：无 CBZ 直接转换（完成）

状态：✅ 完成
日期：2026-08-16

- 不勾选 CBZ 时，内部在系统临时目录生成临时 CBZ，Calibre 直接转换 AZW3 / MOBI / PDF / EPUB。
- 转换完成、取消或清空时自动删除临时 CBZ。
- 新增临时 CBZ 生成与真实 Calibre AZW3 端到端测试。

---

# 第十次修复：临时 CBZ 提前删除导致后续格式失败（完成）

状态：✅ 完成
日期：2026-08-16

- 症状：不勾选 CBZ 时，AZW3 成功但 MOBI 失败，报 `Cannot read from ...cbz`。
- 根因：`finish_conversion` 在单个格式结束后就执行临时 CBZ 清理，未等全部格式完成。
- 修复：清理逻辑移入任务终态分支，只有没有 running / pending 子任务时才删除临时 CBZ。
- 验证：`cargo test` 13/13 通过；真实 Calibre AZW3 直转测试通过。
