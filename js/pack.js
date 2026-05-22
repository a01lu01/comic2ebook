/**
 * PackService — Main process streaming CBZ packer
 */
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const { PNG } = require('pngjs');

const fsSvc = require('./fs');

/**
 * Normalize PNG: strip alpha by compositing on white background.
 * Only processes PNGs with alpha channel (RGBA / Gray+Alpha).
 * Returns { buffer, size } with normalized data, or null if no change needed.
 */
function normalizePNG(filePath) {
    const raw = fs.readFileSync(filePath);
    // Quick check: skip if not PNG
    if (raw[0] !== 0x89 || raw[1] !== 0x50) return null;
    // Only normalize if alpha channel present (colorType 4 or 6)
    const colorType = raw[25];
    if (colorType !== 4 && colorType !== 6) return null;

    const png = PNG.sync.read(raw);
    const { width, height } = png;
    const hasAlpha = png.data.length === width * height * 4;

    if (hasAlpha) {
        // Composite onto white background
        for (let i = 0; i < png.data.length; i += 4) {
            const a = png.data[i + 3] / 255;
            png.data[i]     = Math.round(png.data[i]     * a + 255 * (1 - a));
            png.data[i + 1] = Math.round(png.data[i + 1] * a + 255 * (1 - a));
            png.data[i + 2] = Math.round(png.data[i + 2] * a + 255 * (1 - a));
            png.data[i + 3] = 255;
        }
    }

    // Always output RGB (strip alpha channel for MOBI compatibility)
    const rgb = Buffer.alloc(width * height * 3);
    for (let i = 0, j = 0; i < png.data.length; i += 4, j += 3) {
        rgb[j]     = png.data[i];
        rgb[j + 1] = png.data[i + 1];
        rgb[j + 2] = png.data[i + 2];
    }

    const out = new PNG({ width, height });
    out.data = Buffer.concat([rgb], rgb.length);
    return PNG.sync.write(out, { colorType: 2 }); // 2 = RGB
}

/**
 * Pack a comic folder into CBZ.
 * @param {Object} job - { jobId, folderPath, outputDir, comicName }
 * @param {Function} onProgress - (percent) => void
 * @returns {{ format: 'cbz', path: string }}
 */
async function packCBZ(job, onProgress) {
    const { folderPath, outputDir, comicName } = job;
    const images = await fsSvc.listImages(folderPath);

    if (images.length === 0) {
        throw new Error(`No images found in ${folderPath}`);
    }

    const { resolvedName, renamed } = await fsSvc.resolveOutputPath(outputDir, `${comicName}.cbz`);
    const outputPath = path.join(outputDir, resolvedName);
    const padLen = String(images.length).length;

    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(outputPath);
        const archive = new archiver.ZipArchive('zip', { store: true });

        output.on('close', () => {
            resolve({ format: 'cbz', path: outputPath, renamed: renamed ? resolvedName : null });
        });
        output.on('error', reject);
        archive.on('error', reject);
        archive.on('warning', (err) => {
            if (err.code !== 'ENOENT') reject(err);
        });
        archive.pipe(output);

        let processed = 0;
        const total = images.length;
        for (const imgName of images) {
            const ext = path.extname(imgName).toLowerCase();
            const zipName = String(processed + 1).padStart(padLen, '0') + ext;
            const srcPath = path.join(folderPath, imgName);

            if (ext === '.png') {
                // Normalize PNG: strip alpha for Calibre MOBI compatibility
                const normalized = normalizePNG(srcPath);
                if (normalized) {
                    archive.append(normalized, { name: zipName });
                } else {
                    archive.file(srcPath, { name: zipName });
                }
            } else {
                archive.file(srcPath, { name: zipName });
            }

            processed++;
            if (onProgress && (processed % 10 === 0 || processed === total)) {
                onProgress(Math.round((processed / total) * 100));
            }
        }

        archive.finalize();
    });
}

module.exports = { packCBZ };
