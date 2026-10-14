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
const catProfile = require('../assets/cat/poses.mjs').default;
const hasPrivateCatPhotos = Object.values(catProfile.poses).every((pose) => fs.existsSync(path.join(root, 'assets', 'cat', pose.file)));

async function waitUntil(page, predicate, message) {
    await page.waitForFunction(predicate, undefined, { timeout: 10000 });
    console.log(`✓ ${message}`);
}

async function openApplication(argumentsList = [], applicationRoot = root) {
    const instance = await electron.launch({
        args: [applicationRoot, ...argumentsList],
        env: environment,
        timeout: 60000,
    });
    instance.context().setDefaultTimeout(10000);
    instance.on('window', (page) => page.on('pageerror', (error) => pageErrors.push(error.message)));
    try {
        await instance.evaluate(({ BrowserWindow }) => {
            const destroy = BrowserWindow.prototype.destroy;
            globalThis.__smokeGameStops = [];
            BrowserWindow.prototype.destroy = function () {
                if (this.webContents.getURL().endsWith('/toy.html')) globalThis.__smokeGameStops.push(new Error('Toy window destroyed').stack);
                return destroy.call(this);
            };
        });
    } catch (error) {
        await instance.close().catch(() => {});
        throw error;
    }
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

async function assertPetClicksStayOnDesktop(instance, petPage) {
    const initialWindows = await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    await instance.evaluate(({ screen }) => {
        globalThis.__smokeClickCursor = screen.getCursorScreenPoint;
        const cursor = screen.getCursorScreenPoint();
        screen.getCursorScreenPoint = () => cursor;
    });
    try {
        for (const clickCount of [1, 2, 3]) {
            await petPage.waitForTimeout(500);
            if (await petPage.locator('silver-cat').count()) await petPage.locator('silver-cat[ready]').waitFor();
            const point = await petPage.evaluate(() => {
                const avatar = document.getElementById('desktop-puppy');
                const bounds = avatar.getBoundingClientRect();
                for (let vertical = .4; vertical < .9; vertical += .05) {
                    for (let horizontal = .3; horizontal < .8; horizontal += .05) {
                        const point = { x: bounds.left + bounds.width * horizontal, y: bounds.top + bounds.height * vertical };
                        if (avatar.hitTest(point.x, point.y)) return point;
                    }
                }
                return null;
            });
            assert.ok(point, 'the pet has visible pixels to click');
            const before = (await petPage.evaluate(() => window.pawpal.getState())).data.pet.interactions;
            await petPage.mouse.click(point.x, point.y, { clickCount, delay: 30 });
            await petPage.waitForTimeout(150);
            const snapshot = (await petPage.evaluate(() => window.pawpal.getState())).data;
            assert.ok(snapshot.pet.interactions > before, `${clickCount} clicks still pet the companion`);
            const windows = await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((window) => ({
                url: window.webContents.getURL(), visible: window.isVisible(), focused: window.isFocused(),
            })));
            assert.equal(windows.length, initialWindows, 'clicking the pet never creates a dashboard');
            assert.ok(windows.filter((window) => window.url.endsWith('/index.html')).every((window) => !window.visible && !window.focused), 'clicking the pet never reopens a hidden dashboard');
            assert.equal(windows.find((window) => window.url.endsWith('/pet.html')).focused, false);
        }
    } finally {
        await instance.evaluate(({ screen }) => { screen.getCursorScreenPoint = globalThis.__smokeClickCursor; });
    }
    console.log('✓ single, double and repeated pet clicks give affection without opening or focusing the dashboard');
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
        try {
            await toyPage.waitForFunction(() => document.body.dataset.completed === '1' && document.body.dataset.phase === 'ready', undefined, { timeout: 15000 });
        } catch (error) {
            console.error('Game interruption diagnostics:', await application.evaluate(() => globalThis.__smokeGameStops).catch(() => []));
            throw error;
        }
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
        assert.deepEqual(menuItems, { cat: 'Your cat · real photos', checkedDog: true, checkedSize: true });
    } finally {
        await application.evaluate(({ Menu }) => { Menu.prototype.popup = globalThis.__smokeMenuPopup; });
    }
    await waitUntil(petPage, () => document.getElementById('desktop-puppy').getAttribute('species') === 'cat', 'native companion menu switches to the real-photo cat');
    await petPage.locator('silver-cat[ready]').waitFor();
    await dashboard.waitForSelector('#wardrobe-puppy[species="cat"]');
    assert.equal(await dashboard.locator('pet-avatar[species="cat"]').count(), 2);
    assert.equal(await petPage.locator('silver-cat').count(), 1);
    assert.equal(await petPage.locator('puppy-dog').count(), 0);
    assert.equal(await petPage.locator('pet-avatar').getAttribute('accessory'), 'none');
    assert.equal(await petPage.locator('pet-avatar').getAttribute('coat'), 'silver-tabby');
    assert.equal(await dashboard.locator('#dog-coat-card').isVisible(), false);
    assert.equal(await dashboard.locator('#cat-coat-card').isVisible(), true);
    assert.equal(await dashboard.locator('#dog-accessory-card').isVisible(), false);
    assert.equal(await dashboard.locator('#cat-pose-card').isVisible(), true);
    const afterSwitch = (await petPage.evaluate(() => window.pawpal.getState())).data.pet;
    for (const field of ['name', 'affection', 'interactions', 'playStats', 'position']) {
        assert.deepEqual(afterSwitch[field], beforeSwitch[field]);
    }
    await dashboard.locator('[data-setting="catPose"][data-value="loaf"]').click();
    await petPage.locator('silver-cat[data-pose="loaf"][ready]').waitFor();
    await dashboard.locator('[data-setting="species"][data-value="dog"]').click();
    await petPage.waitForSelector('pet-avatar[species="dog"]');
    assert.equal(await petPage.locator('pet-avatar').getAttribute('coat'), 'cloud');
    assert.equal(await petPage.locator('pet-avatar').getAttribute('accessory'), 'collar');
    await dashboard.locator('[data-setting="species"][data-value="cat"]').click();
    await petPage.locator('silver-cat[data-pose="loaf"][ready]').waitFor();
    await dashboard.locator('[data-setting="catPose"][data-value="sitting"]').click();
    await petPage.locator('silver-cat[data-pose="sitting"][ready]').waitFor();
    await setSize(dashboard, 30);
    await petPage.screenshot({ path: path.join(artifacts, 'cat-default-30.png'), omitBackground: true });
    await setSize(dashboard, 100);
    await dashboard.screenshot({ path: path.join(artifacts, 'cat-wardrobe.png') });
    await assertLayout(dashboard);
    await petPage.screenshot({ path: path.join(artifacts, 'cat-awake.png'), omitBackground: true });

    const paintedMask = await petPage.evaluate(() => {
        const avatar = document.getElementById('desktop-puppy');
        const cat = avatar.shadowRoot.querySelector('silver-cat');
        const canvas = cat.shadowRoot.querySelector('canvas');
        const bounds = canvas.getBoundingClientRect();
        const scale = Math.min(bounds.width / canvas.width, bounds.height / canvas.height);
        const project = (horizontal, vertical) => ({
            x: bounds.left + (bounds.width - canvas.width * scale) / 2 + (horizontal + .5) * scale,
            y: bounds.top + (bounds.height - canvas.height * scale) / 2 + (vertical + .5) * scale,
        });
        const hit = (horizontal, vertical) => {
            const point = project(horizontal, vertical);
            return avatar.hitTest(point.x, point.y);
        };
        let disagreements = 0;
        let visiblePixels = 0;
        for (let vertical = 5; vertical < canvas.height; vertical += 10) {
            for (let horizontal = 5; horizontal < canvas.width; horizontal += 10) {
                const alpha = cat.mask[(vertical * canvas.width + horizontal) * 4 + 3];
                if (alpha >= 24) visiblePixels += 1;
                if (hit(horizontal, vertical) !== (alpha >= 24)) disagreements += 1;
            }
        }
        return { face: hit(278, 205), ear: hit(208, 81), tail: hit(342, 487), gap: hit(180, 400),
            shadow: hit(320, 526), corner: avatar.hitTest(1, 1),
            illustrations: cat.shadowRoot.querySelectorAll('svg').length,
            animations: cat.getAnimations({ subtree: true }).length,
            disagreements, visiblePixels, point: project(278, 205), blankPoint: project(180, 400) };
    });
    assert.ok(paintedMask.visiblePixels > 500);
    assert.deepEqual({ ...paintedMask, point: null, blankPoint: null, visiblePixels: null }, {
        face: true, ear: true, tail: true, gap: false, shadow: false, corner: false,
        illustrations: 0, animations: 0, disagreements: 0, visiblePixels: null, point: null, blankPoint: null,
    });
    await application.evaluate(({ BrowserWindow }) => {
        const pet = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/pet.html'));
        pet.__photoOriginalIgnore = pet.setIgnoreMouseEvents;
        pet.setIgnoreMouseEvents = function (ignore, options) {
            this.__photoIgnoresMouse = ignore;
            return this.__photoOriginalIgnore(ignore, options);
        };
    });
    const beforeBlankClick = (await petPage.evaluate(() => window.pawpal.getState())).data.pet.interactions;
    await petPage.mouse.move(paintedMask.point.x, paintedMask.point.y);
    await petPage.waitForTimeout(50);
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/pet.html')).__photoIgnoresMouse), false);
    await petPage.mouse.click(paintedMask.blankPoint.x, paintedMask.blankPoint.y);
    await petPage.waitForTimeout(50);
    assert.equal((await petPage.evaluate(() => window.pawpal.getState())).data.pet.interactions, beforeBlankClick);
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/pet.html')).__photoIgnoresMouse), true);
    await petPage.mouse.click(paintedMask.point.x, paintedMask.point.y);
    await waitUntil(petPage, () => document.getElementById('desktop-puppy').getAttribute('behavior') === 'petting', 'clicking opaque cat pixels starts belly rubs');
    await petPage.locator('silver-cat[data-pose="relaxed"][ready]').waitFor();
    await petPage.waitForTimeout(50);
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/pet.html')).__photoIgnoresMouse), true);
    await application.evaluate(({ BrowserWindow }) => {
        const pet = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/pet.html'));
        pet.setIgnoreMouseEvents = pet.__photoOriginalIgnore;
        delete pet.__photoOriginalIgnore;
    });
    await petPage.screenshot({ path: path.join(artifacts, 'cat-belly-rub.png'), omitBackground: true });

    await dashboard.locator('[data-view="home"]').click();
    await clickCare(dashboard, 'sleep');
    await petPage.locator('silver-cat[data-pose="sleeping"][ready]').waitFor();
    const sleeping = await petPage.locator('silver-cat').evaluate((cat) => {
        const canvas = cat.shadowRoot.querySelector('canvas');
        const bounds = canvas.getBoundingClientRect();
        const scale = Math.min(bounds.width / canvas.width, bounds.height / canvas.height);
        return { pose: cat.dataset.pose, oldEar: cat.hitTest(
            bounds.left + (bounds.width - canvas.width * scale) / 2 + 208.5 * scale,
            bounds.top + (bounds.height - canvas.height * scale) / 2 + 81.5 * scale,
        ) };
    });
    assert.deepEqual(sleeping, { pose: 'sleeping', oldEar: false });
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
    await dashboard.locator('[data-setting="catPose"][data-value="loaf"]').click();
    await setSize(dashboard, 43);
    await dashboard.locator('[data-view="preferences"]').click();
    await dashboard.locator('#setting-reducedMotion').check();
    await petPage.locator('silver-cat[data-pose="loaf"][ready]').waitFor();
    const animations = await petPage.locator('silver-cat').evaluate((cat) => cat.getAnimations({ subtree: true }).length);
    assert.equal(animations, 0);
    const stillFrame = await petPage.locator('silver-cat').evaluate((cat) => cat.canvas.toDataURL());
    await petPage.waitForTimeout(180);
    assert.equal(await petPage.locator('silver-cat').evaluate((cat) => cat.canvas.toDataURL()), stillFrame);
    await dashboard.locator('[data-view="wardrobe"]').click();
    await application.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/index.html')).setSize(780, 600);
    });
    await dashboard.waitForTimeout(150);
    await assertLayout(dashboard);
    await dashboard.screenshot({ path: path.join(artifacts, 'cat-compact.png') });
    console.log('✓ actual-photo rendering, remembered poses, alpha-only clicks, belly rubs, curled sleep, quiet games, still frames, safe companion switching');
}

