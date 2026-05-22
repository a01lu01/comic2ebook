/**
 * FsService — File system operations
 */
const path = require('path');
const fs = require('fs');

// Natural sort: "1.jpg" < "2.jpg" < "10.jpg"
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

// Sanitize Windows filename
function sanitizeFilename(name) {
    return name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+$/, '');
}

// Resolve output path with rename-on-conflict
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

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];

// List images in a directory, natural-sorted
async function listImages(dirPath) {
    const files = await fs.promises.readdir(dirPath);
    return files
        .filter(f => IMAGE_EXTS.includes(path.extname(f).toLowerCase()))
        .sort(naturalSort);
}

// Read image as base64
async function readImageAsBase64(dirPath, fileName) {
    const filePath = path.join(dirPath, fileName);
    const buffer = await fs.promises.readFile(filePath);
    return buffer.toString('base64');
}

// Write buffer to file
async function writeBuffer(dirPath, fileName, arrayBuffer) {
    const filePath = path.join(dirPath, fileName);
    const buffer = Buffer.from(arrayBuffer.buffer || arrayBuffer);
    await fs.promises.writeFile(filePath, buffer);
    return filePath;
}

module.exports = {
    naturalSort,
    sanitizeFilename,
    resolveOutputPath,
    listImages,
    readImageAsBase64,
    writeBuffer,
    IMAGE_EXTS,
};
