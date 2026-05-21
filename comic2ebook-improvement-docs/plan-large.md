# Comic2Ebook 改进方案（大改：工程化重构 + 可发布产品形态）

## 1. 目标

把 Comic2Ebook 从“可用的小工具”升级到“可稳定分发的桌面产品”：
- 稳定性：完善的错误分级、任务隔离、可重试/可取消、日志与诊断
- 性能：大任务低内存，IO/CPU 可控，必要时利用多进程/Worker
- 离线与分发：构建产物不依赖外网；提供安装包/便携包；版本与更新链路清晰
- 可维护性：模块化边界清晰；具备基础自动化测试与打包 CI 的空间
- 可扩展性：未来加“PDF 直转/CBR/CBZ 输入/元数据刮削”等不会越改越乱

## 2. 总体架构（建议）

### 2.1 分层
- Main（主进程）
  - Task Orchestrator（任务调度/并发控制/取消）
  - File Service（扫描/排序/读写/输出命名）
  - Pack Service（CBZ 打包，流式）
  - Convert Service（Calibre 调用，日志与进度解析）
  - Settings Service（持久化、迁移、默认值）
- Renderer（渲染进程）
  - UI（列表、设置、进度）
  - ViewModel（只处理展示状态，不做重 IO）
- Preload（桥接层）
  - `window.api` 最小能力集
  - 事件订阅（progress / task-update / logs）

### 2.2 数据与协议统一（关键）
- 统一事件：`task:update`
  - `{taskId, comicName, stage, format, percent, message, severity}`
- 统一结果：`task:result`
  - `{taskId, outputs:[{format,path}], durationMs, warnings, error?}`

## 3. 关键能力（大改交付清单）

### 3.1 高性能 CBZ 打包（流式）
- 不把图片内容搬到渲染进程
- 直接在主进程用流式 zip 写出
- 支持：
  - 自然排序
  - 忽略规则（可配置）
  - 进度推送（按文件数/字节数）

### 3.2 任务并发与资源控制
- 并发策略可配置（默认保守）
- 针对 Calibre：
  - 默认单并发
  - 可限制同时转换数量
- 资源保护：
  - 对超大文件夹做预检查（预计输出大小、页数）
  - 磁盘空间不足时提前失败并提示

### 3.3 配置系统与迁移
- Settings 结构版本化（`schemaVersion`）
- 支持未来升级时自动迁移
- 设置项覆盖：
  - Calibre 路径
  - 输出策略（同目录/指定目录/按书名分目录）
  - 覆盖策略（禁止覆盖/自动重命名/询问）
  - 参数档位（推荐/兼容/自定义）
  - 并发与性能策略
  - 日志级别

### 3.4 体验增强（产品化）
- 任务控制
  - 全局暂停/继续
  - 单任务取消/重试
  - 失败定位（点击打开日志、打开源目录、打开输出目录）
- 输入增强（可选）
  - 拖拽文件夹/批量选择/扫描根目录自动识别子书
  - 预检：显示页数、预计输出体积、缺失页/异常文件
- 元数据（可选但强烈建议）
  - 解析文件夹名生成 Title/Series/Index
  - 写入到 EPUB/AZW3/MOBI
  - CBZ 写入 ComicInfo.xml

### 3.5 发布链路（electron-builder）
- 产物
  - 安装包（NSIS）
  - 便携版（portable）
- 版本号与变更记录
- 可选：自动更新（若你未来需要）
- 离线依赖
  - JSZip/zip 库本地化
  - 字体/图标本地化
  - 禁止外部 CDN

## 4. 工程结构建议（大改）

建议引入 `src/` 并拆分为：
- `src/main/`
  - `index.js`
  - `ipc.js`
  - `services/pack.js`
  - `services/convert.js`
  - `services/settings.js`
  - `services/fs.js`
  - `task/orchestrator.js`
- `src/preload/`
  - `index.js`
- `src/renderer/`
  - `index.html`
  - `ui/`
  - `state/`
  - `components/`（即使不用框架也可以模块化）
- `docs/`
  - 设计与发布文档
- `scripts/`
  - 构建/打包脚本

可选：引入 TypeScript（收益：稳定性与可维护性更强；成本：构建与类型迁移）

## 5. 实施路径（推荐分阶段，降低风险）

### Phase 0：冻结现状与基线
- 加入“最小手工测试清单”
- 记录现有行为与参数（避免重构后功能回退）

### Phase 1：安全模型 + IPC API 重构
- contextIsolation + preload
- 渲染进程去 Node 权限
- 统一事件协议

### Phase 2：任务系统 + CBZ 打包主进程化
- Orchestrator + 并发控制
- pack 服务流式实现
- 大文件夹性能验证

### Phase 3：配置系统 + 体验增强
- settings 持久化 + 迁移
- 取消/重试/日志导出
- 输出策略与覆盖策略

### Phase 4：发布工程化
- electron-builder 打包
- 图标、版本、安装包、便携包
- （可选）CI 自动构建发布

## 6. 验收标准（产品级）
- 稳定性
  - 任意任务失败不影响队列
  - 可取消且不残留“无法退出”的子进程
- 性能
  - 100 本 × 500 页的批量处理：内存稳定，不出现长时间卡死 UI
- 离线
  - 断网仍可 CBZ 打包与 UI 正常工作（转换除外取决于 Calibre）
- 发布
  - 可生成安装包与便携包，用户无需开发环境即可运行
- 可维护
  - 核心服务可被单元测试覆盖（至少排序/命名/参数拼装/进度解析）

## 7. 风险与边界
- 引入 electron-builder、任务系统、服务拆分会显著增加改动面
- Calibre 本身是外部依赖，无法保证所有设备/版本行为一致
- 若未来要支持 CBR/RAR/PDF 输入，可能需要额外的解包/渲染链路（应作为后续扩展，不塞进第一阶段）
