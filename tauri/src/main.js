import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";

import {
  allTerminal,
  isActive,
  mergeTask,
  overallProgress,
  statusInfo,
} from "./jobs-model.js";
import { loadUiState, saveUiState } from "./ui-state.js";
import { collectWidths, setupTaskTable } from "./table-drag.js";

import circleX from "lucide-static/icons/circle-x.svg?raw";
import copySvg from "lucide-static/icons/copy.svg?raw";
import fileTextSvg from "lucide-static/icons/file-text.svg?raw";
import folderOpenSvg from "lucide-static/icons/folder-open.svg?raw";
import folderSvg from "lucide-static/icons/folder.svg?raw";
import folderUpSvg from "lucide-static/icons/folder-up.svg?raw";
import playSvg from "lucide-static/icons/play.svg?raw";
import rotateCwSvg from "lucide-static/icons/rotate-cw.svg?raw";
import saveSvg from "lucide-static/icons/save.svg?raw";
import xSvg from "lucide-static/icons/x.svg?raw";

const DEFAULT_SETTINGS = {
  schemaVersion: 1,
  calibrePath: "",
  outputMode: "sameAsSource",
  fixedOutputDir: "",
  overwritePolicy: "rename",
  profile: "recommended",
  packingConcurrency: 2,
  convertConcurrency: 1,
  themeMode: "system",
  keepLogs: true,
};

const state = {
  folders: [],
  tasks: [],
  formats: ["cbz", "pdf"],
  outputDir: null,
  busy: false,
  calibrePath: null,
  settings: { ...DEFAULT_SETTINGS },
};

const $ = (id) => document.getElementById(id);
const els = {
  nav: $("nav"),
  convertSubtitle: $("convert-subtitle"),
  folderList: $("folder-list"),
  folderCount: $("folder-count"),
  pickFolders: $("pick-folders"),
  outputDir: $("output-dir"),
  browseOutput: $("browse-output"),
  formatChips: $("format-chips"),
  startBtn: $("start-btn"),
  openOutput: $("open-output"),
  copyOutput: $("copy-output"),
  taskBody: $("task-body"),
  taskEmpty: $("task-empty"),
  taskCount: $("task-count"),
  clearFinishedBtn: $("clear-finished"),
  clearAllBtn: $("clear-all"),
  taskTable: $("task-table"),
  calibrePath: $("calibre-path"),
  browseCalibre: $("browse-calibre"),
  calibreStatus: $("calibre-status"),
  profileSeg: $("profile-seg"),
  overwriteSeg: $("overwrite-seg"),
  packConc: $("pack-conc"),
  convertConc: $("convert-conc"),
  keepLogs: $("keep-logs"),
  themeSeg: $("theme-seg"),
  settingsSave: $("settings-save"),
  toast: $("toast"),
  aboutVersion: document.querySelector("#page-about .page-subtitle"),
};

const PAGES = [
  { id: "convert", label: "转换" },
  { id: "settings", label: "设置" },
  { id: "about", label: "关于" },
];

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = String(str ?? "");
  return div.innerHTML;
}

function icon(svg) {
  return `<span class="btn-icon">${svg}</span>`;
}

function setBtnIcon(id, svg) {
  const el = $(id);
  if (!el) return;
  const span = document.createElement("span");
  span.className = "btn-icon";
  span.innerHTML = svg;
  el.prepend(span);
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    els.toast.hidden = true;
  }, 3500);
}

function buildNav() {
  els.nav.innerHTML = PAGES.map(
    (p) =>
      `<button class="nav-item" data-page="${p.id}">${escapeHtml(p.label)}</button>`
  ).join("");
  els.nav.addEventListener("click", (e) => {
    const item = e.target.closest(".nav-item");
    if (item) switchPage(item.dataset.page);
  });
}

function switchPage(id) {
  document.querySelectorAll(".page").forEach((page) => {
    page.hidden = page.id !== `page-${id}`;
  });
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.page === id);
  });
}

function applyTheme(mode = state.settings.themeMode || "system") {
  const theme =
    mode === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : mode;
  document.documentElement.dataset.theme = theme;
}

async function saveSettingsSilently() {
  try {
    const saved = await invoke("save_settings", {
      settings: { ...state.settings },
    });
    state.settings = saved;
  } catch {
    // settings modal has explicit error path
  }
}

async function addFolder(dirPath) {
  if (state.folders.some((f) => f.path === dirPath)) {
    toast("该文件夹已在列表中");
    return;
  }
  try {
    const preview = await invoke("scan_folder", { folder: dirPath });
    state.folders.push(preview);
    renderFolders();
  } catch (err) {
    toast(`无法添加文件夹：${err.message || err}`);
  }
}

