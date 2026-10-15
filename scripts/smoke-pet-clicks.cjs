const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const root = path.join(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pawpal-pet-clicks-'));
const environment = { ...process.env, PAWPAL_USER_DATA: userData };
delete environment.ELECTRON_RUN_AS_NODE;
let application;

async function windowState() {
    return application.evaluate(({ BrowserWindow }) => ({
        homeCalls: [...globalThis.__petClickHomeCalls],
        windows: BrowserWindow.getAllWindows().map((window) => ({
            url: window.webContents.getURL(),
            visible: window.isVisible(),
            focused: window.isFocused(),
            minimized: window.isMinimized(),
        })),
    }));
}

async function assertClicks(pet, state) {
    const baseline = await windowState();
    for (const clickCount of [1, 2, 3]) {
        await pet.waitForTimeout(500);
        const point = await pet.evaluate(() => {
            const avatar = document.getElementById('desktop-puppy');
            const bounds = avatar.getBoundingClientRect();
            for (let vertical = .3; vertical < .9; vertical += .05) {
                for (let horizontal = .25; horizontal < .85; horizontal += .05) {
                    const point = { x: bounds.left + bounds.width * horizontal, y: bounds.top + bounds.height * vertical };
                    if (avatar.hitTest(point.x, point.y)) return point;
                }
            }
            return null;
        });
        assert.ok(point, 'the pet must have painted pixels');
        const before = (await pet.evaluate(() => window.pawpal.getState())).data.pet.interactions;
        await application.evaluate(({ app }) => app.emit('activate', {}, false));
        await pet.mouse.click(point.x, point.y, { clickCount, delay: 30 });
        await application.evaluate(({ app }) => app.emit('activate', {}, false));
        await pet.waitForFunction((previous) => window.pawpal.getState().then((result) => result.data.pet.interactions > previous), before);
        const after = await windowState();
        assert.deepEqual(after.homeCalls, baseline.homeCalls, `${state}: pet clicks and app activation must not show, restore or focus settings`);
        assert.deepEqual(after.windows, baseline.windows, `${state}: pet clicks must preserve window visibility and focus`);
    }
}

async function openHomeFromMenu(pet) {
    await application.evaluate(({ Menu }) => {
        const popup = Menu.prototype.popup;
        Menu.prototype.popup = function (options) {
            Menu.prototype.popup = popup;
            const home = this.items.find((item) => /^Open .+'s home$/.test(item.label));
            if (!home) throw new Error('The pet menu must provide an explicit settings entry');
            home.click();
            options.callback?.();
        };
    });
    await pet.evaluate(() => window.pawpal.menu());
    await pet.waitForFunction(async () => (await window.pawpal.getState()).ok);
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
        const home = (await windowState()).windows.find((window) => window.url.endsWith('/index.html'));
        if (home?.visible) return;
        await pet.waitForTimeout(50);
    }
    throw new Error('The explicit home menu did not open settings');
}

(async () => {
    try {
        application = await electron.launch({ args: [root], env: environment, timeout: 60000 });
        application.context().setDefaultTimeout(10000);
        const pet = application.windows().find((page) => page.url().endsWith('/pet.html'))
            || await application.waitForEvent('window', { predicate: (page) => page.url().endsWith('/pet.html') });
        await pet.waitForSelector('pet-avatar[coat]');
        await application.evaluate(({ BrowserWindow, screen }) => {
            globalThis.__petClickHomeCalls = [];
            const cursor = screen.getCursorScreenPoint();
            screen.getCursorScreenPoint = () => cursor;
            for (const method of ['show', 'focus', 'restore']) {
                const original = BrowserWindow.prototype[method];
                BrowserWindow.prototype[method] = function (...argumentsList) {
                    if (this.webContents.getURL().endsWith('/index.html')) globalThis.__petClickHomeCalls.push(method);
                    return original.apply(this, argumentsList);
                };
            }
        });
        const snapshot = (await pet.evaluate(() => window.pawpal.getState())).data;
        for (const species of snapshot.catAvailable ? ['dog', 'cat'] : ['dog']) {
            const response = await pet.evaluate((selected) => window.pawpal.preferences({ species: selected, roaming: false, reducedMotion: true, size: 50 }), species);
            assert.equal(response.ok, true);
            await pet.waitForSelector(`pet-avatar[species="${species}"]`);
            if (species === 'cat') await pet.waitForSelector('silver-cat[ready]');
            await assertClicks(pet, `${species}, settings never created`);
            await openHomeFromMenu(pet);
            await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/index.html')).blur());
            await pet.waitForTimeout(200);
            await assertClicks(pet, `${species}, settings open in background`);
            await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/index.html')).minimize());
            await pet.waitForTimeout(500);
            await assertClicks(pet, `${species}, settings minimized`);
            await openHomeFromMenu(pet);
            assert.equal((await pet.evaluate(() => window.pawpal.window('hide-home'))).ok, true);
            await pet.waitForTimeout(200);
            await assertClicks(pet, `${species}, settings hidden`);
            await openHomeFromMenu(pet);
            await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/index.html')).destroy());
            await pet.waitForTimeout(200);
            console.log(`✓ ${species}: single, double and repeated clicks keep settings closed or in the background; the explicit menu still opens settings`);
        }
    } finally {
        if (application) {
            await application.evaluate(({ app }) => { setTimeout(() => app.quit(), 50); }).catch(() => {});
            await application.close().catch(() => {});
        }
        fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
