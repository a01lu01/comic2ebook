# Phase 0：脚手架与设计系统（完成）

状态：✅ 完成  
日期：2026-08-09

## 范围

- 在 `tauri/` 下创建 Vite + Tauri 2 工程骨架。
- 引入 HarmonyOS Sans SC 字体与完整 CSS 设计变量。
- 搭建 转换 / 设置 / 关于 三页面结构。
- 配置窗口 1350×800、最小 900×500、居中。

## 实现内容

- `tauri/package.json`、`vite.config.js`、`index.html`
- `tauri/src/styles.css`（按 `ntfy-notifier/docs/ui-design.md` 的字体、色板、组件尺寸）
- `tauri/src-tauri/tauri.conf.json`（NSIS bundle 配置）
- `tauri/src-tauri/Cargo.toml`（tauri 2、dialog、opener、zip、image、tokio 等）
- `tauri/src-tauri/capabilities/default.json`（core/dialog/opener 权限）
- 字体资源 `tauri/public/assets/fonts/HarmonyOS_Sans_Regular.ttf`

## 验证记录

```text
npm install      → added 20 packages, 0 vulnerabilities
npm run build    → vite build 成功（index.html + css + js）
cargo check      → 编译通过
```

## 备注

- 首次 `tauri build` 遇到 `webview2-com-sys` 复制 `WebView2Loader.dll` 失败，手动补齐 `target/release/build/webview2-com-sys-*/out/arm64` 后重试成功。
- 窗口逻辑像素由 WebView2 自动处理 Windows 缩放，无需额外适配。