function renderFolders() {
  els.folderCount.textContent = `${state.folders.length} 个文件夹`;
  if (state.folders.length === 0) {
    els.folderList.innerHTML =
      '<div class="empty">尚未选择文件夹</div>';
  } else {
    els.folderList.innerHTML = state.folders
      .map(
        (f) => `
        <div class="folder-item">
          <span class="folder-count">${f.imageCount} 张</span>
          <span class="folder-name" title="${escapeHtml(f.path)}">${escapeHtml(f.name)}</span>
          <button class="btn" data-remove="${escapeHtml(f.path)}">${icon(xSvg)}<span>移除</span></button>
        </div>`
      )
      .join("");
  }
  updateStart();
}

function renderTasks() {
  els.taskCount.textContent = `${state.tasks.length} 个任务`;
  els.taskEmpty.hidden = state.tasks.length > 0;
  els.taskTable.hidden = state.tasks.length === 0;
  els.taskBody.innerHTML = state.tasks.map(taskHtml).join("");
  const terminal = ["done", "failed", "cancelled"];
  els.clearFinishedBtn.disabled = !state.tasks.some((t) => terminal.includes(t.status));
  els.clearAllBtn.disabled = state.tasks.length === 0;
}

function taskHtml(task) {
  const info = statusInfo(task);
  const pct = overallProgress(task);
  const subTags = (task.subTasks || [])
    .map((s) => {
      const cls =
        s.status === "done"
          ? "ok"
          : s.status === "running"
            ? "ing"
            : s.status === "failed"
              ? "fail"
              : "";
      const prefix =
        s.status === "done"
          ? "✓ "
          : s.status === "running"
            ? "↻ "
            : s.status === "failed"
              ? "✗ "
              : "";
      return `<span class="format-tag ${cls}">${prefix}${escapeHtml(
        s.format.toUpperCase()
      )}</span>`;
    })
    .join("");

  const actions = [];
  if (isActive(task)) {
    actions.push(
      `<button class="btn" data-action="cancel" data-jobid="${escapeHtml(
        task.jobId
      )}">${icon(circleX)}<span>取消</span></button>`
    );
  }
  if (task.status === "failed") {
    actions.push(
      `<button class="btn" data-action="retry" data-jobid="${escapeHtml(
        task.jobId
      )}">${icon(rotateCwSvg)}<span>重试</span></button>`
    );
  }
  for (const r of task.results || []) {
    if (!r.logPath) continue;
    actions.push(
      `<button class="btn" data-action="log" data-path="${escapeHtml(
        r.logPath
      )}">${icon(fileTextSvg)}<span>${escapeHtml(r.format.toUpperCase())} 日志</span></button>`
    );
  }

  const errors = (task.subTasks || [])
    .filter((s) => s.error)
    .map(
      (s) =>
        `<div class="error-line">${escapeHtml(
          s.format.toUpperCase()
        )}: ${escapeHtml(s.error)}</div>`
    )
    .join("");

  return `<tr>
    <td title="${escapeHtml(task.folderName)}">${escapeHtml(task.folderName)}</td>
    <td><span class="status-tag ${info.cls}">${escapeHtml(info.text)}</span></td>
    <td>
      <div class="progress-line">
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
        <span class="progress-num">${pct}%</span>
      </div>
    </td>
    <td>${subTags}${errors}</td>
    <td><div class="task-actions">${actions.join("")}</div></td>
  </tr>`;
}

function updateStart() {
  els.startBtn.disabled =
    state.busy || state.folders.length === 0 || state.formats.length === 0;
}

async function detectCalibre() {
  els.calibreStatus.textContent = "检测中…";
  try {
    const result = await invoke("check_calibre", {
      settingsPath: state.settings.calibrePath || "",
    });
    if (result.found) {
      state.calibrePath = result.path;
      els.calibreStatus.textContent = `已就绪：${result.path}`;
    } else {
      state.calibrePath = state.settings.calibrePath || null;
      els.calibreStatus.textContent = "未检测到 Calibre（仅 CBZ 可用）";
    }
  } catch {
    els.calibreStatus.textContent = "Calibre 检测失败";
  }
}

async function startConversion() {
  if (state.busy || state.folders.length === 0 || state.formats.length === 0) {
    return;
  }
  state.busy = true;
  updateStart();
  const jobs = state.folders.map((f) => ({
    comicId: f.path,
    comicName: f.name,
    folderPath: f.path,
    outputDir: state.outputDir || f.path,
    formats: [...state.formats],
  }));
  try {
    const jobIds = await invoke("enqueue_jobs", { jobs });
    state.tasks = jobIds.map((jobId, i) => ({
      jobId,
      folderName: state.folders[i].name,
      status: "queued",
      subTasks: state.formats.map((f) => ({
        format: f,
        status: "pending",
        progress: 0,
      })),
      results: [],
      error: null,
    }));
    renderTasks();
  } catch (err) {
    state.busy = false;
    toast(`入队失败：${err.message || err}`);
    updateStart();
  }
}

