const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

app.disableHardwareAcceleration();

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        title: 'Comic2Ebook',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webviewTag: true,
        },
    });

    mainWindow.loadFile('app.html');

    // Inject ipcRenderer for renderer process
    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.webContents.executeJavaScript(`
            window.ipcRenderer = require('electron').ipcRenderer;
            // Re-run detection now that ipcRenderer is available
            if (typeof detectCalibre === 'function') {
                detectCalibre().finally(() => updateStartBtn());
            }
        `);
    });
}

// ═══════════════════════════════════════════
// IPC: Open comic folder picker (multi-select, returns real path)
// ═══════════════════════════════════════════
ipcMain.handle('fs:open-comic-directories', async () => {
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
});

// ═══════════════════════════════════════════
// IPC: List images in a directory
// ═══════════════════════════════════════════
ipcMain.handle('fs:list-images', async (event, dirPath) => {
    const fs = require('fs').promises;
    const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];

    try {
        const files = await fs.readdir(dirPath);
        const images = files
            .filter(f => IMAGE_EXTS.includes(path.extname(f).toLowerCase()))
            .sort();
        return images;
    } catch (err) {
        return [];
    }
});

// ═══════════════════════════════════════════
// IPC: Read image file as base64 (for CBZ packing)
// ═══════════════════════════════════════════
ipcMain.handle('fs:read-image', async (event, { dirPath, fileName }) => {
    const fs = require('fs').promises;
    const filePath = path.join(dirPath, fileName);
    const buffer = await fs.readFile(filePath);
    // Return as base64 so it can be used in the renderer process
    return buffer.toString('base64');
});

// ═══════════════════════════════════════════
// IPC: Open directory picker (returns real path)
// ═══════════════════════════════════════════
ipcMain.handle('fs:open-directory', async () => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: '选择输出目录',
    });

    if (result.canceled || result.filePaths.length === 0) return null;

    const dirPath = result.filePaths[0];
    const dirName = path.basename(dirPath);
    return { path: dirPath, name: dirName, fullPath: dirPath };
});

// ═══════════════════════════════════════════
// IPC: Write file to output directory (for CBZ saving)
// ═══════════════════════════════════════════
ipcMain.handle('fs:write-file', async (event, { dirPath, fileName, arrayBuffer }) => {
    const fs = require('fs').promises;
    const filePath = path.join(dirPath, fileName);
    const buffer = Buffer.from(arrayBuffer.buffer || arrayBuffer);
    await fs.writeFile(filePath, buffer);
    return { success: true, path: filePath };
});

// ═══════════════════════════════════════════
// IPC: Open a specific path in system file explorer
// ═══════════════════════════════════════════
ipcMain.handle('fs:open-path', async (event, dirPath) => {
    require('electron').shell.openPath(dirPath);
});

// ═══════════════════════════════════════════
// IPC: Calibre Detection
// ═══════════════════════════════════════════
ipcMain.handle('calibre:check', async () => {
    return new Promise((resolve) => {
        const possiblePaths = [
            'ebook-convert',
            path.join(process.env.APPDATA, 'Calibre2/ebook-convert.exe'),
            path.join(process.env.LOCALAPPDATA, 'Programs/Calibre/ebook-convert.exe'),
            path.join('C:\\Program Files\\Calibre2\\ebook-convert.exe'),
            path.join('C:\\Program Files (x86)\\Calibre2\\ebook-convert.exe'),
        ];

        const { execFile } = require('child_process');

        function tryPath(idx) {
            if (idx >= possiblePaths.length) { resolve(null); return; }
            const exe = possiblePaths[idx];
            execFile(exe, ['--version'], { timeout: 5000 }, (err, stdout) => {
                if (!err && stdout && stdout.includes('calibre')) {
                    resolve(exe);
                } else {
                    tryPath(idx + 1);
                }
            });
        }

        tryPath(0);
    });
});

// ═══════════════════════════════════════════
// IPC: Calibre Conversion (with progress)
// ═══════════════════════════════════════════
ipcMain.handle('calibre:convert', async (event, { exe, outputDir, folderName, format }) => {
    return new Promise((resolve, reject) => {
        const srcPath = path.join(outputDir, `${folderName}.cbz`);
        const dstPath = path.join(outputDir, `${folderName}.${format}`);

        // 通用参数：对所有格式生效
        const params = [
            '--no-process', '--dont-grayscale', '--dont-normalize', '--dont-sharpen',
            '--landscape', '--base-font-size', '0',
            '--remove-first-image',  // 第一张图已作为封面，从正文中移除，避免重复
        ];

        // 格式专用参数
        if (format === 'epub') {
            params.push(
                '--no-chapters-in-toc',
                '--prefer-metadata-cover',
                '--preserve-cover-aspect-ratio',
                '--no-default-epub-cover',   // 禁止生成文字封面（书名页）
            );
        } else if (format === 'mobi') {
            params.push(
                '--no-chapters-in-toc',
                '--prefer-metadata-cover',
                '--mobi-keep-original-images',  // 保留原始图片格式，不转 JPEG
                '--mobi-file-type=both',         // KF8+MOBI6 混合，更好的图片支持
            );
        } else if (format === 'azw3') {
            params.push(
                '--no-chapters-in-toc',
                '--prefer-metadata-cover',
            );
        } else {
            params.push('--no-chapters-in-toc');
        }

        const cmd = [srcPath, dstPath, ...params];
        const proc = spawn(exe, cmd);

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
            resolve({ success: code === 0, exitCode: code, progress: 100, logLines: logLines.join('\n') });
        });

        proc.on('error', (err) => reject(err));
    });
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
