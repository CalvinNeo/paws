const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
let count = 0;
for (const directory of ['src', 'scripts', 'tests', 'assets']) {
    for (const filename of fs.readdirSync(path.join(root, directory), { recursive: true })) {
        if (!/\.(?:cjs|mjs|js)$/.test(filename)) continue;
        const fullPath = path.join(root, directory, filename);
        const result = spawnSync(process.execPath, ['--check', fullPath], { stdio: 'inherit' });
        if (result.status !== 0) process.exit(result.status || 1);
        count += 1;
    }
}
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
for (const filename of [manifest.main, 'src/preload.cjs', 'src/renderer/index.html', 'src/renderer/pet.html', 'src/renderer/toy.html', 'src/renderer/pet-avatar.js', 'src/renderer/puppy.js', 'src/renderer/cat.js', 'src/renderer/photo-hit.mjs', 'assets/cat/poses.mjs', 'assets/icon.png', 'assets/trayTemplate.png']) {
    if (!fs.existsSync(path.join(root, filename))) throw new Error(`Missing app asset: ${filename}`);
}
console.log(`Syntax checked ${count} JavaScript files; application entry points and icons are present.`);
const catProfile = require('../assets/cat/poses.mjs').default;
let catPhotos = 0;
for (const pose of Object.values(catProfile.poses)) {
    const filename = path.join(root, 'assets', 'cat', pose.file);
    if (!fs.existsSync(filename)) throw new Error(`Missing bundled cat photo: ${filename}`);
    const header = fs.readFileSync(filename).subarray(0, 26);
    if (header.length < 26 || header.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
        || header.readUInt32BE(16) !== catProfile.width || header.readUInt32BE(20) !== catProfile.height
        || header[24] !== 8 || header[25] !== 6) {
        throw new Error(`Expected a ${catProfile.width} × ${catProfile.height} RGBA PNG: ${filename}`);
    }
    catPhotos += 1;
}
console.log(`Checked ${catPhotos} bundled cat photographs.`);
const { catAtlasFrame } = require('../src/renderer/cat-animation.mjs');
let catAtlases = 0;
for (const [name, clip] of Object.entries(catProfile.animations || {})) {
    if (!catAtlasFrame(clip, clip.frames - 1)) throw new Error(`Invalid cat animation: ${name}`);
    for (const file of clip.files) {
        const filename = path.join(root, 'assets', 'cat', file);
        if (!fs.existsSync(filename)) throw new Error(`Missing bundled cat animation atlas: ${filename}`);
        const buffer = fs.readFileSync(filename);
        if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') throw new Error(`Invalid WebP atlas: ${filename}`);
        let dimensions;
        for (let offset = 12; offset + 8 <= buffer.length;) {
            const kind = buffer.toString('ascii', offset, offset + 4);
            const length = buffer.readUInt32LE(offset + 4);
            if (offset + 8 + length > buffer.length) throw new Error(`Truncated WebP atlas: ${filename}`);
            if (kind === 'VP8L' && length >= 5 && buffer[offset + 8] === 0x2f) {
                const packed = buffer.readUInt32LE(offset + 9);
                dimensions = { width: (packed & 0x3fff) + 1, height: ((packed >>> 14) & 0x3fff) + 1, alpha: Boolean((packed >>> 28) & 1) };
                break;
            }
            if (kind === 'VP8X' && length >= 10) {
                dimensions = { width: buffer.readUIntLE(offset + 12, 3) + 1, height: buffer.readUIntLE(offset + 15, 3) + 1, alpha: Boolean(buffer[offset + 8] & 0x10) };
                break;
            }
            offset += 8 + length + (length % 2);
        }
        if (!dimensions?.alpha || dimensions.width !== clip.frameWidth * clip.columns || dimensions.height !== clip.frameHeight * clip.rows) {
            throw new Error(`Wrong dimensions or missing transparency in cat atlas: ${filename}`);
        }
        catAtlases += 1;
    }
}
console.log(`Checked ${catAtlases} bundled cat animation atlases.`);
