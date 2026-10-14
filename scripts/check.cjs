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
let privatePhotos = 0;
for (const pose of Object.values(catProfile.poses)) {
    const filename = path.join(root, 'assets', 'cat', pose.file);
    if (!fs.existsSync(filename)) continue;
    const header = fs.readFileSync(filename).subarray(0, 26);
    if (header.length < 26 || header.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
        || header.readUInt32BE(16) !== catProfile.width || header.readUInt32BE(20) !== catProfile.height
        || header[24] !== 8 || header[25] !== 6) {
        throw new Error(`Expected a ${catProfile.width} × ${catProfile.height} RGBA PNG: ${filename}`);
    }
    privatePhotos += 1;
}
console.log(privatePhotos === Object.keys(catProfile.poses).length
    ? `Checked ${privatePhotos} private photo-cat assets (not tracked by Git).`
    : 'Private cat photos are optional and incomplete; this checkout uses the puppy until photos are prepared.');
