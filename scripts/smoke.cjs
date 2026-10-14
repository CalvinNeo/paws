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

async function openApplication(argumentsList = []) {
    const instance = await electron.launch({
        args: [root, ...argumentsList],
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
    const petPage = await getPetPage(instance);
    await petPage.waitForSelector('pet-avatar[coat]');
    const response = await petPage.evaluate(() => window.pawpal.window('home'));
    assert.equal(response.ok, true);
    for (const page of instance.windows()) {
        if (page.url().endsWith('/index.html')) return page;
    }
    return instance.waitForEvent('window', { predicate: (page) => page.url().endsWith('/index.html') });
}

async function getPetPage(instance) {
    return instance.windows().find((page) => page.url().endsWith('/pet.html'))
        || instance.waitForEvent('window', { predicate: (page) => page.url().endsWith('/pet.html') });
}

async function assertPetOnlyStartup(instance, expectedSize) {
    const petPage = await getPetPage(instance);
    await petPage.waitForSelector('pet-avatar[coat]');
    await petPage.waitForTimeout(200);
    const windows = await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((window) => ({
        url: window.webContents.getURL(), visible: window.isVisible(), focused: window.isFocused(), bounds: window.getBounds(),
    })));
    assert.equal(windows.length, 1);
    assert.ok(windows[0].url.endsWith('/pet.html'));
    assert.equal(windows[0].visible, true);
    assert.equal(windows[0].focused, false);
    assert.equal(windows[0].bounds.width, Math.round(300 * expectedSize / 100));
    assert.equal(windows[0].bounds.height, Math.round(266 * expectedSize / 100));
    const snapshot = (await petPage.evaluate(() => window.pawpal.getState())).data;
    assert.equal(snapshot.pet.settings.size, expectedSize);
    return petPage;
}

async function setSize(page, percentage) {
    await page.locator('#pet-size-range').fill(String(percentage));
    await page.waitForFunction((value) => document.getElementById('pet-size-value').textContent === `${value}%`, percentage);
    const bounds = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/pet.html')).getBounds());
    assert.equal(bounds.width, Math.round(300 * percentage / 100));
    assert.equal(bounds.height, Math.round(266 * percentage / 100));
    return bounds;
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
    const species = (await dashboard.evaluate(() => window.pawpal.getState())).data.pet.settings.species;
    await application.evaluate(({ BrowserWindow, screen }) => {
        globalThis.__smokeNativeCursor = screen.getCursorScreenPoint;
        globalThis.__smokeCursor = screen.getCursorScreenPoint();
        screen.getCursorScreenPoint = () => globalThis.__smokeCursor;
        const original = BrowserWindow.prototype.setIgnoreMouseEvents;
        globalThis.__smokeIgnoreMouseEvents = original;
        BrowserWindow.prototype.setIgnoreMouseEvents = function (ignore, options) {
            this.__smokeIgnoresMouse = ignore;
            return original.call(this, ignore, options);
        };
    });
    const startEnergy = Number(await dashboard.locator('#energy-value').textContent());
    for (const mode of ['fetch', 'ball', 'bubbles']) {
        await clickCare(dashboard, 'play');
        assert.equal(await dashboard.locator('#play-dialog').evaluate((dialog) => dialog.open), true);
        if (mode === 'fetch') await dashboard.screenshot({ path: path.join(artifacts, `${species}-games.png`) });
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
        assert.ok(Number.isInteger(baseline[mode]));

        await setCursor({ x: initial.bounds.x + 1, y: initial.bounds.y + 1 });
        await toyPage.mouse.move(1, 1);
        await toyPage.waitForTimeout(50);
        assert.equal((await nativeToyDetails()).ignoresMouse, true);
        const mask = await toyPage.evaluate(() => ({
            center: Boolean(document.elementFromPoint(48, 48)?.closest('[data-hit]')),
            blank: Boolean(document.elementFromPoint(1, 1)?.closest('[data-hit]')),
        }));
        assert.deepEqual(mask, { center: true, blank: false });
        await toyPage.screenshot({ path: path.join(artifacts, `${species}-toy-${mode}.png`), omitBackground: true });

        const origin = await throwDesktopToy(toyPage, mode);
        await toyPage.waitForTimeout(35);
        assert.equal((await nativeToyDetails()).ignoresMouse, true);
        if (mode === 'fetch') {
            await waitUntil(petPage, () => document.getElementById('desktop-puppy').getAttribute('carrying') === 'bone', `${species} visibly carries the bone home`);
            await petPage.screenshot({ path: path.join(artifacts, `${species}-fetch-carrying.png`), omitBackground: true });
        }
        await toyPage.waitForFunction(() => document.body.dataset.completed === '1' && document.body.dataset.phase === 'ready', undefined, { timeout: 15000 });
        const completedState = await dashboard.evaluate(async () => (await window.pawpal.getState()).data);
        assert.equal(completedState.pet.playStats[mode], baseline[mode] + 1);
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
        console.log(`✓ ${species} ${mode}: shape-only input, non-focusing 96px window, completed round, saved reward`);
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
    await application.evaluate(({ BrowserWindow, screen }) => {
        screen.getCursorScreenPoint = globalThis.__smokeNativeCursor;
        BrowserWindow.prototype.setIgnoreMouseEvents = globalThis.__smokeIgnoreMouseEvents;
    });
    console.log('✓ cancelling a game removes the toy without unearned rewards or overlay windows');
}

async function testCatCompanion(dashboard, petPage) {
    await application.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/index.html')).setSize(1120, 820);
    });
    await petPage.emulateMedia({ reducedMotion: 'no-preference' });
    await dashboard.locator('[data-view="preferences"]').click();
    await dashboard.locator('#setting-reducedMotion').uncheck();
    await dashboard.locator('[data-view="wardrobe"]').click();
    const beforeSwitch = (await petPage.evaluate(() => window.pawpal.getState())).data.pet;

    await application.evaluate(({ Menu }) => {
        globalThis.__smokeMenuPopup = Menu.prototype.popup;
        Menu.prototype.popup = function (options) {
            globalThis.__smokePetMenu = this;
            options.callback?.();
        };
    });
    try {
        await petPage.evaluate(() => window.pawpal.menu());
        await petPage.waitForTimeout(150);
        const menuItems = await application.evaluate(() => {
            const menu = globalThis.__smokePetMenu;
            const catItem = menu.getMenuItemById('pet-species-cat');
            const dogItem = menu.getMenuItemById('pet-species-dog');
            const result = { cat: catItem.label, checkedDog: dogItem.checked, checkedSize: menu.getMenuItemById('pet-size-43').checked };
            catItem.click();
            return result;
        });
        assert.deepEqual(menuItems, { cat: 'Silver tabby', checkedDog: true, checkedSize: true });
    } finally {
        await application.evaluate(({ Menu }) => { Menu.prototype.popup = globalThis.__smokeMenuPopup; });
    }
    await waitUntil(petPage, () => document.getElementById('desktop-puppy').getAttribute('species') === 'cat', 'native companion menu switches to the silver cat');
    await dashboard.waitForSelector('#wardrobe-puppy[species="cat"]');
    assert.equal(await dashboard.locator('pet-avatar[species="cat"]').count(), 2);
    assert.equal(await petPage.locator('silver-cat').count(), 1);
    assert.equal(await petPage.locator('puppy-dog').count(), 0);
    assert.equal(await petPage.locator('pet-avatar').getAttribute('accessory'), 'none');
    assert.equal(await petPage.locator('pet-avatar').getAttribute('coat'), 'silver-tabby');
    assert.equal(await dashboard.locator('#dog-coat-card').isVisible(), false);
    assert.equal(await dashboard.locator('#cat-coat-card').isVisible(), true);
    const afterSwitch = (await petPage.evaluate(() => window.pawpal.getState())).data.pet;
    for (const field of ['name', 'affection', 'interactions', 'playStats', 'position']) {
        assert.deepEqual(afterSwitch[field], beforeSwitch[field]);
    }
    await dashboard.locator('[data-setting="catAccessory"][data-value="bandana"]').click();
    await dashboard.locator('[data-setting="species"][data-value="dog"]').click();
    await petPage.waitForSelector('pet-avatar[species="dog"]');
    assert.equal(await petPage.locator('pet-avatar').getAttribute('coat'), 'cloud');
    assert.equal(await petPage.locator('pet-avatar').getAttribute('accessory'), 'collar');
    await dashboard.locator('[data-setting="species"][data-value="cat"]').click();
    await petPage.waitForSelector('pet-avatar[species="cat"][accessory="bandana"]');
    await dashboard.locator('[data-setting="catAccessory"][data-value="none"]').click();
    await petPage.waitForSelector('pet-avatar[accessory="none"]');
    await setSize(dashboard, 30);
    await petPage.screenshot({ path: path.join(artifacts, 'cat-default-30.png'), omitBackground: true });
    await setSize(dashboard, 100);
    await dashboard.screenshot({ path: path.join(artifacts, 'cat-wardrobe.png') });
    await assertLayout(dashboard);
    await petPage.screenshot({ path: path.join(artifacts, 'cat-awake.png'), omitBackground: true });

    const paintedMask = await petPage.evaluate(() => {
        const avatar = document.getElementById('desktop-puppy');
        const cat = avatar.shadowRoot.querySelector('silver-cat');
        const svg = cat.shadowRoot.querySelector('svg');
        const hit = (horizontal, vertical) => {
            const point = new DOMPoint(horizontal, vertical).matrixTransform(svg.getScreenCTM());
            return avatar.hitTest(point.x, point.y);
        };
        const face = new DOMPoint(160, 120).matrixTransform(svg.getScreenCTM());
        return { face: hit(160, 120), ear: hit(100, 66), tail: hit(270, 195), gap: hit(45, 80),
            shadow: hit(160, 260), corner: avatar.hitTest(1, 1),
            blink: getComputedStyle(cat.shadowRoot.querySelector('.awake-eyes')).animationName,
            point: { x: face.x, y: face.y } };
    });
    assert.deepEqual({ ...paintedMask, point: null }, { face: true, ear: true, tail: true, gap: false, shadow: false, corner: false, blink: 'slow-blink', point: null });
    await petPage.mouse.click(paintedMask.point.x, paintedMask.point.y);
    await waitUntil(petPage, () => document.getElementById('desktop-puppy').getAttribute('behavior') === 'petting', 'clicking the cat starts chin scratches and kneading');
    const kneading = await petPage.locator('silver-cat').evaluate((cat) => ['.front-left', '.front-right'].map((selector) => getComputedStyle(cat.shadowRoot.querySelector(selector)).animationName));
    assert.deepEqual(kneading, ['knead', 'knead']);
    await petPage.screenshot({ path: path.join(artifacts, 'cat-kneading.png'), omitBackground: true });

    await dashboard.locator('[data-view="home"]').click();
    await clickCare(dashboard, 'sleep');
    await petPage.waitForSelector('pet-avatar[behavior="sleeping"]');
    const sleeping = await petPage.locator('silver-cat').evaluate((cat) => {
        const root = cat.shadowRoot;
        const point = new DOMPoint(100, 66).matrixTransform(root.querySelector('svg').getScreenCTM());
        return { awake: getComputedStyle(root.querySelector('.awake-body')).display,
            curled: getComputedStyle(root.querySelector('.curled-body')).display,
            tail: getComputedStyle(root.querySelector('.wrapped-tail')).display,
            oldEar: cat.hitTest(point.x, point.y) };
    });
    assert.deepEqual(sleeping, { awake: 'none', curled: 'block', tail: 'block', oldEar: false });
    await petPage.screenshot({ path: path.join(artifacts, 'cat-sleeping.png'), omitBackground: true });
    await dashboard.locator('[data-view="wardrobe"]').click();
    await dashboard.locator('[data-setting="species"][data-value="dog"]').click();
    await petPage.waitForSelector('pet-avatar[species="dog"][behavior="sleeping"]');
    await dashboard.locator('[data-setting="species"][data-value="cat"]').click();
    await petPage.waitForSelector('pet-avatar[species="cat"][behavior="sleeping"]');
    await setSize(dashboard, 30);
    await dashboard.locator('[data-view="home"]').click();
    await clickCare(dashboard, 'wake');
    await testDesktopGames(dashboard, petPage);

    await clickCare(dashboard, 'play');
    await dashboard.locator('[data-play-mode="fetch"]').click();
    const toy = await gameWindow();
    await toy.waitForFunction(() => document.body.dataset.phase === 'ready');
    const beforeCancel = (await dashboard.evaluate(() => window.pawpal.getState())).data.pet.playStats;
    await dashboard.locator('[data-view="wardrobe"]').click();
    const closed = toy.waitForEvent('close');
    await dashboard.locator('[data-setting="species"][data-value="dog"]').click();
    await closed;
    const cancelled = (await petPage.evaluate(() => window.pawpal.getState())).data;
    assert.equal(cancelled.game, null);
    assert.equal(cancelled.runtime.carrying, null);
    assert.deepEqual(cancelled.pet.playStats, beforeCancel);
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 2);
    await dashboard.locator('[data-setting="species"][data-value="cat"]').click();
    await setSize(dashboard, 43);
    await dashboard.locator('[data-view="preferences"]').click();
    await dashboard.locator('#setting-reducedMotion').check();
    const animations = await petPage.locator('silver-cat').evaluate((cat) => Array.from(cat.shadowRoot.querySelectorAll('svg *')).some((element) => getComputedStyle(element).animationName !== 'none'));
    assert.equal(animations, false);
    await dashboard.locator('[data-view="wardrobe"]').click();
    await application.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/index.html')).setSize(780, 600);
    });
    await dashboard.waitForTimeout(150);
    await assertLayout(dashboard);
    await dashboard.screenshot({ path: path.join(artifacts, 'cat-compact.png') });
    console.log('✓ cat likeness, separate accessories, painted-only hits, kneading, curled sleep, quiet games, reduced motion, safe companion switching');
}

