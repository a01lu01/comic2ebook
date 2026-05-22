/**
 * PackService — Main process streaming CBZ packer
 * Replaces renderer-process JSZip with archiver for zero-IPC streaming.
 */
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');

const fsSvc = require('./fs');

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
        const archive = archiver('zip', { store: true }); // store = no re-compress

        output.on('close', () => resolve({ format: 'cbz', path: outputPath, renamed: renamed ? resolvedName : null }));
        archive.on('error', reject);
        archive.pipe(output);

        let processed = 0;
        for (const imgName of images) {
            const ext = path.extname(imgName).toLowerCase();
            const zipName = String(processed + 1).padStart(padLen, '0') + ext;
            archive.file(path.join(folderPath, imgName), { name: zipName });
            processed++;
            if (onProgress) onProgress(Math.round((processed / images.length) * 100));
        }

        archive.finalize();
    });
}

module.exports = { packCBZ };
