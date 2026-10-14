const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
let count = 0;
for (const directory of ['src', 'scripts', 'tests']) {
    for (const filename of fs.readdirSync(path.join(root, directory), { recursive: true })) {
        if (!/\.(?:cjs|js)$/.test(filename)) continue;
        const fullPath = path.join(root, directory, filename);
        const result = spawnSync(process.execPath, ['--check', fullPath], { stdio: 'inherit' });
        if (result.status !== 0) process.exit(result.status || 1);
        count += 1;
    }
}
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
for (const filename of [manifest.main, 'src/preload.cjs', 'src/renderer/index.html', 'src/renderer/pet.html', 'src/renderer/toy.html', 'assets/icon.png', 'assets/trayTemplate.png']) {
    if (!fs.existsSync(path.join(root, filename))) throw new Error(`Missing app asset: ${filename}`);
}
console.log(`Syntax checked ${count} JavaScript files; application entry points and icons are present.`);
