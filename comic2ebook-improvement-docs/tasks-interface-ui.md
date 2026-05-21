# Comic2Ebook 任务清单（加一层：接口签名草案 + UI 交互规则）

这份文档在 `tasks.md` 的基础上补充：
- IPC/Preload API：通道名、入参、出参（草案）
- 事件：push 事件结构
- UI 交互：按钮、状态、文案、禁用规则、失败展示

默认策略：
- 绿色便携版优先
- ComicInfo.xml 可选（默认 off）
- 输出目录默认统一目录（同一 output dir，不分子目录）
- overwritePolicy 默认 rename（避免静默覆盖）

---

## 1. 统一数据模型（跨阶段通用）

### 1.1 Comic（输入单位）
```ts
type Comic = {
  comicId: string;
  name: string;
  path: string;
}
```

### 1.2 Job（执行单位）
```ts
type JobStage = 'queued' | 'precheck' | 'packing' | 'converting' | 'done' | 'failed' | 'cancelled';

type Job = {
  jobId: string;
  comicId: string;
  comicName: string;
  comicPath: string;
  formats: Array<'cbz'|'pdf'|'epub'|'azw3'|'mobi'>;
  output: {
    mode: 'sameAsSource' | 'fixedDir';
    fixedDir?: string;
  };
  options: {
    overwritePolicy: 'rename' | 'fail' | 'overwrite';
    profile: 'recommended' | 'compatible';
    cbzComicInfo: 'off' | 'on';
  };
  stage: JobStage;
  format?: 'cbz'|'pdf'|'epub'|'azw3'|'mobi';
  percent: number;
  message?: string;
  startedAt?: number;
  finishedAt?: number;
  outputs?: Array<{ format: string; path: string }>;
  error?: {
    code: string;
    message: string;
    detail?: string;
    command?: string;
    exitCode?: number;
  };
}
```

### 1.3 Settings（持久化配置）
```ts
type Settings = {
  schemaVersion: 1;
  calibrePath: string;
  outputMode: 'sameAsSource' | 'fixedDir';
  fixedOutputDir: string;
  overwritePolicy: 'rename' | 'fail' | 'overwrite';
  profile: 'recommended' | 'compatible';
  cbzComicInfo: 'off' | 'on';
  packingConcurrency: number;
  convertConcurrency: number;
}
```

---

## 2. IPC / Preload API 设计（最终形态草案）

Phase 1 可以先用旧 IPC（ipcMain.handle + renderer invoke）；Phase 2 起迁移到 preload 暴露 `window.api`。

### 2.1 invoke 类 API（preload 暴露）
```ts
window.api = {
  openComicDirs(): Promise<Comic[]>,
  chooseOutputDir(): Promise<{ path: string } | null>,

  getSettings(): Promise<Settings>,
  setSettings(patch: Partial<Settings>): Promise<Settings>,
  resetSettings(): Promise<Settings>,

  enqueueJobs(payload: {
    comics: Comic[];
    formats: Job['formats'];
    output?: { mode?: Settings['outputMode']; fixedDir?: string };
    options?: Partial<Job['options']>;
  }): Promise<{ jobIds: string[] }>,

  cancelJob(jobId: string): Promise<{ ok: true } | { ok: false; error: { code: string; message: string } }>,
  retryJob(jobId: string): Promise<{ newJobId: string } | { error: { code: string; message: string } }>,

  exportLogs(payload: { scope: 'all' | 'job'; jobId?: string }): Promise<{ path: string }>,
  revealInExplorer(path: string): Promise<{ ok: true }>,
}
```

### 2.2 events（preload 暴露订阅）
```ts
window.api.onJobUpdate((evt: JobUpdateEvent) => void)
window.api.onJobResult((evt: JobResultEvent) => void)
window.api.onToast((evt: { level:'info'|'warn'|'error', message:string }) => void)
```