(async () => {
    try {
        application = await openApplication();
        const petPage = await assertPetOnlyStartup(application, 30);
        await petPage.screenshot({ path: path.join(artifacts, 'puppy-default-30.png'), omitBackground: true });
        await application.evaluate(({ app }) => {
            app.emit('activate', {}, false);
            app.emit('second-instance', {}, [app.getPath('exe'), app.getAppPath()], app.getAppPath());
        });
        await assertPetOnlyStartup(application, 30);
        console.log('✓ normal startup and app reactivation show only a 30-percent puppy');
        const dashboard = await getDashboard(application);
        await dashboard.waitForSelector('#happiness-meter[aria-valuenow]');
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
        await setSize(dashboard, 120);
        await waitUntil(petPage, () => document.getElementById('desktop-puppy').getAttribute('coat') === 'cloud', 'wardrobe updates the desktop puppy');
        assert.equal(await petPage.locator('pet-avatar').getAttribute('accessory'), 'collar');
        const petWidth = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/pet.html')).getBounds().width);
        assert.equal(petWidth, 360);
        await setSize(dashboard, 20);
        await assertLayout(petPage);
        await petPage.screenshot({ path: path.join(artifacts, 'puppy-20.png'), omitBackground: true });
        await setSize(dashboard, 150);
        const beforeResize = await setSize(dashboard, 75);
        const afterResize = await setSize(dashboard, 43);
        assert.equal(beforeResize.y + beforeResize.height, afterResize.y + afterResize.height);
        await dashboard.locator('[data-setting="size"][data-value="30"]').click();
        await waitUntil(dashboard, () => document.getElementById('pet-size-value').textContent === '30%', 'reset restores the 30-percent default');
        const tinyState = await petPage.evaluate(() => ({
            speech: getComputedStyle(document.getElementById('speech')).display,
            caption: getComputedStyle(document.querySelector('.pet-caption')).display,
        }));
        assert.deepEqual(tinyState, { speech: 'none', caption: 'none' });
        await setSize(dashboard, 43);
        console.log('✓ 20–150 percent size controls, custom percentages, anchored resizing, and uncluttered tiny puppy');
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

        await testCatCompanion(dashboard, petPage);

        await application.evaluate(({ app }) => { setTimeout(() => app.quit(), 50); });
        await application.close();
        application = null;
        const saved = JSON.parse(fs.readFileSync(path.join(userData, 'companion.json'), 'utf8'));
        assert.equal(saved.name, '豆豆');
        assert.equal(saved.settings.coat, 'cloud');
        assert.equal(saved.settings.roaming, false);
        assert.ok(saved.interactions >= 3);
        assert.deepEqual(saved.playStats, { fetch: 2, ball: 2, bubbles: 2 });
        assert.equal(saved.settings.size, 43);
        assert.equal(saved.settings.species, 'cat');
        assert.equal(saved.settings.catAccessory, 'none');
        assert.equal(saved.settings.accessory, 'collar');

        application = await openApplication();
        const restoredPet = await assertPetOnlyStartup(application, 43);
        assert.equal(await restoredPet.locator('pet-avatar').getAttribute('species'), 'cat');
        const restored = await getDashboard(application);
        await waitUntil(restored, () => document.getElementById('pet-name').textContent === '豆豆', 'save survives a complete application restart');
        assert.equal(await restored.locator('pet-avatar').first().getAttribute('coat'), 'silver-tabby');
        await restored.locator('[data-view="wardrobe"]').click();
        assert.equal(await restored.locator('#pet-size-range').inputValue(), '43');
        await restored.locator('[data-setting="species"][data-value="dog"]').click();
        await restoredPet.waitForSelector('pet-avatar[species="dog"][coat="cloud"][accessory="collar"]');
        await application.evaluate(({ app }) => { setTimeout(() => app.quit(), 50); });
        await application.close();
        application = null;

        const legacySave = JSON.parse(fs.readFileSync(path.join(userData, 'companion.json'), 'utf8'));
        legacySave.version = 1;
        legacySave.settings.size = 'medium';
        delete legacySave.settings.species;
        delete legacySave.settings.catAccessory;
        fs.writeFileSync(path.join(userData, 'companion.json'), JSON.stringify(legacySave));
        application = await openApplication(['--hidden', '--show-dashboard']);
        const migratedPet = await assertPetOnlyStartup(application, 30);
        const migrated = (await migratedPet.evaluate(() => window.pawpal.getState())).data.pet;
        assert.equal(migrated.name, '豆豆');
        assert.deepEqual(migrated.playStats, saved.playStats);
        assert.equal(migrated.version, 2);
        assert.equal(migrated.settings.species, 'dog');
        await application.evaluate(({ app }) => { setTimeout(() => app.quit(), 50); });
        await application.close();
        application = null;

        application = await openApplication(['--show-dashboard']);
        const explicitDashboard = await getDashboard(application);
        await explicitDashboard.waitForSelector('#happiness-meter[aria-valuenow]');
        await explicitDashboard.waitForTimeout(200);
        assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/index.html')).isVisible()), true);
        console.log('✓ saved custom size, legacy default migration, hidden login startup, and explicit dashboard flag');
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
