const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const root = path.join(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pawpal-smoke-'));
const artifacts = path.join(root, '.test-artifacts');
const environment = { ...process.env, PAWPAL_USER_DATA: userData };
delete environment.ELECTRON_RUN_AS_NODE;
fs.mkdirSync(artifacts, { recursive: true });
let application;
const pageErrors = [];

async function waitUntil(page, predicate, message) {
    await page.waitForFunction(predicate, undefined, { timeout: 10000 });
    console.log(`✓ ${message}`);
}

async function openApplication() {
    const instance = await electron.launch({
        args: [root],
        env: environment,
        timeout: 60000,
    });
    instance.context().setDefaultTimeout(10000);
    instance.on('window', (page) => page.on('pageerror', (error) => pageErrors.push(error.message)));
    return instance;
}

async function getDashboard(instance) {
    for (const page of instance.windows()) {
        if (page.url().endsWith('/index.html')) return page;
    }
    return instance.waitForEvent('window', { predicate: (page) => page.url().endsWith('/index.html') });
}

async function clickCare(page, action) {
    await page.waitForTimeout(500);
    await page.locator(`.care-button[data-action="${action}"]`).click();
}

async function assertLayout(page) {
    const problems = await page.evaluate(() => {
        const results = [];
        if (document.documentElement.scrollWidth > innerWidth + 1) results.push('Page overflows horizontally');
        for (const selector of ['#main-content', '.sidebar', '.companion-card', '.wellbeing-card', '.wardrobe-preview', '.preferences-card', '.care-button']) {
            for (const element of document.querySelectorAll(selector)) {
                if (!element.getBoundingClientRect().width) continue;
                if (element.scrollWidth > element.clientWidth + 2) results.push(`${selector} overflows horizontally`);
            }
        }
        return results;
    });
    assert.deepEqual(problems, []);
}

async function gameWindow() {
    return application.windows().find((page) => page.url().endsWith('/toy.html'))
        || application.waitForEvent('window', { predicate: (page) => page.url().endsWith('/toy.html') });
}

async function nativeToyDetails() {
    return application.evaluate(({ BrowserWindow }) => {
        const toy = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/toy.html'));
        return {
            bounds: toy.getBounds(),
            focusable: toy.isFocusable(),
            focused: toy.isFocused(),
            ignoresMouse: toy.__smokeIgnoresMouse,
            fullscreen: toy.isFullScreen(),
            windows: BrowserWindow.getAllWindows().length,
        };
    });
}

async function setCursor(point) {
    await application.evaluate((_electron, cursor) => { globalThis.__smokeCursor = cursor; }, point);
}

async function throwDesktopToy(page, mode) {
    const details = await nativeToyDetails();
    const origin = { x: details.bounds.x + 48, y: details.bounds.y + 48 };
    await setCursor(origin);
    await page.mouse.move(48, 48);
    await page.mouse.down();
    await page.waitForFunction(() => document.body.dataset.phase === 'held');
    if (mode !== 'bubbles') {
        for (let step = 1; step <= 10; step += 1) {
            await setCursor({ x: origin.x - step * 29, y: origin.y - step * 13 });
            await page.waitForTimeout(20);
        }
    }
    await page.mouse.up();
    return origin;
}

async function testDesktopGames(dashboard, petPage) {
    await application.evaluate(({ BrowserWindow, screen }) => {
        globalThis.__smokeNativeCursor = screen.getCursorScreenPoint;
        globalThis.__smokeCursor = screen.getCursorScreenPoint();
        screen.getCursorScreenPoint = () => globalThis.__smokeCursor;
        const original = BrowserWindow.prototype.setIgnoreMouseEvents;
        BrowserWindow.prototype.setIgnoreMouseEvents = function (ignore, options) {
            this.__smokeIgnoresMouse = ignore;
            return original.call(this, ignore, options);
        };
    });
    const startEnergy = Number(await dashboard.locator('#energy-value').textContent());
    for (const mode of ['fetch', 'ball', 'bubbles']) {
        await clickCare(dashboard, 'play');
        assert.equal(await dashboard.locator('#play-dialog').evaluate((dialog) => dialog.open), true);
        if (mode === 'fetch') await dashboard.screenshot({ path: path.join(artifacts, 'games.png') });
        await dashboard.locator(`[data-play-mode="${mode}"]`).click();
        const toyPage = await gameWindow();
        await toyPage.waitForFunction((expected) => document.body.dataset.mode === expected, mode);
        const initial = await nativeToyDetails();
        assert.equal(initial.windows, 3);
        assert.equal(initial.focusable, false);
        assert.equal(initial.focused, false);
        assert.equal(initial.fullscreen, false);
        assert.equal(initial.bounds.width, 96);
        assert.equal(initial.bounds.height, 96);
        const baseline = await dashboard.evaluate(async () => (await window.pawpal.getState()).data.pet.playStats);
        assert.equal(baseline[mode], 0);

        await setCursor({ x: initial.bounds.x + 1, y: initial.bounds.y + 1 });
        await toyPage.mouse.move(1, 1);
        await toyPage.waitForTimeout(50);
        assert.equal((await nativeToyDetails()).ignoresMouse, true);
        const mask = await toyPage.evaluate(() => ({
            center: Boolean(document.elementFromPoint(48, 48)?.closest('[data-hit]')),
            blank: Boolean(document.elementFromPoint(1, 1)?.closest('[data-hit]')),
        }));
        assert.deepEqual(mask, { center: true, blank: false });
        await toyPage.screenshot({ path: path.join(artifacts, `toy-${mode}.png`), omitBackground: true });

        const origin = await throwDesktopToy(toyPage, mode);
        await toyPage.waitForTimeout(35);
        assert.equal((await nativeToyDetails()).ignoresMouse, true);
        if (mode === 'fetch') {
            await waitUntil(petPage, () => document.getElementById('desktop-puppy').getAttribute('carrying') === 'bone', 'puppy visibly carries the bone home');
            await petPage.screenshot({ path: path.join(artifacts, 'fetch-carrying.png'), omitBackground: true });
        }
        await toyPage.waitForFunction(() => document.body.dataset.completed === '1' && document.body.dataset.phase === 'ready', undefined, { timeout: 15000 });
        const completedState = await dashboard.evaluate(async () => (await window.pawpal.getState()).data);
        assert.equal(completedState.pet.playStats[mode], 1);
        assert.equal(completedState.game.phase, 'ready');
        const returned = await nativeToyDetails();
        if (mode !== 'bubbles') {
            assert.ok(Math.abs(returned.bounds.x + 48 - origin.x) <= 1, `${mode} return x: ${JSON.stringify({ returned: returned.bounds, origin })}`);
            assert.ok(Math.abs(returned.bounds.y + 48 - origin.y) <= 1, `${mode} return y: ${JSON.stringify({ returned: returned.bounds, origin })}`);
        }
        assert.equal(returned.focused, false);
        const closed = toyPage.waitForEvent('close');
        await dashboard.locator('#play-status [data-stop-play]').click();
        await closed;
        console.log(`✓ ${mode}: shape-only input, non-focusing 96px window, completed round, saved reward`);
    }
    const endEnergy = Number(await dashboard.locator('#energy-value').textContent());
    assert.equal(startEnergy - endEnergy, 11);

    await clickCare(dashboard, 'play');
    await dashboard.locator('[data-play-mode="fetch"]').click();
    const cancelledToy = await gameWindow();
    await cancelledToy.waitForFunction(() => document.body.dataset.phase === 'ready');
    const beforeCancel = await dashboard.evaluate(async () => (await window.pawpal.getState()).data.pet.playStats.fetch);
    await throwDesktopToy(cancelledToy, 'fetch');
    await dashboard.locator('#play-status [data-stop-play]').click();
    const afterCancel = await dashboard.evaluate(async () => (await window.pawpal.getState()).data);
    assert.equal(afterCancel.game, null);
    assert.equal(afterCancel.pet.playStats.fetch, beforeCancel);
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 2);
    await application.evaluate(({ screen }) => { screen.getCursorScreenPoint = globalThis.__smokeNativeCursor; });
    console.log('✓ cancelling a game removes the toy without unearned rewards or overlay windows');
}

