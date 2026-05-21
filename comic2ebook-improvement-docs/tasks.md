# Comic2Ebook 开发任务清单（完整详细版）

说明：
- 本清单按 Phase 1→4 渐进落地。
- 每个任务都包含：范围、改动文件、验收标准、回滚点。
- 默认策略已按你选择固化：绿色便携版优先 / ComicInfo.xml 可选 / 默认统一输出目录。

---

## Phase 0：基线与准备（建议先做，避免重构回归）

### P0-01 建立样例测试数据目录（手工/脚本生成均可）
- 范围：准备一套“可重复验证”的漫画目录样本，覆盖命名、排序、字符集、大页数等情况。
- 产物建议目录：
  - `samples/Comic-A-1-10/`（1.jpg 2.jpg 10.jpg）
  - `samples/Comic-B-001-010/`（001.jpg…010.jpg）
  - `samples/Comic-C-中文命名/`
  - `samples/Comic-D-特殊字符/`（含 `[]()&` 等）
  - `samples/Comic-E-大页数/`（至少 300 张，最好 1000 张）
- 验收：
  - 每个样例目录在 Windows 上可正常读取与排序
- 回滚点：
  - 无（纯新增）

### P0-02 定义“回归检查清单”（手工测试 checklist）
- 范围：把关键流程固定成可执行的手工回归步骤。
- 内容建议（至少）：
  - 选择单文件夹 → CBZ
  - 选择多文件夹 → CBZ+PDF
  - Calibre 缺失 → 提示 + CBZ 仍可用
  - 转换失败 → 显示错误 + 可导出日志
- 产物：`docs/regression-checklist.md`
- 验收：
  - 新人按 checklist 可复测主要功能
- 回滚点：
  - 无（纯新增）

---

## Phase 1：小改（快速收益：离线/排序/参数一致性/错误提示）

### P1-01 移除 JSZip CDN，改为本地静态资源
- 范围：断网情况下仍能打包 CBZ。
- 改动文件：
  - `app.html`（替换 script src）
  - 新增 `vendor/jszip.min.js`（或同等本地路径）
- 验收：
  - Windows 断网运行：CBZ 打包成功
  - 打包后的绿色版断网运行：CBZ 打包成功
- 回滚点：
  - 恢复 CDN 引用（不建议长期）

### P1-02 实现自然排序并替换图片列表排序
- 范围：修复页序错乱。
- 改动文件：
  - `main.js`（`fs:list-images` 排序逻辑）
- 验收（必须用样例目录验证）：
  - `1.jpg 2.jpg 10.jpg` 顺序正确
  - `001.jpg…010.jpg` 顺序正确
  - 中文与混合字符文件名排序稳定
- 回滚点：
  - 恢复 `.sort()`（会回到旧问题）

### P1-03 输出命名清洗（Windows 文件名安全）
- 范围：输出文件名避免 Windows 保留字符导致写文件失败。
- 改动文件：
  - `main.js`（输出命名处：folderName → safeName）
- 验收：
  - 含 `:` `*` `?` `"` `<` `>` `|` 的文件夹名仍可输出成功
- 回滚点：
  - 恢复原命名（会有失败风险）

### P1-04 覆盖策略最小实现（默认不静默覆盖）
- 范围：目标文件已存在时，默认自动重命名避免覆盖。
- 改动文件：
  - `main.js`（写文件前检测）
  - `app.html`（提示策略/可选显示）
- 验收：
  - 同名输出重复执行不会覆盖原文件
  - 自动生成 `(1) (2)` 或时间戳后缀（择一）
- 回滚点：
  - 恢复覆盖（风险：用户文件丢失）

### P1-05 Calibre 参数集中化（生成参数函数）
- 范围：把参数拼装收口，避免散落难维护。
- 改动文件：
  - `main.js`（提取 `buildCalibreArgs(format, profile)` 之类）
- 验收：
  - 所有格式转换仍正常
  - 日志中能看到完整命令行（便于诊断）
- 回滚点：
  - 恢复原拼装方式

### P1-06 错误结构化返回（IPC handler 统一 success/error）
- 范围：任何 IPC 失败都返回结构化错误给 UI。
- 改动文件：
  - `main.js`（每个 handler try/catch，统一返回结构）
  - `app.html`（统一处理 error）
- 验收：
  - Calibre 缺失/路径错误/权限问题不崩溃
  - UI 有明确错误摘要 + 可复制详情
- 回滚点：
  - 恢复直接 throw/返回空数组（定位困难）

---

## Phase 2：中改（preload 隔离 + 设置持久化 + 取消）

### P2-01 引入 preload.js，开启 contextIsolation
- 范围：渲染进程不再直接 require Node/electron。
- 改动文件：
  - `main.js`（BrowserWindow webPreferences 调整）
  - 新增 `preload.js`（暴露 `window.api`）
  - `app.html`（从 `ipcRenderer` 调用迁移到 `window.api`）
- 验收：
  - 功能不变
  - 渲染进程无法直接访问 Node API