async function testMissingCatPhotos() {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'pawpal-no-cat-photos-'));
    try {
        fs.cpSync(path.join(root, 'src'), path.join(fixture, 'src'), { recursive: true });
        for (const filename of ['package.json', 'assets/icon.png', 'assets/trayTemplate.png', 'assets/cat/poses.mjs']) {
            const destination = path.join(fixture, filename);
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            fs.copyFileSync(path.join(root, filename), destination);
        }
        const filename = path.join(userData, 'companion.json');
        const saved = JSON.parse(fs.readFileSync(filename, 'utf8'));
        saved.settings.species = 'cat';
        saved.settings.catPose = 'loaf';
        fs.writeFileSync(filename, JSON.stringify(saved));
        application = await openApplication([], fixture);
        const petPage = await assertPetOnlyStartup(application, saved.settings.size);
        const snapshot = (await petPage.evaluate(() => window.pawpal.getState())).data;
        assert.equal(snapshot.catAvailable, false);
        assert.equal(snapshot.pet.settings.species, 'dog');
        assert.equal(snapshot.pet.settings.catPose, 'loaf');
        assert.equal(snapshot.pet.name, saved.name);
        assert.equal(snapshot.pet.affection, saved.affection);
        assert.deepEqual(snapshot.pet.playStats, saved.playStats);
        assert.match(snapshot.runtime.warning, /private cat photos are missing/);
        const response = await petPage.evaluate(() => window.pawpal.preferences({ species: 'cat' }));
        assert.equal(response.ok, false);
        assert.match(response.error, /Cat photos are not installed/);
        const dashboard = await getDashboard(application);
        await dashboard.waitForSelector('#happiness-meter[aria-valuenow]');
        await dashboard.locator('[data-view="wardrobe"]').click();
        assert.equal(await dashboard.locator('[data-setting="species"][data-value="cat"]').isDisabled(), true);
        assert.equal(await dashboard.locator('#cat-assets-note').isVisible(), true);
        assert.equal(await petPage.locator('puppy-dog').count(), 1);
        console.log('✓ missing private photos fall back to Puppy without losing name, pose or progress');
    } finally {
        if (application) {
            await application.evaluate(({ app }) => { setTimeout(() => app.quit(), 50); }).catch(() => {});
            await application.close().catch(() => {});
            application = null;
        }
        fs.rmSync(fixture, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
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

        if (hasPrivateCatPhotos) await testCatCompanion(dashboard, petPage);
        else console.log('○ Private cat photos are absent; only the puppy and missing-asset fallback are tested.');

        await application.evaluate(({ app }) => { setTimeout(() => app.quit(), 50); });
        await application.close();
        application = null;
        const saved = JSON.parse(fs.readFileSync(path.join(userData, 'companion.json'), 'utf8'));
        assert.equal(saved.name, '豆豆');
        assert.equal(saved.settings.coat, 'cloud');
        assert.equal(saved.settings.roaming, false);
        assert.ok(saved.interactions >= 3);
        const expectedRounds = hasPrivateCatPhotos ? 2 : 1;
        assert.deepEqual(saved.playStats, { fetch: expectedRounds, ball: expectedRounds, bubbles: expectedRounds });
        assert.equal(saved.settings.size, 43);
        assert.equal(saved.settings.species, hasPrivateCatPhotos ? 'cat' : 'dog');
        assert.equal(saved.settings.catPose, hasPrivateCatPhotos ? 'loaf' : 'sitting');
        assert.equal(saved.settings.accessory, 'collar');

        application = await openApplication();
        const restoredPet = await assertPetOnlyStartup(application, 43);
        assert.equal(await restoredPet.locator('pet-avatar').getAttribute('species'), hasPrivateCatPhotos ? 'cat' : 'dog');
        if (hasPrivateCatPhotos) await restoredPet.locator('silver-cat[data-pose="loaf"][ready]').waitFor();
        await assertPetClicksStayOnDesktop(application, restoredPet);
        const restored = await getDashboard(application);
        await waitUntil(restored, () => document.getElementById('pet-name').textContent === '豆豆', 'save survives a complete application restart');
        assert.equal(await restored.locator('pet-avatar').first().getAttribute('coat'), hasPrivateCatPhotos ? 'silver-tabby' : 'cloud');
        await restored.locator('[data-view="wardrobe"]').click();
        assert.equal(await restored.locator('#pet-size-range').inputValue(), '43');
        await restored.locator('[data-setting="species"][data-value="dog"]').click();
        await restoredPet.waitForSelector('pet-avatar[species="dog"][coat="cloud"][accessory="collar"]');
        assert.equal((await restored.evaluate(() => window.pawpal.window('hide-home'))).ok, true);
        await assertPetClicksStayOnDesktop(application, restoredPet);
        await application.evaluate(({ app }) => { setTimeout(() => app.quit(), 50); });
        await application.close();
        application = null;

        const legacySave = JSON.parse(fs.readFileSync(path.join(userData, 'companion.json'), 'utf8'));
        legacySave.version = 1;
        legacySave.settings.size = 'medium';
        delete legacySave.settings.species;
        delete legacySave.settings.catPose;
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
        await application.evaluate(({ app }) => { setTimeout(() => app.quit(), 50); });
        await application.close();
        application = null;
        await testMissingCatPhotos();
        assert.deepEqual(pageErrors, []);
        console.log(`\nAll Electron smoke checks passed. Screenshots: ${artifacts}`);
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
