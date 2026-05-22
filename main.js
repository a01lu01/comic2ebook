const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Phase 3 Service modules
const fsSvc = require('./js/fs');
const logSvc = require('./js/log');
const { Orchestrator, createJob } = require('./js/orchestrator');

let mainWindow;
let orchestrator;
const jobMap = new Map(); // jobId → { proc, logPath }

// ═══════════════════════════════════════════
// Settings persistence
// ═══════════════════════════════════════════
function settingsPath() {
    return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
    try {
        const p = settingsPath();
        if (fs.existsSync(p)) {
            const raw = fs.readFileSync(p, 'utf-8');
            const parsed = JSON.parse(raw);
            if (!parsed.schemaVersion) parsed.schemaVersion = 1;
            return parsed;
        }
    } catch (e) { /* ignore corrupt file, return defaults */ }
    return { schemaVersion: 1 };
}

function saveSettings(settings) {
    const p = settingsPath();
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, JSON.stringify(settings, null, 2));
}

// ═══════════════════════════════════════════
// Calibre conversion profiles
// ═══════════════════════════════════════════
const CALIBRE_PROFILES = {
    recommended: {
        common: [
            '--no-process', '--dont-grayscale', '--dont-normalize', '--dont-sharpen',
            '--landscape', '--base-font-size', '0',
        ],
        pdf: [
            '--paper-size=a4',
            '--pdf-page-margin-top=0', '--pdf-page-margin-bottom=0',
            '--pdf-page-margin-left=0', '--pdf-page-margin-right=0',
            '--pdf-default-font-size=0',
        ],
        epub: [
            '--no-chapters-in-toc', '--prefer-metadata-cover',
            '--preserve-cover-aspect-ratio', '--no-default-epub-cover',
        ],
        mobi: [
            '--no-chapters-in-toc', '--prefer-metadata-cover',
            '--mobi-keep-original-images', '--mobi-file-type=both',
        ],
        azw3: ['--no-chapters-in-toc', '--prefer-metadata-cover'],
    },
    compatible: {
        common: ['--remove-first-image'],
        pdf: [],
        epub: ['--no-default-epub-cover'],
        mobi: ['--mobi-keep-original-images'],
        azw3: [],
    },
};

function buildCalibreArgs(format, profile = 'recommended') {
    const p = CALIBRE_PROFILES[profile] || CALIBRE_PROFILES.recommended;
    return [...p.common, ...(p[format] || [])];
}

// --- P1-06: IPC handler wrapper (structured {success, data/error}) ---
function ipcWrap(fn) {
    return async (...args) => {
        try {
            const data = await fn(...args);
            return { success: true, data };
        } catch (err) {
            return {
                success: false,
                error: {
                    code: err.code || 'E_UNKNOWN',
                    message: err.message || String(err),
                    detail: err.stack,
                },
            };
        }
    };
}

// ═══════════════════════════════════════════
// Window
// ═══════════════════════════════════════════
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        title: 'Comic2Ebook',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
        },
    });

    mainWindow.loadFile('app.html');

    // P3-07: Initialize Orchestrator
    const settings = loadSettings();
    orchestrator = new Orchestrator(mainWindow, settings);
}

// ═══════════════════════════════════════════
// IPC: Open comic folder picker
// ═══════════════════════════════════════════
ipcMain.handle('fs:open-comic-directories', ipcWrap(async () => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory', 'multiSelections'],
        title: '选择漫画文件夹',
    });
    if (result.canceled || result.filePaths.length === 0) return [];
    return result.filePaths.map(dirPath => ({
        path: dirPath,
        name: path.basename(dirPath),
    }));
}));

// ═══════════════════════════════════════════
// IPC: List images
// ═══════════════════════════════════════════
ipcMain.handle('fs:list-images', ipcWrap(async (event, dirPath) => {
    return fsSvc.listImages(dirPath);
}));

// ═══════════════════════════════════════════
// IPC: Read image as base64
// ═══════════════════════════════════════════
ipcMain.handle('fs:read-image', ipcWrap(async (event, { dirPath, fileName }) => {
    return fsSvc.readImageAsBase64(dirPath, fileName);
}));

// ═══════════════════════════════════════════
// IPC: Open directory picker
// ═══════════════════════════════════════════
ipcMain.handle('fs:open-directory', ipcWrap(async () => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: '选择输出目录',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const dirPath = result.filePaths[0];
    return { path: dirPath, name: path.basename(dirPath), fullPath: dirPath };
}));