- 回滚点：
  - 恢复 nodeIntegration 注入方案

### P2-02 设计 settings schema（含默认值）
- 范围：明确所有设置项与默认行为（与你偏好一致）。
- 建议 schema：
  - `schemaVersion: 1`
  - `calibrePath: ""`
  - `outputMode: "sameAsSource" | "fixedDir"`
  - `fixedOutputDir: ""`
  - `overwritePolicy: "rename" | "fail" | "overwrite"`（默认 rename）
  - `profile: "recommended" | "compatible"`（默认 recommended）
  - `cbzComicInfo: "off" | "on"`（默认 off）
  - `packingConcurrency: 2`（Phase3 启用）
  - `convertConcurrency: 1`（Phase3 启用）
- 产物：`docs/settings-schema.md`（可选，但建议写）
- 验收：
  - schemaVersion 存在，未来可迁移
- 回滚点：
  - 无（纯定义）

### P2-03 SettingsService（userData/settings.json 读写）
- 范围：实现 get/set settings，持久化到 userData。
- 改动文件：
  - `main.js`（新增 IPC：getSettings/setSettings）
  - 新增 `src` 结构可暂缓；也可先内联实现
- 验收：
  - 重启后设置保留
  - settings.json 损坏时能自动回退默认值并提示
- 回滚点：
  - 恢复无设置（体验下降）

### P2-04 设置 UI（最小可用：Calibre 路径 / 输出模式 / 覆盖策略 / ComicInfo 开关 / profile）
- 范围：用户可配置关键行为。
- 改动文件：
  - `app.html`（新增 modal / settings 区域）
- 验收：
  - Calibre 路径可选择并立即生效
  - outputMode=fixedDir 时可选择固定目录
  - cbzComicInfo 开关可保存并影响打包
- 回滚点：
  - 不提供 UI（只能手改配置）

### P2-05 Calibre 检测逻辑升级：优先使用 settings.calibrePath
- 范围：兼容非默认安装路径与便携 Calibre。
- 改动文件：
  - `main.js`（`calibre:check` / convert 逻辑）
- 验收：
  - calibrePath 指向正确 exe 时：检测 ok
  - calibrePath 错误时：提示清晰并引导修复
- 回滚点：
  - 恢复仅猜测路径（兼容性差）

### P2-06 引入“取消转换”能力（先覆盖 converting）
- 范围：用户可取消 Calibre 转换，避免长时间卡住。
- 改动文件：
  - `main.js`：维护 `jobId -> childProcess` 映射；新增 IPC `cancelJob`
  - `app.html`：每个任务显示取消按钮
- 验收：
  - converting 阶段取消：任务进入 cancelled
  - 取消不影响其它任务继续
- 回滚点：
  - 移除 cancel（可控性差）

### P2-07 日志导出（最小版：导出当前任务 stderr/stdout 拼接）
- 范围：用户能导出日志文件用于排查。
- 改动文件：
  - `main.js`：新增 `exportLogs` IPC（写到 userData/logs/）
  - `app.html`：按钮触发导出并提示路径
- 验收：
  - 导出文件包含：task 标识、时间、命令行、stdout/stderr、exitCode
- 回滚点：
  - 无导出（定位困难）

---

## Phase 3：大改核心（任务系统 + 主进程流式打包 + 统一进度协议）

### P3-01 引入 Job/Task 的数据模型（jobId/comicId）
- 范围：所有操作以 jobId 为单位，统一状态机。
- 改动文件：
  - 建议新增：`src/main/task/orchestrator.js`
  - `preload.js`：暴露 enqueue/cancel/retry
  - `app.html`：渲染任务列表基于 jobId
- 验收：
  - UI 能显示 queued/packing/converting/done/failed/cancelled
- 回滚点：
  - 退回“直接循环处理”（难扩展）

### P3-02 统一事件协议 job:update / job:result
- 范围：所有阶段进度用统一事件推送，渲染层只订阅 store。
- 改动文件：
  - `main.js` / orchestrator：统一 send
  - `preload.js`：`onJobUpdate` / `onJobResult`
  - `app.html`：TaskStore 合并更新
- 验收：
  - 任何状态变化都能通过 job:update 驱动 UI
- 回滚点：
  - 继续多事件散落（维护成本高）

### P3-03 FsService：listImages + naturalSort + ignoreRules（可选）
- 范围：把文件系统逻辑从 handler 中抽出，便于测试。
- 改动文件：
  - 新增 `src/main/services/fs.js`
  - `main.js` 调用 FsService
- 验收：
  - listImages 对扩展名过滤正确
  - 自然排序测试用例全部通过
- 回滚点：
  - 内联在 handler（可行但不优雅）

### P3-04 PackService：主进程流式打包 CBZ（替代渲染 JSZip）
- 范围：不再通过 IPC 逐张读图到渲染进程。
- 改动文件：
  - 新增 `src/main/services/pack.js`
  - 删除/废弃 IPC：`fs:read-image`（或保留但不再用于主流程）
  - `app.html`：移除 JSZip 打包逻辑，改为调用 `enqueueJobs`