function populateSettings() {
  els.calibrePath.value = state.settings.calibrePath || "";
  setSegmented(els.profileSeg, state.settings.profile || "recommended");
  setSegmented(
    els.overwriteSeg,
    state.settings.overwritePolicy || "rename"
  );
  setSegmented(els.themeSeg, state.settings.themeMode || "system");
  els.packConc.value = String(state.settings.packingConcurrency || 2);
  els.convertConc.value = String(state.settings.convertConcurrency || 1);
  els.keepLogs.checked = state.settings.keepLogs !== false;
  applyTheme();
}

function setSegmented(container, value) {
  container.dataset.value = value;
  for (const btn of container.querySelectorAll(".seg-btn")) {
    btn.classList.toggle("active", btn.dataset.value === value);
  }
}

function currentSegmented(container) {
  return container.dataset.value;
}

async function saveSettingsFromForm() {
  const settings = {
    schemaVersion: 1,
    calibrePath: els.calibrePath.value.trim(),
    outputMode: state.outputDir ? "fixedDir" : "sameAsSource",
    fixedOutputDir: state.outputDir || "",
    overwritePolicy: currentSegmented(els.overwriteSeg),
    profile: currentSegmented(els.profileSeg),
    packingConcurrency: Number(els.packConc.value),
    convertConcurrency: Number(els.convertConc.value),
    themeMode: currentSegmented(els.themeSeg),
    keepLogs: els.keepLogs.checked,
  };
  try {
    const saved = await invoke("save_settings", { settings });
    state.settings = saved;
    state.outputDir =
      saved.outputMode === "fixedDir" && saved.fixedOutputDir
        ? saved.fixedOutputDir
        : null;
    els.outputDir.value = state.outputDir || "";
    populateSettings();
    detectCalibre();
    toast("设置已保存");
  } catch (err) {
    toast(`保存设置失败：${err.message || err}`);
  }
}

async function applyTableUiState() {
  const ui = await loadUiState();
  const headerRow = els.taskTable.tHead.rows[0];
  const byCol = new Map(
    Array.from(headerRow.children).map((th) => [th.dataset.col, th])
  );
  for (const col of ui.order) {
    const th = byCol.get(col);
    if (th) headerRow.appendChild(th);
  }
  for (const th of headerRow.children) {
    if (ui.widths[th.dataset.col]) {
      th.style.width = `${ui.widths[th.dataset.col]}px`;
    }
  }
}

function clearFinishedTasks() {
  const terminal = ["done", "failed", "cancelled"];
  state.tasks = state.tasks.filter((t) => !terminal.includes(t.status));
  if (state.tasks.length === 0) state.busy = false;
  renderTasks();
  updateStart();
}

async function clearAllTasks() {
  try {
    await invoke("clear_jobs");
  } catch (err) {
    toast(`清空失败：${err.message || err}`);
  }
  state.tasks = [];
  state.busy = false;
  renderTasks();
  updateStart();
}