// ═══════════════════════════════════════════
// IPC: Write file (P1-04: overwrite-safe)
// ═══════════════════════════════════════════
ipcMain.handle('fs:write-file', ipcWrap(async (event, { dirPath, fileName, arrayBuffer }) => {
    const { resolvedName, renamed } = await fsSvc.resolveOutputPath(dirPath, fileName);
    const filePath = path.join(dirPath, resolvedName);
    const buffer = Buffer.from(arrayBuffer.buffer || arrayBuffer);
    await fs.promises.writeFile(filePath, buffer);
    return { path: filePath, fileName: resolvedName, renamed };
}));

// ═══════════════════════════════════════════
// IPC: Open path in explorer
// ═══════════════════════════════════════════
ipcMain.handle('fs:open-path', ipcWrap(async (event, dirPath) => {
    await require('electron').shell.openPath(dirPath);
}));

// ═══════════════════════════════════════════
// IPC: Calibre detection
// ═══════════════════════════════════════════
ipcMain.handle('calibre:check', ipcWrap(async () => {
    const { execFile } = require('child_process');
    const possiblePaths = [
        'ebook-convert',
        path.join(process.env.APPDATA, 'Calibre2/ebook-convert.exe'),
        path.join(process.env.LOCALAPPDATA, 'Programs/Calibre/ebook-convert.exe'),
        path.join('C:\\Program Files\\Calibre2\\ebook-convert.exe'),
        path.join('C:\\Program Files (x86)\\Calibre2\\ebook-convert.exe'),
    ];

    function tryPath(idx) {
        return new Promise((resolve) => {
            if (idx >= possiblePaths.length) { resolve(null); return; }
            const exe = possiblePaths[idx];
            execFile(exe, ['--version'], { timeout: 5000 }, (err, stdout) => {
                if (!err && stdout && stdout.includes('calibre')) {
                    resolve(exe);
                } else {
                    resolve(tryPath(idx + 1));
                }
            });
        });
    }

    return await tryPath(0);
}));

// ═══════════════════════════════════════════
// IPC: Phase 3 — enqueue jobs via Orchestrator
// ═══════════════════════════════════════════
ipcMain.handle('enqueueJobs', ipcWrap(async (event, jobs) => {
    const settings = loadSettings();
    const calibrePath = settings.calibrePath || (await detectCalibreInternal());
    const jobDefs = jobs.map(j => createJob({
        comicId: j.comicId,
        comicName: j.comicName,
        folderPath: j.folderPath,
        outputDir: j.outputDir,
        formats: j.formats,
        profile: settings.profile || 'recommended',
        calibrePath,
    }));
    orchestrator.enqueue(jobDefs);
    return jobDefs.map(j => j.jobId);
}));

// P2-06/3-07: Cancel a running job
ipcMain.handle('cancelJob', ipcWrap(async (event, jobId) => {
    return { ok: orchestrator.cancel(jobId) };
}));

// P3-08: Retry a failed job
ipcMain.handle('retryJob', ipcWrap(async (event, jobId) => {
    const newJobId = orchestrator.retry(jobId);
    return newJobId ? { ok: true, jobId: newJobId } : { ok: false, reason: 'job not found' };
}));

// ── Settings / File / Log (unchanged) ──

ipcMain.handle('fs:load-settings', ipcWrap(async () => {
    return loadSettings();
}));

ipcMain.handle('fs:save-settings', ipcWrap(async (event, settings) => {
    saveSettings(settings);
    if (orchestrator) orchestrator.updateSettings(settings);
    return true;
}));

ipcMain.handle('fs:pick-file', ipcWrap(async (event, { title, filters }) => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        title: title || '选择文件',
        filters: filters || [{ name: 'All Files', extensions: ['*'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
}));

ipcMain.handle('exportLogs', ipcWrap(async (event, logPath) => {
    const content = logSvc.readLog(logPath);
    return content ? { path: logPath, content } : null;
}));

// Internal Calibre detection (extracted for enqueueJobs)
async function detectCalibreInternal() {
    const { execFile } = require('child_process');
    const possiblePaths = [
        'ebook-convert',
        path.join(process.env.APPDATA, 'Calibre2/ebook-convert.exe'),
        path.join(process.env.LOCALAPPDATA, 'Programs/Calibre/ebook-convert.exe'),
        path.join('C:\\Program Files\\Calibre2\\ebook-convert.exe'),
        path.join('C:\\Program Files (x86)\\Calibre2\\ebook-convert.exe'),
    ];
    function tryPath(idx) {
        return new Promise((resolve) => {
            if (idx >= possiblePaths.length) { resolve(null); return; }
            execFile(possiblePaths[idx], ['--version'], { timeout: 5000 }, (err, stdout) => {
                if (!err && stdout && stdout.includes('calibre')) resolve(possiblePaths[idx]);
                else resolve(tryPath(idx + 1));
            });
        });
    }
    return tryPath(0);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
