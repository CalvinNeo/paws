const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
    const assets = path.join(__dirname, '..', 'assets');
    for (const [source, destination, size] of [
        ['icon.svg', 'icon.png', 1024],
        ['tray.svg', 'trayTemplate.png', 36],
    ]) {
        const window = new BrowserWindow({
            width: size,
            height: size,
            show: false,
            frame: false,
            useContentSize: true,
            transparent: true,
            webPreferences: { offscreen: true, sandbox: true, contextIsolation: true },
        });
        const svg = fs.readFileSync(path.join(assets, source), 'utf8');
        const html = `<html><body style="margin:0;background:transparent">${svg}</body></html>`;
        await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
        const image = await window.webContents.capturePage();
        fs.writeFileSync(path.join(assets, destination), image.resize({ width: size, height: size }).toPNG());
        window.destroy();
        console.log(`Generated assets/${destination}`);
    }
    app.quit();
}).catch((error) => {
    console.error(error);
    app.exit(1);
});