function setupEventListeners() {
  const appWindow = getCurrentWindow();
  document.querySelector(".titlebar").addEventListener("mousedown", (e) => {
    if (e.button === 0 && !e.target.closest("button")) {
      e.preventDefault();
      appWindow.startDragging();
    }
  });
  els.clearFinishedBtn.addEventListener("click", clearFinishedTasks);
  els.clearAllBtn.addEventListener("click", clearAllTasks);
  $("win-min").addEventListener("click", () => appWindow.minimize());
  $("win-max").addEventListener("click", async () => {
    if (await appWindow.isMaximized()) {
      await appWindow.unmaximize();
    } else {
      await appWindow.maximize();
    }
  });
  $("win-close").addEventListener("click", () => appWindow.close());

  els.pickFolders.addEventListener("click", async () => {
    const dirs = await open({
      directory: true,
      multiple: true,
      title: "选择漫画文件夹",
    });
    if (!dirs) return;
    for (const dir of dirs) await addFolder(dir);
  });

  els.folderList.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove]");
    if (!btn) return;
    state.folders = state.folders.filter(
      (f) => f.path !== btn.dataset.remove
    );
    renderFolders();
  });

  els.browseOutput.addEventListener("click", async () => {
    const dir = await open({ directory: true, title: "选择输出目录" });
    if (!dir) return;
    state.outputDir = dir;
    els.outputDir.value = dir;
    state.settings.outputMode = "fixedDir";
    state.settings.fixedOutputDir = dir;
    await saveSettingsSilently();
  });

  els.formatChips.addEventListener("change", () => {
    state.formats = Array.from(
      els.formatChips.querySelectorAll("input:checked")
    ).map((input) => input.value);
    updateStart();
  });

  els.startBtn.addEventListener("click", startConversion);

  els.openOutput.addEventListener("click", async () => {
    if (!state.outputDir) {
      toast("请先选择输出目录");
      return;
    }
    await openPath(state.outputDir);
  });

  els.copyOutput.addEventListener("click", async () => {
    if (!state.outputDir) {
      toast("请先选择输出目录");
      return;
    }
    await navigator.clipboard.writeText(state.outputDir);
    els.copyOutput.textContent = "已复制";
    setTimeout(() => (els.copyOutput.textContent = "复制路径"), 1200);
  });

  els.taskBody.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const jobId = btn.dataset.jobid;
    try {
      if (action === "cancel") {
        await invoke("cancel_job", { jobId });
      } else if (action === "retry") {
        const task = state.tasks.find((t) => t.jobId === jobId);
        const newId = await invoke("retry_job", { jobId });
        state.tasks.push({
          jobId: newId,
          folderName: task?.folderName || "",
          status: "queued",
          subTasks: (task?.subTasks || []).map((s) => ({
            format: s.format,
            status: "pending",
            progress: 0,
          })),
          results: [],
          error: null,
        });
        renderTasks();
      } else if (action === "log") {
        const content = await invoke("export_log", {
          logPath: btn.dataset.path,
        });
        await openPath(content.path);
      }
    } catch (err) {
      toast(`操作失败：${err.message || err}`);
    }
  });

  for (const container of [els.profileSeg, els.overwriteSeg, els.themeSeg]) {
    container.addEventListener("click", (e) => {
      const btn = e.target.closest(".seg-btn");
      if (!btn) return;
      setSegmented(container, btn.dataset.value);
      if (container === els.themeSeg) {
        applyTheme(btn.dataset.value);
      }
    });
  }

  els.browseCalibre.addEventListener("click", async () => {
    const file = await open({
      multiple: false,
      title: "选择 ebook-convert.exe",
      filters: [{ name: "可执行文件", extensions: ["exe"] }],
    });
    if (file) els.calibrePath.value = file;
  });

  els.settingsSave.addEventListener("click", saveSettingsFromForm);

  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      if (state.settings.themeMode === "system") applyTheme("system");
    });
}

function hydrateButtons() {
  setBtnIcon("pick-folders", folderOpenSvg);
  setBtnIcon("browse-output", folderSvg);
  setBtnIcon("open-output", folderUpSvg);
  setBtnIcon("copy-output", copySvg);
  setBtnIcon("start-btn", playSvg);
  setBtnIcon("browse-calibre", folderSvg);
  setBtnIcon("settings-save", saveSvg);
}

async function init() {
  buildNav();
  hydrateButtons();
  setupTaskTable(els.taskTable, async (order, widths) => {
    const currentOrder = order
      ? order
      : Array.from(els.taskTable.tHead.rows[0].cells).map(
          (th) => th.dataset.col
        );
    const currentWidths = widths || collectWidths(els.taskTable);
    await saveUiState(currentOrder, currentWidths);
  });
  setupEventListeners();

  try {
    state.settings = await invoke("get_settings");
  } catch {
    state.settings = { ...DEFAULT_SETTINGS };
  }
  if (
    state.settings.outputMode === "fixedDir" &&
    state.settings.fixedOutputDir
  ) {
    state.outputDir = state.settings.fixedOutputDir;
    els.outputDir.value = state.outputDir;
  }
  populateSettings();
  await applyTableUiState();
  detectCalibre();
  renderFolders();
  renderTasks();
  switchPage("convert");
  updateStart();

  try {
    const info = await invoke("get_app_info");
    if (info && els.aboutVersion) {
      els.aboutVersion.textContent = `版本 ${info.version}（${info.runtime}）`;
    }
  } catch {
    // keep default about text
  }

  listen("job:update", (event) => {
    const task = state.tasks.find((t) => t.jobId === event.payload.jobId);
    if (!task) return;
    mergeTask(task, event.payload);
    renderTasks();
  });

  listen("job:result", (event) => {
    const task = state.tasks.find((t) => t.jobId === event.payload.jobId);
    if (!task) return;
    task.status = event.payload.status;
    task.results = event.payload.results || [];
    task.error = event.payload.error || null;
    if (allTerminal(state.tasks)) {
      state.busy = false;
      updateStart();
    }
    renderTasks();
  });

  listen("job:log", (event) => {
    if (event.payload.isError) {
      console.error("[Calibre]", event.payload.chunk);
    }
  });
}

init();
