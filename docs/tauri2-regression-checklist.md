# Comic2Ebook（Tauri 2）回归检查清单

> 适用：`tauri/` 重构版。每次改动后按此清单验证。

## 一、构建与启动

- [ ] `cd tauri && npm install`
- [ ] `npm test` 全部通过
- [ ] `cd tauri/src-tauri && cargo test` 全部通过
- [ ] `cd tauri && npm run tauri dev` 窗口打开，三页可切换
- [ ] `npm run tauri build` 产出 `Comic2Ebook_1.0.0_x64-setup.exe`

## 二、基本功能

- [ ] 选择 `samples/Comic-A-1-10`，仅 CBZ，转换成功且页序 1..10
- [ ] 选择 `samples/Comic-B-001-010`，CBZ + PDF，输出到指定目录
- [ ] 同时选择 Comic-A/B/C，全部 5 格式，失败不阻断后续任务
- [ ] 同名输出再次转换：默认自动重命名 `(1)`
- [ ] 覆盖策略设为“覆盖”时同名文件被覆盖
- [ ] 覆盖策略设为“失败”时同名文件报 `E_OUTPUT_EXISTS`

## 三、边界与异常

- [ ] 中文/特殊字符文件夹名可正常打包
- [ ] 大页数样本（300 张）打包时 UI 不卡死
- [ ] 空文件夹提示“没有找到图片文件”
- [ ] 取消最后一个任务后“开始转换”可恢复
- [ ] 打包失败后任务进入失败态且可重试
- [ ] Calibre 缺失时 CBZ 仍可用，其他格式标记失败

## 四、设置与持久化

- [ ] Calibre 自定义路径在设置页生效
- [ ] 主题切换即时生效，重启后保留
- [ ] 输出目录记忆，重启后回显
- [ ] 表格列宽调整后重启恢复
- [ ] `%APPDATA%\comic2ebook\settings.json` 损坏后自动备份并重置

## 五、日志

- [ ] 转换日志写入 `%APPDATA%\comic2ebook\logs\`
- [ ] 日志按钮可打开对应文件
- [ ] 日志数量超过 100 自动清理最旧

## 六、打包验证

- [ ] 双击安装包安装成功，应用可启动
- [ ] 断网启动 UI 正常，无外链资源缺失