(async () => {
    try {
        application = await openApplication();
        const dashboard = await getDashboard(application);
        await dashboard.waitForSelector('#happiness-meter[aria-valuenow]');
        const petPage = application.windows().find((page) => page.url().endsWith('/pet.html'))
            || await application.waitForEvent('window', { predicate: (page) => page.url().endsWith('/pet.html') });
        await petPage.waitForSelector('puppy-dog[coat]');
        await dashboard.screenshot({ path: path.join(artifacts, 'home.png') });
        await assertLayout(dashboard);

        const configuration = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((window) => ({
            pet: window.webContents.getURL().endsWith('/pet.html'),
            alwaysOnTop: window.isAlwaysOnTop(),
            focusable: window.isFocusable(),
            preferences: window.webContents.getLastWebPreferences(),
        })));
        assert.equal(configuration.length, 2);
        assert.ok(configuration.find((window) => window.pet).alwaysOnTop);
        assert.equal(configuration.find((window) => window.pet).focusable, false);
        for (const window of configuration) {
            assert.equal(window.preferences.contextIsolation, true);
            assert.equal(window.preferences.nodeIntegration, false);
            assert.equal(window.preferences.sandbox, true);
        }
        assert.equal(await dashboard.evaluate(() => typeof window.require), 'undefined');
        console.log('✓ isolated renderers, two native windows, always-on-top puppy');

        await clickCare(dashboard, 'pet');
        await waitUntil(dashboard, () => document.getElementById('happiness-value').textContent === '95', 'head scratches change happiness');
        await clickCare(dashboard, 'feed');
        await waitUntil(dashboard, () => document.getElementById('fullness-value').textContent === '100', 'feeding fills the tummy');
        assert.ok(await dashboard.locator('[data-action="feed"]').isDisabled());
        await dashboard.locator('#explain-button').click();
        await dashboard.locator('[data-action="feed"]').click({ force: true });
        await waitUntil(dashboard, () => document.getElementById('explanation-dialog').open, 'Explain works on disabled buttons');
        await dashboard.locator('#explanation-dialog .primary-button').click();
        assert.equal(await dashboard.locator('#explanation-dialog').evaluate((dialog) => dialog.open), false);

        await testDesktopGames(dashboard, petPage);
        await clickCare(dashboard, 'sleep');
        await waitUntil(dashboard, () => document.getElementById('sleep-label').textContent === 'Wake up', 'nap state updates controls');
        await waitUntil(petPage, () => document.getElementById('desktop-puppy').getAttribute('behavior') === 'sleeping', 'nap state reaches the desktop puppy');
        assert.ok(await dashboard.locator('[data-action="play"]').isDisabled());
        await clickCare(dashboard, 'wake');

        await dashboard.locator('#rename-button').click();
        await dashboard.locator('#name-input').fill('豆豆');
        await dashboard.locator('#rename-form button[type="submit"]').click();
        await waitUntil(dashboard, () => document.getElementById('pet-name').textContent === '豆豆', 'Unicode names are supported');
        await waitUntil(petPage, () => document.getElementById('desktop-name').textContent === '豆豆', 'the desktop name stays synchronized');

        await dashboard.locator('[data-view="wardrobe"]').click();
        await dashboard.locator('[data-setting="coat"][data-value="cloud"]').click();
        await dashboard.locator('[data-setting="accessory"][data-value="collar"]').click();
        await dashboard.locator('[data-setting="size"][data-value="large"]').click();
        await waitUntil(petPage, () => document.getElementById('desktop-puppy').getAttribute('coat') === 'cloud', 'wardrobe updates the desktop puppy');
        assert.equal(await petPage.locator('puppy-dog').getAttribute('accessory'), 'collar');
        const petWidth = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/pet.html')).getBounds().width);
        assert.equal(petWidth, 360);
        await dashboard.screenshot({ path: path.join(artifacts, 'wardrobe.png') });
        await assertLayout(dashboard);

        await dashboard.locator('[data-view="preferences"]').click();
        await dashboard.locator('#setting-roaming').uncheck();
        await dashboard.locator('#setting-reducedMotion').check();
        assert.ok(await dashboard.locator('#setting-launchOnLogin').isDisabled());
        await dashboard.locator('#visibility-button').click();
        let visible = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/pet.html')).isVisible());
        assert.equal(visible, false);
        await dashboard.locator('.desktop-preferences [data-window="locate"]').click();
        visible = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/pet.html')).isVisible());
        assert.equal(visible, true);
        console.log('✓ preferences, hiding, finding, and desktop size');
        await dashboard.screenshot({ path: path.join(artifacts, 'preferences.png') });
        await assertLayout(dashboard);

        await dashboard.locator('#help-button').click();
        await dashboard.keyboard.press('Escape');
        assert.equal(await dashboard.locator('#help-dialog').evaluate((dialog) => dialog.open), false);
        await dashboard.locator('[data-view="home"]').click();
        await application.evaluate(({ BrowserWindow }) => {
            const window = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith('/index.html'));
            window.setSize(780, 600);
        });
        await dashboard.waitForTimeout(150);
        await assertLayout(dashboard);
        await dashboard.screenshot({ path: path.join(artifacts, 'compact.png') });
        await petPage.screenshot({ path: path.join(artifacts, 'puppy.png'), omitBackground: true });
        console.log('✓ help, Escape, and compact layout');

        const hitTest = await petPage.evaluate(() => {
            const puppy = document.getElementById('desktop-puppy');
            const bounds = puppy.getBoundingClientRect();
            return {
                middle: puppy.hitTest(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.5),
                blank: puppy.hitTest(1, 1),
            };
        });
        assert.equal(hitTest.middle, true);
        assert.equal(hitTest.blank, false);
        console.log('✓ SVG-aware puppy hit testing and transparent corners');

        await application.evaluate(({ app }) => { setTimeout(() => app.quit(), 50); });
        await application.close();
        application = null;
        const saved = JSON.parse(fs.readFileSync(path.join(userData, 'companion.json'), 'utf8'));
        assert.equal(saved.name, '豆豆');
        assert.equal(saved.settings.coat, 'cloud');
        assert.equal(saved.settings.roaming, false);
        assert.ok(saved.interactions >= 3);
        assert.deepEqual(saved.playStats, { fetch: 1, ball: 1, bubbles: 1 });

        application = await openApplication();
        const restored = await getDashboard(application);
        await waitUntil(restored, () => document.getElementById('pet-name').textContent === '豆豆', 'save survives a complete application restart');
        assert.equal(await restored.locator('puppy-dog').first().getAttribute('coat'), 'cloud');
        assert.deepEqual(pageErrors, []);
        console.log(`\nAll Electron smoke checks passed. Screenshots: ${artifacts}`);
    } finally {
        if (application) {
            await application.evaluate(({ app }) => { setTimeout(() => app.quit(), 50); }).catch(() => {});
            await application.close().catch(() => {});
        }
        fs.rmSync(userData, { recursive: true, force: true });
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
