const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

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

let mainWindow;

// ═══════════════════════════════════════════
// Phase 1 Utilities
// ═══════════════════════════════════════════

// --- P1-02: Natural sort ("1.jpg" < "2.jpg" < "10.jpg") ---
function naturalSort(a, b) {
    const re = /(\d+)|(\D+)/g;
    const aParts = String(a).match(re) || [String(a)];
    const bParts = String(b).match(re) || [String(b)];
    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
        if (i >= aParts.length) return -1;
        if (i >= bParts.length) return 1;
        const aNum = parseInt(aParts[i], 10);
        const bNum = parseInt(bParts[i], 10);
        if (!isNaN(aNum) && !isNaN(bNum)) {
            if (aNum !== bNum) return aNum - bNum;
        } else {
            const cmp = aParts[i].localeCompare(bParts[i]);
            if (cmp !== 0) return cmp;
        }
    }
    return 0;
}

// --- P1-03: Sanitize Windows filename ---
function sanitizeFilename(name) {
    return name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+$/, '');
}

// --- P1-05: Calibre conversion profiles ---
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

// --- P1-04: Resolve output path with rename-on-conflict ---
async function resolveOutputPath(dirPath, baseName) {
    const ext = path.extname(baseName);
    const stem = path.basename(baseName, ext);
    let candidate = baseName;
    let counter = 1;
    while (true) {
        const fullPath = path.join(dirPath, candidate);
        try {
            await fs.promises.access(fullPath);
            candidate = `${stem} (${counter})${ext}`;
            counter++;
        } catch {
            return { resolvedName: candidate, renamed: counter > 1 };
        }
    }
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
// IPC: List images (P1-02: natural sort)
// ═══════════════════════════════════════════
ipcMain.handle('fs:list-images', ipcWrap(async (event, dirPath) => {
    const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];
    const files = await fs.promises.readdir(dirPath);
    return files
        .filter(f => IMAGE_EXTS.includes(path.extname(f).toLowerCase()))
        .sort(naturalSort);
}));

// ═══════════════════════════════════════════
// IPC: Read image as base64
// ═══════════════════════════════════════════
ipcMain.handle('fs:read-image', ipcWrap(async (event, { dirPath, fileName }) => {
    const filePath = path.join(dirPath, fileName);
    const buffer = await fs.promises.readFile(filePath);
    return buffer.toString('base64');
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
    const { resolvedName, renamed } = await resolveOutputPath(dirPath, fileName);
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
// IPC: Calibre conversion (P1-03/04/05)
// ═══════════════════════════════════════════
ipcMain.handle('calibre:convert', ipcWrap(async (event, { exe, outputDir, folderName, format, profile = 'recommended' }) => {
    // P1-03: sanitize folder name
    const safeName = sanitizeFilename(folderName);
    const srcPath = path.join(outputDir, `${safeName}.cbz`);

    // P1-04: resolve output name (rename if conflict)
    const dstBase = `${safeName}.${format}`;
    const { resolvedName, renamed } = await resolveOutputPath(outputDir, dstBase);
    const dstPath = path.join(outputDir, resolvedName);

    // P1-05: build args from profile
    const params = buildCalibreArgs(format, profile);
    const cmd = [srcPath, dstPath, ...params];

    return new Promise((resolve, reject) => {
        const proc = spawn(exe, cmd, { windowsHide: true });

        let progress = 0;
        let logLines = [];
        const progressRegex = /(\d+)%/;

        proc.stdout.on('data', (data) => {
            const text = data.toString();
            logLines.push(text);
            event.sender.send('calibre:progress', { chunk: text });
            const match = text.match(progressRegex);
            if (match) {
                progress = parseInt(match[1], 10);
                event.sender.send('calibre:percent', { percent: progress });
            }
        });

        proc.stderr.on('data', (data) => {
            const text = data.toString();
            logLines.push(text);
            event.sender.send('calibre:progress', { chunk: text, isError: true });
        });

        proc.on('close', (code) => {
            resolve({
                ok: code === 0,
                exitCode: code,
                progress: 100,
                path: dstPath,
                renamed: renamed ? resolvedName : null,
                logLines: logLines.join('\n'),
            });
        });

        proc.on('error', (err) => reject(err));
    });
}));

// ═══════════════════════════════════════════
// IPC: Settings persistence
// ═══════════════════════════════════════════
ipcMain.handle('fs:load-settings', ipcWrap(async () => {
    return loadSettings();
}));

ipcMain.handle('fs:save-settings', ipcWrap(async (event, settings) => {
    saveSettings(settings);
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

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