- 依赖选择（落地时再定）：
  - 引入 zip 库（推荐）
- 验收：
  - 1000 张图打包不爆内存、速度可接受
  - packing 可取消：立即停止并清理半成品
- 回滚点：
  - 回到渲染 JSZip（性能较差）

### P3-05 ComicInfo.xml 写入（可选项，按 settings.cbzComicInfo 控制）
- 范围：cbzComicInfo=on 时，在 zip 内写入 ComicInfo.xml；off 时不写。
- 改动文件：
  - `src/main/services/pack.js`
  - `src/main/services/settings.js`
- 最小字段建议：
  - Title（默认 folderName）
  - Series（可空）
  - Number（可空）
  - Language（默认 zh）
- 验收：
  - on/off 开关生效
  - 生成的 CBZ 可被常见阅读器识别（至少不破坏 CBZ）
- 回滚点：
  - 始终不写（功能减少）

### P3-06 ConvertService：抽象 Calibre 调用与进度解析
- 范围：把 spawn、stdout/stderr 解析、exitCode 错误标准化收口。
- 改动文件：
  - 新增 `src/main/services/convert.js`
  - orchestrator 调用 ConvertService
- 验收：
  - stdout 含百分比时 percent 更新
  - 无百分比时仍有阶段性 message 更新
  - 失败 error 包含 command/exitCode/stderr 摘要
- 回滚点：
  - handler 里直接 spawn（可用但不可测）

### P3-07 Orchestrator：并发控制与队列调度
- 范围：实现 packingConcurrency=2、convertConcurrency=1 的调度器。
- 改动文件：
  - `src/main/task/orchestrator.js`
- 验收：
  - 多任务入队：最多同时 2 个 packing、1 个 converting
  - 一个失败不影响后续任务
- 回滚点：
  - 单线程串行（性能较差但简单）

### P3-08 Retry：失败任务可重试（生成新 jobId）
- 范围：failed job 可重试，保留原 job 的参数与输入。
- 改动文件：
  - orchestrator + preload + renderer
- 验收：
  - failed job 一键重试后进入 queued 并可成功完成
- 回滚点：
  - 无重试（体验差）

### P3-09 LogService：按 jobId 聚合日志（ring buffer + 导出）
- 范围：日志不再散在 UI 变量里，统一归档。
- 改动文件：
  - 新增 `src/main/services/log.js`
  - exportLogs 改为读 LogService
- 验收：
  - UI 可查看最近 N 行
  - 导出包含完整上下文
- 回滚点：
  - 继续临时拼接（易丢信息）

---

## Phase 4：绿色版发布闭环（electron-builder）

### P4-01 引入 electron-builder 配置（portable 优先）
- 范围：构建产出便携包（portable）。
- 改动文件：
  - `package.json`：增加 build 配置与 scripts
  - （可选）新增 `build/` 资源（icon、nsis 配置等）
- 验收：
  - 本地可打出 portable
  - 产物解压即用
- 回滚点：
  - 保持 electron-packager（发布能力弱）

### P4-02 移除所有外部网络依赖（彻底离线）
- 范围：确保 UI 字体、脚本、资源都本地化。
- 改动点示例：
  - Google Fonts 改为系统字体或内置字体文件
  - JSZip/其他库全部本地
- 验收：
  - 断网运行 UI 无明显资源缺失
- 回滚点：
  - 恢复外链（离线不稳）

### P4-03 版本号与变更记录流程
- 范围：便于分发迭代。
- 改动文件：
  - `CHANGELOG.md`
  - `package.json` version 策略
- 验收：
  - 每次发布有对应 changelog 条目
- 回滚点：
  - 无（建议保留）

### P4-04 最小自动化测试（建议）
- 范围：至少覆盖“排序/命名/参数拼装”三块纯逻辑。
- 工具选择：
  - 保持轻量即可（任选 Node 测试框架；也可先写 node 脚本自测）
- 验收：
  - 一键运行测试通过
- 回滚点：
  - 无测试（后续回归成本高）

---

## 附：任务依赖关系（快速导航）
- P1-01（离线 JSZip）应尽早做，避免后续发布被外链卡死
- P2-01（preload 隔离）建议在 Phase 3 之前完成，否则重构时边界更混乱
- P3-04（主进程打包）是性能跃迁关键点，建议 Phase 3 优先
- P4-02（移除外链）建议与 P4-01 一起做，确保绿色版离线体验

## 附：建议的里程碑验收（你可以按阶段打 tag）
- v0.1：完成 Phase 1（离线/排序/错误提示）
- v0.2：完成 Phase 2（preload/设置/取消/日志导出）
- v0.3：完成 Phase 3（任务系统/主进程打包/统一协议/重试）
- v1.0：完成 Phase 4（electron-builder 绿色版发布闭环 + 最小测试）
