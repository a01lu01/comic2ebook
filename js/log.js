/**
 * LogService — Job log file management
 */
const path = require('path');
const fs = require('fs');

const LOGS_DIR = path.join(__dirname, '..', 'logs');
const MAX_LOG_FILES = 100;

function pruneLogs() {
    try {
        if (!fs.existsSync(LOGS_DIR)) return;
        const files = fs.readdirSync(LOGS_DIR)
            .filter(f => f.endsWith('.log'))
            .map(f => ({ name: f, mtime: fs.statSync(path.join(LOGS_DIR, f)).mtime }))
            .sort((a, b) => a.mtime - b.mtime);
        while (files.length > MAX_LOG_FILES) {
            fs.unlinkSync(path.join(LOGS_DIR, files.shift().name));
        }
    } catch (e) { /* ignore */ }
}

function createLog(comicName, format) {
    pruneLogs();
    const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
    if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
    const logPath = path.join(LOGS_DIR, `${comicName}_${format}_${ts}.log`);
    const now = new Date().toISOString();
    fs.writeFileSync(logPath, `# Comic2Ebook Calibre Log\n# Time: ${now}\n# Format: ${format}\n\n`);
    return logPath;
}

function appendLog(logPath, text) {
    try { fs.appendFileSync(logPath, text); } catch (e) { /* ignore */ }
}

function readLog(logPath) {
    if (fs.existsSync(logPath)) {
        return fs.readFileSync(logPath, 'utf-8');
    }
    return null;
}

function getLogsDir() {
    return LOGS_DIR;
}

module.exports = {
    createLog,
    appendLog,
    readLog,
    pruneLogs,
    getLogsDir,
};
