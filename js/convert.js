/**
 * ConvertService — Calibre ebook-convert spawn wrapper
 */
const path = require('path');
const { spawn } = require('child_process');

const fsSvc = require('./fs');
const logSvc = require('./log');

// Calibre conversion profiles (mirrors main.js)
const CALIBRE_PROFILES = {
    recommended: {
        common: [
            '--no-process', '--dont-grayscale', '--dont-normalize', '--dont-sharpen',
            '--landscape',
        ],
        pdf: [
            '--paper-size=a4',
            '--pdf-page-margin-top=0', '--pdf-page-margin-bottom=0',
            '--pdf-page-margin-left=0', '--pdf-page-margin-right=0',
        ],
        epub: [
            '--no-chapters-in-toc', '--prefer-metadata-cover',
            '--preserve-cover-aspect-ratio', '--no-default-epub-cover',
        ],
        mobi: [
            '--no-chapters-in-toc', '--prefer-metadata-cover',
            '--mobi-keep-original-images', '--mobi-file-type=new',
        ],
        azw3: ['--no-chapters-in-toc', '--prefer-metadata-cover'],
    },
    compatible: {
        common: [],
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

/**
 * @returns {{ promise: Promise, proc: ChildProcess }}
 */
async function convert(job, format, calibrePath, cbzPath, onProgress) {
    const { comicName, outputDir, profile } = job;
    const safeName = fsSvc.sanitizeFilename(comicName);

    const dstBase = `${safeName}.${format}`;
    const { resolvedName, renamed } = await fsSvc.resolveOutputPath(outputDir, dstBase);
    const dstPath = path.join(outputDir, resolvedName);

    const params = buildCalibreArgs(format, profile);
    const cmd = [cbzPath, dstPath, ...params];

    const logPath = logSvc.createLog(safeName, format);

    let proc;

    const promise = new Promise((resolve, reject) => {
        proc = spawn(calibrePath, cmd, { windowsHide: true });
        let progress = 0;
        const progressRegex = /(\d+)%/;

        proc.stdout.on('data', (data) => {
            const text = data.toString();
            logSvc.appendLog(logPath, text);
            if (onProgress) onProgress({ chunk: text });
            const match = text.match(progressRegex);
            if (match) {
                progress = parseInt(match[1], 10);
                if (onProgress) onProgress({ percent: progress });
            }
        });

        proc.stderr.on('data', (data) => {
            const text = data.toString();
            logSvc.appendLog(logPath, text);
            if (onProgress) onProgress({ chunk: text, isError: true });
        });

        proc.on('close', (code) => {
            logSvc.appendLog(logPath, `\n# ExitCode: ${code}\n`);
            resolve({
                ok: code === 0,
                exitCode: code,
                progress: 100,
                path: dstPath,
                renamed: renamed ? resolvedName : null,
                logPath,
                format,
            });
        });

        proc.on('error', (err) => {
            logSvc.appendLog(logPath, `\n# Error: ${err.message}\n`);
            reject(err);
        });
    });

    return { promise, proc };
}

module.exports = { convert, buildCalibreArgs };