事件结构：
```ts
type JobUpdateEvent = {
  jobId: string;
  comicId: string;
  comicName: string;
  stage: JobStage;
  format?: Job['format'];
  percent: number;
  message?: string;
  severity?: 'info' | 'warn' | 'error';
  ts: number;
}

type JobResultEvent = {
  jobId: string;
  ok: boolean;
  outputs?: Array<{ format: string; path: string }>;
  durationMs: number;
  warnings?: string[];
  error?: Job['error'];
}
```

---

## 3. UI 交互规范（最终形态，渲染层规则）

### 3.1 顶栏（Calibre 状态）
- 展示：`Calibre：已连接 / 未检测到 / 路径无效`
- 交互：点击状态 chip → 打开设置 modal（聚焦 Calibre 路径）
- 按钮禁用规则建议：
  - 仅勾选 CBZ：允许开始
  - 勾选了非 CBZ 且 Calibre 不可用：允许开始，但这些格式在任务里标为 skipped/failed（二选一，推荐 skipped）

### 3.2 漫画列表（输入）
- 每项显示：文件夹名、路径省略、预检信息（可选）
- 操作：移除单项、打开源目录（可选）
- 去重：重复添加同一路径 → 合并并 toast 提示

### 3.3 设置面板（关键项）
- 输出格式：CBZ/PDF/EPUB/AZW3/MOBI
- 输出目录：
  - 默认：与源同目录（sameAsSource）
  - 可选：固定目录（fixedDir）
- 覆盖策略（默认 rename）：rename / fail / overwrite
- Profile：recommended / compatible
- CBZ ComicInfo.xml：off / on（默认 off）

### 3.4 任务列表（进度）
- 每个 Job 显示：comicName、stage、percent、format tag、各格式 ok/ing/failed/skipped
- 操作按钮（按状态显示）：
  - queued/packing/converting：取消
  - failed：重试 / 导出日志 / 复制错误
  - done：打开输出目录 / 导出日志
  - cancelled：重试

### 3.5 错误展示规范
- 摘要：`error.message`
- 详情（折叠）：code / exitCode / command / stderr 最后 N 行
- 导出日志：toast + 可复制路径

---

## 4. 任务对照（补充接口与 UI 规则）

### Phase 1
- P1-01：无新增 API，纯资源替换
- P1-02：无新增 API，排序正确性通过样例目录验收
- P1-03：输出命名清洗失败时的错误码建议 `E_OUTPUT_NAME_INVALID`
- P1-04：覆盖策略发生 rename 时 message 提示：`已存在，已重命名为 xxx(1).pdf`
- P1-06：所有 handler 返回 `{success,data?,error?}`，UI 统一 renderError

### Phase 2
- P2-01：新增 preload 暴露 `window.api`，渲染层禁用 require
- P2-03：新增 `getSettings/setSettings`
- P2-06：新增 `cancelJob(jobId)`；UI 取消按钮点击后进入“正在取消…”
- P2-07：新增 `exportLogs({scope:'job', jobId})`

### Phase 3
- P3-01：新增 `enqueueJobs`；开始按钮在队列运行时变为“追加到队列”
- P3-02：新增 `onJobUpdate/onJobResult`；TaskStore 合并更新
- P3-04：packing 阶段 message：`正在打包 CBZ（x/y）`，支持取消并清理半成品
- P3-05：cbzComicInfo on/off 生效，UI 在设置中控制
- P3-08：retry 生成新 jobId，旧 job 保留历史

### Phase 4
- P4-01：electron-builder portable 优先；日志与设置写入 userData
- P4-02：移除字体/脚本外链，断网启动无资源缺失

---

## 5. UI 文案建议（可直接复制）
- Calibre 未检测到：`未检测到 Calibre（仅 CBZ 可用）`
- Calibre 路径无效：`Calibre 路径无效，请在设置中重新选择`
- packing：`正在打包 CBZ（{current}/{total}）`
- converting：`正在转换 {format}（{percent}%）`
- cancelled：`已取消`
- failed：`失败：{error.message}`
- rename：`目标文件已存在，已自动重命名：{newName}`
