/**
 * Comic2Ebook — Preload Script
 * Bridges main process IPC to renderer via contextBridge.
 * All ipcWrap {success, data/error} responses are unwrapped here
 * so the renderer always receives clean data or throws.
 */
const { contextBridge, ipcRenderer } = require('electron');

// Unwrap ipcWrap response: throw on failure, return data on success
function unwrap(result) {
    if (!result || result.success === false) {
        const err = result?.error;
        const msg = err ? `[${err.code}] ${err.message}` : 'IPC call failed';
        throw new Error(msg);
    }
    return result.data;
}

// Generic invoke helper — invoke + unwrap in one call
async function invoke(channel, ...args) {
    return unwrap(await ipcRenderer.invoke(channel, ...args));
}

contextBridge.exposeInMainWorld('api', {

    // ── Calibre ──
    checkCalibre:       ()        => invoke('calibre:check'),
    convertCalibre:     (opts)    => invoke('calibre:convert', opts),

    onCalibrePercent(callback) {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('calibre:percent', handler);
        return () => ipcRenderer.removeListener('calibre:percent', handler);
    },

    onCalibreProgress(callback) {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('calibre:progress', handler);
        return () => ipcRenderer.removeListener('calibre:progress', handler);
    },

    // ── File System ──
    openDirs:           ()        => invoke('fs:open-comic-directories'),
    listImages:         (dirPath) => invoke('fs:list-images', dirPath),
    readImage:          (dirPath, fileName) => invoke('fs:read-image', { dirPath, fileName }),
    pickDir:            ()        => invoke('fs:open-directory'),
    writeFile:          (dirPath, fileName, arrayBuffer) => invoke('fs:write-file', { dirPath: dirPath, fileName: fileName, arrayBuffer: arrayBuffer }),
    openPath:           (dirPath) => invoke('fs:open-path', dirPath),

    // ── Settings ──
    loadSettings:       ()        => invoke('fs:load-settings'),
    saveSettings:       (settings) => invoke('fs:save-settings', settings),
    pickFile:           (title, filters) => invoke('fs:pick-file', { title, filters }),

    // ── Job control (Phase 3) ──
    enqueueJobs:        (jobs)    => invoke('enqueueJobs', jobs),
    cancelJob:          (jobId)   => invoke('cancelJob', jobId),
    retryJob:           (jobId)   => invoke('retryJob', jobId),
    exportLogs:         (logPath) => invoke('exportLogs', logPath),

    onJobUpdate(callback) {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('job:update', handler);
        return () => ipcRenderer.removeListener('job:update', handler);
    },

    onJobResult(callback) {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('job:result', handler);
        return () => ipcRenderer.removeListener('job:result', handler);
    },

    onJobLog(callback) {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('job:log', handler);
        return () => ipcRenderer.removeListener('job:log', handler);
    },

});
