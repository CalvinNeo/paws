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
    await instance.context().addInitScript(() => {
        window.__smokeClicks = [];
        document.addEventListener('click', (event) => {
            const target = event.target.closest('button, a');
            window.__smokeClicks.push({
                at: Date.now(), target: target?.outerHTML.slice(0, 300), trusted: event.isTrusted,
                view: document.querySelector('[data-view][aria-current]')?.dataset.view,
            });
            window.__smokeClicks = window.__smokeClicks.slice(-20);
        }, true);
    });
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
    const center = { x: details.bounds.width / 2, y: details.bounds.height / 2 };
    const origin = { x: details.bounds.x + center.x, y: details.bounds.y + center.y };
    await setCursor(origin);
    await page.mouse.move(center.x, center.y);
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
    const initialState = (await dashboard.evaluate(() => window.pawpal.getState())).data;
    const species = initialState.pet.settings.species;
    const modes = species === 'cat' ? ['pounce', 'bubbles'] : ['fetch', 'ball', 'bubbles'];
    const availableModes = species === 'cat' ? [...modes, 'teaser'] : modes;
    assert.deepEqual(Object.keys(initialState.companion.games), availableModes);
    assert.deepEqual(await dashboard.locator('[data-play-mode]').evaluateAll((buttons) => buttons.map((button) => button.dataset.playMode)), availableModes);
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
    const startEnergy = initialState.pet.energy;
    for (const mode of modes) {
        await clickCare(dashboard, 'play');
        assert.equal(await dashboard.locator('#play-dialog').evaluate((dialog) => dialog.open), true);
        if (mode === modes[0]) await dashboard.screenshot({ path: path.join(artifacts, `${species}-games.png`) });
        await dashboard.locator(`[data-play-mode="${mode}"]`).click();
        const toyPage = await gameWindow();
        await toyPage.waitForFunction((expected) => document.body.dataset.mode === expected, mode);
        const initial = await nativeToyDetails();
        assert.equal(initial.windows, 3);
        assert.equal(initial.focusable, false);
        assert.equal(initial.focused, false);
        assert.equal(initial.fullscreen, false);
        const toySize = (await toyPage.evaluate(() => window.pawpal.toyState())).data.toySize;
        assert.equal(initial.bounds.width, toySize);
        assert.equal(initial.bounds.height, toySize);
        if (species === 'dog') assert.equal(toySize, 96);
        else assert.ok(toySize >= 24 && toySize <= 144);
        const baseline = await dashboard.evaluate(async () => (await window.pawpal.getState()).data.pet.playStats);
        assert.ok(Number.isInteger(baseline[mode]));
        if (species === 'cat') {
            for (const forbidden of ['fetch', 'ball']) {
                const rejected = await dashboard.evaluate((game) => window.pawpal.play(game), forbidden);
                assert.equal(rejected.ok, false);
                assert.match(rejected.error, /not available for your cat/);
            }
            const unchanged = (await dashboard.evaluate(() => window.pawpal.getState())).data;
            assert.equal(unchanged.game.mode, mode);
            assert.equal(unchanged.game.phase, 'ready');
            assert.deepEqual(unchanged.pet.playStats, baseline);
            assert.equal(toyPage.isClosed(), false);
            assert.equal(await toyPage.locator('[data-kind="bone"]').evaluate((shape) => getComputedStyle(shape).display), 'none');
        }

        await setCursor({ x: initial.bounds.x + 1, y: initial.bounds.y + 1 });
        await toyPage.mouse.move(1, 1);
        await toyPage.waitForTimeout(50);
        assert.equal((await nativeToyDetails()).ignoresMouse, true);
        const mask = await toyPage.evaluate(() => ({
            center: Boolean(document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest('[data-hit]')),
            blank: Boolean(document.elementFromPoint(1, 1)?.closest('[data-hit]')),
        }));
        assert.deepEqual(mask, { center: true, blank: false });
        await toyPage.screenshot({ path: path.join(artifacts, `${species}-toy-${mode}.png`), omitBackground: true });

        if (species === 'cat') {
            await petPage.evaluate(() => {
                const cat = document.querySelector('pet-avatar').shadowRoot.querySelector('silver-cat');
                window.__smokePawFrames = new Set();
                window.__smokePawPaint = () => {
                    if (cat.dataset.action === 'bat' && cat.dataset.animation === 'bat') window.__smokePawFrames.add(Number(cat.dataset.frame));
                };
                cat.addEventListener('pet-shape-changed', window.__smokePawPaint);
            });
        }
        const origin = await throwDesktopToy(toyPage, mode);
        await toyPage.waitForTimeout(35);
        assert.equal((await nativeToyDetails()).ignoresMouse, true);
        if (mode === 'fetch') {
            await waitUntil(petPage, () => document.getElementById('desktop-puppy').getAttribute('carrying') === 'bone', `${species} visibly carries the bone home`);
            await petPage.screenshot({ path: path.join(artifacts, `${species}-fetch-carrying.png`), omitBackground: true });
        }
        if (species === 'cat') {
            await petPage.waitForFunction(() => window.__smokePawFrames.size > 2, undefined, { timeout: 15000 });
            await petPage.screenshot({ path: path.join(artifacts, `cat-bat-${mode}.png`), omitBackground: true });
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
        if (species === 'dog' && mode !== 'bubbles') {
            assert.ok(Math.abs(returned.bounds.x + returned.bounds.width / 2 - origin.x) <= 1, `${mode} return x: ${JSON.stringify({ returned: returned.bounds, origin })}`);
            assert.ok(Math.abs(returned.bounds.y + returned.bounds.height / 2 - origin.y) <= 1, `${mode} return y: ${JSON.stringify({ returned: returned.bounds, origin })}`);
        }
        if (species === 'cat') {
            assert.equal(completedState.runtime.carrying, null);
            assert.equal(await petPage.locator('silver-cat').getAttribute('carrying'), '');
            if (mode === 'pounce') {
                assert.ok(Math.hypot(returned.bounds.x + returned.bounds.width / 2 - origin.x, returned.bounds.y + returned.bounds.height / 2 - origin.y) > 30, 'cat leaves the batted ball away from its launch point');
            }
            const frames = await petPage.evaluate(() => {
                const cat = document.querySelector('pet-avatar').shadowRoot.querySelector('silver-cat');
                cat.removeEventListener('pet-shape-changed', window.__smokePawPaint);
                return [...window.__smokePawFrames];
            });
            assert.ok(frames.length > 5, 'the real paw sequence advances through several frames at contact');
            assert.ok(Math.max(...frames) >= catProfile.animations.bat.frames - 2, 'the paw sequence reaches its final frames before settling');
        }
        assert.equal(returned.focused, false);
        const closed = toyPage.waitForEvent('close');
        await dashboard.locator('#play-status [data-stop-play]').click();
        await closed;
        console.log(`✓ ${species} ${mode}: shape-only input, non-focusing ${toySize}px window, completed round, saved reward`);
    }
    const endEnergy = (await dashboard.evaluate(() => window.pawpal.getState())).data.pet.energy;
    const expectedEnergy = species === 'cat' ? 5 : 11;
    assert.ok(startEnergy - endEnergy >= expectedEnergy && startEnergy - endEnergy < expectedEnergy + .5);

    await clickCare(dashboard, 'play');
    await dashboard.locator(`[data-play-mode="${modes[0]}"]`).click();
    const cancelledToy = await gameWindow();
    await cancelledToy.waitForFunction(() => document.body.dataset.phase === 'ready');
    const beforeCancel = (await dashboard.evaluate(() => window.pawpal.getState())).data.pet.playStats;
    await throwDesktopToy(cancelledToy, modes[0]);
    await dashboard.locator('#play-status [data-stop-play]').click();
    const afterCancel = await dashboard.evaluate(async () => (await window.pawpal.getState()).data);
    assert.equal(afterCancel.game, null);
    assert.deepEqual(afterCancel.pet.playStats, beforeCancel);
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 2);
    await application.evaluate(({ BrowserWindow, screen }) => {
        screen.getCursorScreenPoint = globalThis.__smokeNativeCursor;
        BrowserWindow.prototype.setIgnoreMouseEvents = globalThis.__smokeIgnoreMouseEvents;
    });
    console.log('✓ cancelling a game removes the toy without unearned rewards or overlay windows');
}

async function testCatToyScaling(petPage) {
    const original = (await petPage.evaluate(() => window.pawpal.getState())).data.pet;
    assert.equal(original.settings.species, 'cat');
    try {
        for (const [size, expected] of [[20, 24], [30, 29], [100, 96], [150, 144]]) {
            const resized = await petPage.evaluate((size) => window.pawpal.preferences({ size }), size);
            assert.equal(resized.ok, true);
            for (const mode of ['pounce', 'bubbles']) {
                const response = await petPage.evaluate((mode) => window.pawpal.play(mode), mode);
                assert.equal(response.ok, true);
                const toyPage = await gameWindow();
                await toyPage.waitForFunction((mode) => document.body.dataset.mode === mode, mode);
                const native = await nativeToyDetails();
                assert.equal(native.bounds.width, expected);
                assert.equal(native.bounds.height, expected);
                assert.equal(native.focusable, false);
                assert.equal(native.focused, false);
                assert.equal(native.fullscreen, false);
                assert.equal(native.windows, 3);
                const rendered = await toyPage.evaluate(async () => {
                    const state = (await window.pawpal.toyState()).data;
                    const circle = document.querySelector(`[data-kind="${state.toy}"] [data-hit]`);
                    const bounds = circle.getBoundingClientRect();
                    const center = { x: innerWidth / 2, y: innerHeight / 2 };
                    const radius = bounds.width / 2;
                    const hit = (horizontal, vertical) => Boolean(document.elementFromPoint(horizontal, vertical)?.closest('[data-hit]'));
                    return {
                        toySize: state.toySize, width: innerWidth, height: innerHeight, diameter: bounds.width,
                        center: hit(center.x, center.y), inside: hit(center.x + radius - 1, center.y),
                        outside: hit(center.x + radius + 1, center.y), corner: hit(1, 1),
                    };
                });
                assert.equal(rendered.toySize, expected);
                assert.equal(rendered.width, expected);
                assert.equal(rendered.height, expected);
                assert.ok(Math.abs(rendered.diameter - expected * (mode === 'bubbles' ? .64 : .56)) < .1);
                assert.deepEqual({ center: rendered.center, inside: rendered.inside, outside: rendered.outside, corner: rendered.corner }, {
                    center: true, inside: true, outside: false, corner: false,
                });
                const closed = toyPage.waitForEvent('close');
                assert.equal((await petPage.evaluate(() => window.pawpal.play('stop'))).ok, true);
                await closed;
            }
        }
        assert.deepEqual((await petPage.evaluate(() => window.pawpal.getState())).data.pet.playStats, original.playStats);
        console.log('✓ cat toys scale at 20–150% with matching native windows and painted hit areas, without focus or unearned rewards');
    } finally {
        await petPage.evaluate(() => window.pawpal.play('stop'));
        assert.equal((await petPage.evaluate((size) => window.pawpal.preferences({ size }), original.settings.size)).ok, true);
    }
}

async function setCatReducedMotion(petPage, enabled) {
    const response = await petPage.evaluate((reducedMotion) => window.pawpal.preferences({ reducedMotion }), enabled);
    assert.equal(response.ok, true);
    await petPage.waitForFunction((expected) => {
        const cat = document.getElementById('desktop-puppy').shadowRoot.querySelector('silver-cat');
        return cat?.hasAttribute('ready') && !cat.loading && cat.reducedMotion === expected
            && (!expected || cat.animationFrame === null);
    }, enabled);
}

async function sampleCatMask(petPage) {
    return petPage.locator('silver-cat[ready]').evaluate((cat) => {
        const bounds = cat.canvas.getBoundingClientRect();
        const width = cat.maskWidth;
        const height = cat.maskHeight;
        const scale = Math.min(bounds.width / width, bounds.height / height);
        const project = (horizontal, vertical) => ({
            x: bounds.left + (bounds.width - width * scale) / 2 + (horizontal + .5) * scale,
            y: bounds.top + (bounds.height - height * scale) / 2 + (vertical + .5) * scale,
        });
        const visibleCanvas = document.createElement('canvas');
        visibleCanvas.width = width;
        visibleCanvas.height = height;
        const context = visibleCanvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(cat.canvas, 0, 0, width, height);
        const visible = context.getImageData(0, 0, width, height).data;
        const alphaAt = (horizontal, vertical) => cat.mask[(vertical * width + horizontal) * 4 + 3];
        const interior = (horizontal, vertical, opaque) => {
            for (let offsetY = -5; offsetY <= 5; offsetY += 1) {
                for (let offsetX = -5; offsetX <= 5; offsetX += 1) {
                    const alpha = alphaAt(horizontal + offsetX, vertical + offsetY);
                    if (opaque ? alpha < 220 : alpha !== 0) return false;
                }
            }
            return true;
        };
        let disagreements = 0;
        let visiblePixels = 0;
        let transparentPixels = 0;
        let shadowPixels = 0;
        let shadowHits = 0;
        let point = null;
        let blankPoint = null;
        let opaqueDistance = Infinity;
        let transparentDistance = Infinity;
        for (let vertical = 6; vertical < height - 6; vertical += 4) {
            for (let horizontal = 6; horizontal < width - 6; horizontal += 4) {
                const alpha = alphaAt(horizontal, vertical);
                const projected = project(horizontal, vertical);
                const hit = cat.hitTest(projected.x, projected.y);
                if (alpha >= 24) visiblePixels += 1;
                else transparentPixels += 1;
                if (hit !== (alpha >= 24)) disagreements += 1;
                if (alpha === 0 && visible[(vertical * width + horizontal) * 4 + 3] > 0) {
                    shadowPixels += 1;
                    if (hit) shadowHits += 1;
                }
                const distance = Math.hypot(horizontal - width / 2, vertical - height / 2);
                if (alpha >= 220 && distance < opaqueDistance && interior(horizontal, vertical, true)) {
                    point = projected;
                    opaqueDistance = distance;
                }
                if (alpha === 0 && distance < transparentDistance && interior(horizontal, vertical, false)) {
                    blankPoint = projected;
                    transparentDistance = distance;
                }
            }
        }
        return {
            width, height, maskLength: cat.mask.length, canvasWidth: cat.canvas.width, canvasHeight: cat.canvas.height,
            disagreements, visiblePixels, transparentPixels, shadowPixels, shadowHits, point, blankPoint,
            illustrations: cat.shadowRoot.querySelectorAll('svg').length,
        };
    });
}

function assertCatMask(mask) {
    assert.equal(mask.width, Math.min(catProfile.width, 384));
    assert.equal(mask.height, Math.round(mask.width * catProfile.height / catProfile.width));
    assert.equal(mask.maskLength, mask.width * mask.height * 4);
    assert.equal(mask.canvasWidth, catProfile.width);
    assert.equal(mask.canvasHeight, catProfile.height);
    assert.equal(mask.disagreements, 0, 'all sampled alpha values agree with hitTest');
    assert.equal(mask.shadowHits, 0, 'pixels painted only by the shadow remain click-through');
    assert.equal(mask.illustrations, 0);
    assert.ok(mask.visiblePixels > 100, 'the photo contains an opaque silhouette');
    assert.ok(mask.transparentPixels > 100, 'transparent padding remains click-through');
    assert.ok(mask.point, 'the photo has an opaque interior safe for a native click');
    assert.ok(mask.blankPoint, 'the photo has a transparent interior safe for a native click');
}

async function testCatAnimation(petPage) {
    assert.ok(catProfile.animations?.idle?.frames > 1, 'private cat assets include a multi-frame idle atlas');
    const originalMotion = (await petPage.evaluate(() => window.pawpal.getState())).data.pet.settings.reducedMotion;
    await setCatReducedMotion(petPage, false);
    try {
        await petPage.waitForFunction(() => {
            const cat = document.getElementById('desktop-puppy').shadowRoot.querySelector('silver-cat');
            return cat?.dataset.animation === 'idle' && cat.hasAttribute('ready') && !cat.transition && cat.elapsedMs > 200;
        });
        await petPage.evaluate(() => {
            const cat = document.getElementById('desktop-puppy').shadowRoot.querySelector('silver-cat');
            window.__smokeCatAnimation = { frame: cat.dataset.frame, pixels: cat.canvas.toDataURL() };
        });
        await petPage.waitForFunction(() => {
            const cat = document.getElementById('desktop-puppy').shadowRoot.querySelector('silver-cat');
            return cat.dataset.frame !== window.__smokeCatAnimation.frame
                && cat.canvas.toDataURL() !== window.__smokeCatAnimation.pixels;
        }, undefined, { timeout: 4000, polling: 50 });
        const snapshot = (await petPage.evaluate(() => window.pawpal.getState())).data;
        await petPage.evaluate(() => {
            const cat = document.getElementById('desktop-puppy').shadowRoot.querySelector('silver-cat');
            Object.assign(window.__smokeCatAnimation, { broadcasts: 0, version: cat.frameVersion, elapsed: cat.elapsedMs });
            window.__smokeCatUnsubscribe = window.pawpal.onState(() => { window.__smokeCatAnimation.broadcasts += 1; });
        });
        await application.evaluate(({ BrowserWindow }, state) => {
            const pet = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/pet.html'));
            for (let index = 0; index < 5; index += 1) pet.webContents.send('pawpal:state', state);
        }, snapshot);
        await petPage.waitForFunction(() => window.__smokeCatAnimation.broadcasts >= 5);
        const uninterrupted = await petPage.evaluate(() => {
            const cat = document.getElementById('desktop-puppy').shadowRoot.querySelector('silver-cat');
            const baseline = window.__smokeCatAnimation;
            return { sameAction: cat.dataset.animation === 'idle', sameVersion: cat.frameVersion === baseline.version, elapsed: cat.elapsedMs, baseline: baseline.elapsed };
        });
        assert.equal(uninterrupted.sameAction, true);
        assert.equal(uninterrupted.sameVersion, true, 'same-action IPC broadcasts do not restart the clip');
        assert.ok(uninterrupted.elapsed >= uninterrupted.baseline, 'the animation clock never resets during state broadcasts');

        await setCatReducedMotion(petPage, true);
        const frozen = await petPage.locator('silver-cat').evaluate((cat) => ({ frame: cat.dataset.frame, elapsed: cat.elapsedMs, pixels: cat.canvas.toDataURL(), raf: cat.animationFrame }));
        await petPage.waitForTimeout(300);
        assert.deepEqual(await petPage.locator('silver-cat').evaluate((cat) => ({ frame: cat.dataset.frame, elapsed: cat.elapsedMs, pixels: cat.canvas.toDataURL(), raf: cat.animationFrame })), frozen);
        assert.equal(frozen.raf, null, 'reduced motion cancels the canvas animation loop');
        await setCatReducedMotion(petPage, false);
        await petPage.waitForFunction((elapsed) => document.getElementById('desktop-puppy').shadowRoot.querySelector('silver-cat').elapsedMs > elapsed, frozen.elapsed);
        await petPage.locator('silver-cat').evaluate((cat) => {
            window.__smokeDetachedCat = { cat, parent: cat.parentNode };
            cat.remove();
            Object.assign(window.__smokeDetachedCat, { frame: cat.dataset.frame, elapsed: cat.elapsedMs, pixels: cat.canvas.toDataURL() });
        });
        await petPage.waitForTimeout(200);
        const detached = await petPage.evaluate(() => {
            const { cat, frame, elapsed, pixels } = window.__smokeDetachedCat;
            return { connected: cat.isConnected, raf: cat.animationFrame, sameFrame: cat.dataset.frame === frame, sameTime: cat.elapsedMs === elapsed, samePixels: cat.canvas.toDataURL() === pixels };
        });
        assert.deepEqual(detached, { connected: false, raf: null, sameFrame: true, sameTime: true, samePixels: true });
        await petPage.evaluate(() => {
            const { cat, parent } = window.__smokeDetachedCat;
            parent.append(cat);
        });
        await petPage.waitForFunction(() => window.__smokeDetachedCat.cat.elapsedMs > window.__smokeDetachedCat.elapsed);
        console.log('✓ real idle atlas pixels advance, broadcasts preserve playback, reduced motion freezes, and detaching stops frames');
    } finally {
        await petPage.evaluate(() => {
            const detached = window.__smokeDetachedCat;
            if (detached && !detached.cat.isConnected) detached.parent.append(detached.cat);
            window.__smokeCatUnsubscribe?.();
            delete window.__smokeCatUnsubscribe;
            delete window.__smokeCatAnimation;
            delete window.__smokeDetachedCat;
        });
        await setCatReducedMotion(petPage, originalMotion);
    }
}

async function testCatCompanion(dashboard, petPage) {
    await application.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/index.html')).setSize(1120, 820);
    });
    await petPage.emulateMedia({ reducedMotion: 'no-preference' });
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
            const result = {
                cat: catItem.label, checkedDog: dogItem.checked, checkedSize: menu.getMenuItemById('pet-size-43').checked,
                pet: menu.getMenuItemById('care-pet').label, feed: menu.getMenuItemById('care-feed').label,
                fetch: menu.getMenuItemById('game-fetch').label, ball: menu.getMenuItemById('game-ball').label,
                pounce: Boolean(menu.getMenuItemById('game-pounce')),
            };
            catItem.click();
            return result;
        });
        assert.deepEqual(menuItems, {
            cat: 'Your cat · real photos', checkedDog: true, checkedSize: true,
            pet: 'Give a head scratch', feed: 'Give a treat', fetch: 'Fetch a bone', ball: 'Ball rally', pounce: false,
        });
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
    assert.equal(afterSwitch.name, 'My cat');
    assert.equal(afterSwitch.affection, 0);
    assert.equal(afterSwitch.interactions, 0);
    assert.deepEqual(afterSwitch.playStats, { pounce: 0, bubbles: 0, teaser: 0 });
    assert.equal(afterSwitch.settings.roaming, false);
    assert.equal(afterSwitch.settings.size, 30);
    assert.equal(afterSwitch.settings.coat, undefined);
    assert.equal(afterSwitch.settings.accessory, undefined);
    assert.equal(afterSwitch.settings.reducedMotion, false);
    assert.equal(afterSwitch.sleeping, false);
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
        await application.evaluate(() => {
            if (!globalThis.__smokePetMenu.getMenuItemById('pet-species-cat').checked) throw new Error('Expected the cat menu');
        });
        const catMenu = await application.evaluate(() => {
            const menu = globalThis.__smokePetMenu;
            return {
                pet: menu.getMenuItemById('care-pet').label, feed: menu.getMenuItemById('care-feed').label,
                pounce: menu.getMenuItemById('game-pounce').label, bubbles: menu.getMenuItemById('game-bubbles').label,
                fetch: Boolean(menu.getMenuItemById('game-fetch')), ball: Boolean(menu.getMenuItemById('game-ball')),
                checkedSize: menu.getMenuItemById('pet-size-30').checked,
            };
        });
        assert.deepEqual(catMenu, {
            pet: 'Give a chin scratch', feed: 'Offer a cat snack', pounce: 'Pounce & bat', bubbles: 'Bubble hunt',
            fetch: false, ball: false, checkedSize: true,
        });
    } finally {
        await application.evaluate(({ Menu }) => { Menu.prototype.popup = globalThis.__smokeMenuPopup; });
    }
    for (const mode of ['fetch', 'ball']) {
        const response = await dashboard.evaluate((game) => window.pawpal.play(game), mode);
        assert.equal(response.ok, false);
        assert.match(response.error, /not available for your cat/);
    }
    const invalidAppearance = await dashboard.evaluate(() => window.pawpal.preferences({ coat: 'cocoa' }));
    assert.equal(invalidAppearance.ok, false);
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 2);
    await dashboard.locator('[data-view="home"]').click();
    assert.equal(await dashboard.locator('.care-button[data-action="pet"] strong').textContent(), 'Chin scratches');
    assert.equal(await dashboard.locator('.care-button[data-action="feed"] .care-emoji').textContent(), '🥣');
    assert.equal(await dashboard.locator('#fullness-emoji').textContent(), '🥣');
    assert.equal(await dashboard.locator('[data-play-mode="fetch"]').count(), 0);
    assert.equal(await dashboard.locator('[data-play-mode="ball"]').count(), 0);
    assert.match(await dashboard.locator('#help-games').textContent(), /Pounce & bat/);
    await dashboard.locator('#rename-button').click();
    await dashboard.locator('#name-input').fill('小猫');
    await dashboard.locator('#rename-form button[type="submit"]').click();
    await dashboard.waitForFunction(() => document.getElementById('pet-name').textContent === '小猫');
    await dashboard.locator('[data-view="wardrobe"]').click();
    await dashboard.locator('[data-setting="catPose"][data-value="loaf"]').click();
    await petPage.locator('silver-cat[data-pose="loaf"][ready]').waitFor();
    await dashboard.locator('[data-setting="species"][data-value="dog"]').click();
    await petPage.waitForSelector('pet-avatar[species="dog"]');
    assert.equal(await petPage.locator('pet-avatar').getAttribute('coat'), 'cloud');
    assert.equal(await petPage.locator('pet-avatar').getAttribute('accessory'), 'collar');
    const restoredDog = (await petPage.evaluate(() => window.pawpal.getState())).data.pet;
    for (const field of ['name', 'affection', 'interactions', 'playStats', 'settings', 'position']) {
        assert.deepEqual(restoredDog[field], beforeSwitch[field]);
    }
    await dashboard.locator('[data-setting="species"][data-value="cat"]').click();
    await petPage.locator('silver-cat[data-pose="loaf"][ready]').waitFor();
    assert.equal((await petPage.evaluate(() => window.pawpal.getState())).data.pet.name, '小猫');
    await dashboard.locator('[data-setting="catPose"][data-value="sitting"]').click();
    await petPage.locator('silver-cat[data-pose="sitting"][ready]').waitFor();
    await setSize(dashboard, 30);
    await petPage.screenshot({ path: path.join(artifacts, 'cat-default-30.png'), omitBackground: true });
    await setSize(dashboard, 100);
    await dashboard.screenshot({ path: path.join(artifacts, 'cat-wardrobe.png') });
    await assertLayout(dashboard);
    await petPage.screenshot({ path: path.join(artifacts, 'cat-awake.png'), omitBackground: true });

    await testCatAnimation(petPage);
    const motionBeforeHitTest = (await petPage.evaluate(() => window.pawpal.getState())).data.pet.settings.reducedMotion;
    await setCatReducedMotion(petPage, true);
    await application.evaluate(({ BrowserWindow }) => {
        const pet = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/pet.html'));
        pet.__photoOriginalIgnore = pet.setIgnoreMouseEvents;
        pet.setIgnoreMouseEvents = function (ignore, options) {
            this.__photoIgnoresMouse = ignore;
            return this.__photoOriginalIgnore(ignore, options);
        };
    });
    try {
        const paintedMask = await sampleCatMask(petPage);
        assertCatMask(paintedMask);
        const beforeBlankClick = (await petPage.evaluate(() => window.pawpal.getState())).data.pet.interactions;
        await petPage.mouse.move(paintedMask.blankPoint.x, paintedMask.blankPoint.y);
        await petPage.waitForTimeout(50);
        await petPage.mouse.move(paintedMask.point.x, paintedMask.point.y);
        await petPage.waitForTimeout(50);
        assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/pet.html')).__photoIgnoresMouse), false);
        await petPage.mouse.click(paintedMask.blankPoint.x, paintedMask.blankPoint.y);
        await petPage.waitForTimeout(50);
        assert.equal((await petPage.evaluate(() => window.pawpal.getState())).data.pet.interactions, beforeBlankClick);
        assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/pet.html')).__photoIgnoresMouse), true);
        await petPage.mouse.click(paintedMask.point.x, paintedMask.point.y);
        await waitUntil(petPage, () => document.getElementById('desktop-puppy').getAttribute('behavior') === 'petting', 'clicking opaque cat pixels gives chin scratches, not belly rubs');
        await petPage.locator('silver-cat[data-pose="sitting"][ready]').waitFor();
        const pettedMask = await sampleCatMask(petPage);
        assertCatMask(pettedMask);
        await petPage.mouse.move(pettedMask.point.x, pettedMask.point.y);
        await petPage.waitForTimeout(50);
        assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/pet.html')).__photoIgnoresMouse), false);
        assert.match((await petPage.evaluate(() => window.pawpal.getState())).data.pet.activity[0].text, /chin scratch/);
    } finally {
        await application.evaluate(({ BrowserWindow }) => {
            const pet = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/pet.html'));
            pet.setIgnoreMouseEvents = pet.__photoOriginalIgnore;
            delete pet.__photoOriginalIgnore;
        });
        await setCatReducedMotion(petPage, motionBeforeHitTest);
    }
    await petPage.screenshot({ path: path.join(artifacts, 'cat-chin-scratch.png'), omitBackground: true });

    await dashboard.locator('[data-view="home"]').click();
    await clickCare(dashboard, 'feed');
    await dashboard.waitForFunction(() => document.querySelector('#activity-list .activity-emoji').textContent === '🥣');
    await dashboard.locator('#home-puppy silver-cat[data-pose="reaching"][ready]').waitFor();
    const preview = await dashboard.locator('#home-puppy silver-cat').evaluate((cat) => {
        const bounds = cat.canvas.getBoundingClientRect();
        return { width: bounds.width, height: bounds.height, painted: cat.mask.some((value, index) => index % 4 === 3 && value >= 24) };
    });
    assert.ok(preview.width > 100 && preview.height > 100 && preview.painted);
    await dashboard.screenshot({ path: path.join(artifacts, 'cat-home.png') });
    await clickCare(dashboard, 'sleep');
    await petPage.locator('silver-cat[data-pose="sleeping"][ready]').waitFor();
    const motionBeforeSleepTest = (await petPage.evaluate(() => window.pawpal.getState())).data.pet.settings.reducedMotion;
    await setCatReducedMotion(petPage, true);
    try {
        assert.equal(await petPage.locator('silver-cat').getAttribute('data-pose'), 'sleeping');
        assertCatMask(await sampleCatMask(petPage));
    } finally {
        await setCatReducedMotion(petPage, motionBeforeSleepTest);
    }
    await petPage.screenshot({ path: path.join(artifacts, 'cat-sleeping.png'), omitBackground: true });
    await dashboard.locator('[data-view="wardrobe"]').click();
    await dashboard.locator('[data-setting="species"][data-value="dog"]').click();
    await petPage.waitForSelector('pet-avatar[species="dog"][behavior="idle"]');
    const awakeDog = (await petPage.evaluate(() => window.pawpal.getState())).data.pet;
    assert.equal(awakeDog.sleeping, false);
    assert.equal(awakeDog.settings.size, 43);
    assert.deepEqual(awakeDog.playStats, beforeSwitch.playStats);
    await dashboard.locator('[data-setting="species"][data-value="cat"]').click();
    await petPage.waitForSelector('pet-avatar[species="cat"][behavior="sleeping"]');
    await setSize(dashboard, 30);
    await dashboard.locator('[data-view="home"]').click();
    await clickCare(dashboard, 'wake');
    await testCatToyScaling(petPage);
    await testDesktopGames(dashboard, petPage);

    await clickCare(dashboard, 'play');
    await dashboard.locator('[data-play-mode="pounce"]').click();
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
    assert.deepEqual(cancelled.pet.playStats, beforeSwitch.playStats);
    assert.equal(cancelled.pet.name, '豆豆');
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 2);
    await dashboard.locator('[data-setting="species"][data-value="cat"]').click();
    assert.deepEqual((await petPage.evaluate(() => window.pawpal.getState())).data.pet.playStats, beforeCancel);
    await dashboard.locator('[data-setting="catPose"][data-value="loaf"]').click();
    await setSize(dashboard, 65);
    await dashboard.locator('[data-view="preferences"]').click();
    await dashboard.locator('#setting-reducedMotion').check();
    await petPage.locator('silver-cat[data-pose="loaf"][ready]').waitFor();
    await petPage.waitForFunction(() => {
        const cat = document.getElementById('desktop-puppy').shadowRoot.querySelector('silver-cat');
        return cat.reducedMotion && cat.animationFrame === null;
    });
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
    console.log('✓ separate names, care, poses, sizes and sleep; cat-only menus, chin scratches, bowl snacks, pouncing, and alpha-only photo clicks');
}

async function testAlwaysAvailablePlay() {
    const { createProfiles } = require('../src/profiles.cjs');
    for (const species of hasPrivateCatPhotos ? ['dog', 'cat'] : ['dog']) {
        const saved = createProfiles();
        saved.activeSpecies = species;
        saved.pets[species].energy = 0;
        saved.pets[species].sleeping = true;
        saved.pets[species].settings.roaming = false;
        fs.writeFileSync(path.join(userData, 'companion.json'), JSON.stringify(saved));
        application = await openApplication();
        const petPage = await assertPetOnlyStartup(application, 30);
        const dashboard = await getDashboard(application);
        await dashboard.waitForSelector('#happiness-meter[aria-valuenow]');
        assert.equal((await petPage.evaluate(() => window.pawpal.getState())).data.pet.sleeping, true);
        assert.equal(await dashboard.locator('[data-action="play"]').isDisabled(), false);
        assert.ok((await dashboard.locator('[data-play-mode]').evaluateAll((buttons) => buttons.map((button) => button.disabled))).every((disabled) => !disabled));
        await application.evaluate(({ Menu, screen }) => {
            const originalPopup = Menu.prototype.popup;
            globalThis.__alwaysPlayMenuReady = new Promise((resolve) => {
                Menu.prototype.popup = function (options) {
                    Menu.prototype.popup = originalPopup;
                    globalThis.__alwaysPlayMenu = this;
                    options.callback?.();
                    resolve();
                };
            });
            globalThis.__smokeCursor = screen.getCursorScreenPoint();
            screen.getCursorScreenPoint = () => globalThis.__smokeCursor;
        });
        await petPage.evaluate(() => window.pawpal.menu());
        const menu = await application.evaluate(async () => {
            await globalThis.__alwaysPlayMenuReady;
            const play = globalThis.__alwaysPlayMenu.items.find((item) => item.label === 'Play together');
            return { enabled: play.enabled, games: play.submenu.items.map((item) => ({ id: item.id, enabled: item.enabled })) };
        });
        assert.equal(menu.enabled, true);
        assert.ok(menu.games.every((game) => game.enabled));
        if (species === 'dog') {
            await application.evaluate(() => globalThis.__alwaysPlayMenu.getMenuItemById('game-bubbles').click());
        } else {
            await clickCare(dashboard, 'play');
            await dashboard.locator('[data-play-mode="bubbles"]').click();
        }
        const toy = await gameWindow();
        await toy.waitForFunction(() => document.body.dataset.phase === 'ready');
        const started = (await petPage.evaluate(() => window.pawpal.getState())).data;
        assert.equal(started.pet.sleeping, false, 'starting a game wakes the pet automatically');
        assert.equal(started.pet.playStats.bubbles, 0, 'opening the game earns no rewards');
        assert.notEqual(started.runtime.behavior, 'sleeping');
        for (const completed of [1, 2]) {
            await throwDesktopToy(toy, 'bubbles');
            await toy.waitForFunction((count) => document.body.dataset.completed === String(count) && document.body.dataset.phase === 'ready', completed, { timeout: 15000 });
            const current = (await petPage.evaluate(() => window.pawpal.getState())).data;
            assert.equal(current.pet.energy, 0);
            assert.equal(current.pet.playStats.bubbles, completed);
            assert.equal(current.game.phase, 'ready', 'zero energy does not put toys away');
            assert.equal(await dashboard.locator('[data-action="play"]').isDisabled(), false);
        }
        const closed = toy.waitForEvent('close');
        await dashboard.locator('#play-status [data-stop-play]').click();
        await closed;
        const restarted = await petPage.evaluate(() => window.pawpal.play('bubbles'));
        assert.equal(restarted.ok, true, 'a new game can start at exactly zero energy');
        const nativeState = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
            .filter((window) => !window.webContents.getURL().endsWith('/index.html'))
            .map((window) => ({ focusable: window.isFocusable(), focused: window.isFocused() })));
        assert.ok(nativeState.every((window) => !window.focusable && !window.focused));
        await application.evaluate(({ app }) => { setTimeout(() => app.quit(), 50); });
        await application.close();
        application = null;
        const persisted = JSON.parse(fs.readFileSync(path.join(userData, 'companion.json'), 'utf8'));
        assert.equal(persisted.pets[species].sleeping, false);
        assert.equal(persisted.pets[species].energy, 0);
        assert.equal(persisted.pets[species].playStats.bubbles, 2);
        console.log(`✓ ${species}: sleeping and zero-energy pets can play from menus and dashboard, wake automatically, and continue across rounds`);
    }
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
        saved.activeSpecies = 'cat';
        saved.pets.cat.name = '小猫';
        saved.pets.cat.settings.catPose = 'loaf';
        saved.pets.cat.settings.size = 65;
        saved.pets.cat.playStats.pounce = 4;
        fs.writeFileSync(filename, JSON.stringify(saved));
        application = await openApplication([], fixture);
        const petPage = await assertPetOnlyStartup(application, saved.pets.dog.settings.size);
        const snapshot = (await petPage.evaluate(() => window.pawpal.getState())).data;
        assert.equal(snapshot.catAvailable, false);
        assert.equal(snapshot.pet.settings.species, 'dog');
        assert.equal(snapshot.pet.settings.catPose, undefined);
        assert.equal(snapshot.pet.name, saved.pets.dog.name);
        assert.equal(snapshot.pet.affection, saved.pets.dog.affection);
        assert.deepEqual(snapshot.pet.playStats, saved.pets.dog.playStats);
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
        await application.evaluate(({ app }) => { setTimeout(() => app.quit(), 50); });
        await application.close();
        application = null;
        const fallbackSave = JSON.parse(fs.readFileSync(filename, 'utf8'));
        assert.equal(fallbackSave.activeSpecies, 'dog');
        for (const field of ['name', 'affection', 'interactions', 'playStats', 'settings', 'activity']) {
            assert.deepEqual(fallbackSave.pets.cat[field], saved.pets.cat[field]);
        }
        console.log('✓ missing photos restore the puppy’s own profile and preserve the separate cat profile');
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
        assert.equal(await dashboard.locator('[data-action="play"]').isDisabled(), false);
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
        assert.equal(saved.version, 3);
        assert.equal(saved.activeSpecies, hasPrivateCatPhotos ? 'cat' : 'dog');
        assert.equal(saved.pets.dog.name, '豆豆');
        assert.equal(saved.pets.dog.settings.coat, 'cloud');
        assert.equal(saved.pets.dog.settings.roaming, false);
        assert.ok(saved.pets.dog.interactions >= 3);
        assert.deepEqual(saved.pets.dog.playStats, { fetch: 1, ball: 1, bubbles: 1 });
        assert.equal(saved.pets.dog.settings.size, 43);
        assert.equal(saved.pets.dog.settings.accessory, 'collar');
        assert.equal(saved.pets.dog.settings.catPose, undefined);
        assert.equal(saved.pets.cat.settings.coat, undefined);
        assert.equal(saved.pets.cat.settings.accessory, undefined);
        if (hasPrivateCatPhotos) {
            assert.equal(saved.pets.cat.name, '小猫');
            assert.equal(saved.pets.cat.settings.size, 65);
            assert.equal(saved.pets.cat.settings.catPose, 'loaf');
            assert.deepEqual(saved.pets.cat.playStats, { pounce: 1, bubbles: 1, teaser: 0 });
            assert.ok(saved.pets.cat.interactions >= 4);
            assert.ok(saved.pets.cat.activity.every((entry) => !/bone|belly rub|puppy/.test(entry.text)));
        }

        application = await openApplication();
        const restoredPet = await assertPetOnlyStartup(application, hasPrivateCatPhotos ? 65 : 43);
        assert.equal(await restoredPet.locator('pet-avatar').getAttribute('species'), hasPrivateCatPhotos ? 'cat' : 'dog');
        if (hasPrivateCatPhotos) await restoredPet.locator('silver-cat[data-pose="loaf"][ready]').waitFor();
        await assertPetClicksStayOnDesktop(application, restoredPet);
        const restored = await getDashboard(application);
        await restored.waitForFunction((name) => document.getElementById('pet-name').textContent === name, hasPrivateCatPhotos ? '小猫' : '豆豆');
        assert.equal(await restored.locator('pet-avatar').first().getAttribute('coat'), hasPrivateCatPhotos ? 'silver-tabby' : 'cloud');
        await restored.locator('[data-view="wardrobe"]').click();
        assert.equal(await restored.locator('#pet-size-range').inputValue(), hasPrivateCatPhotos ? '65' : '43');
        await restored.locator('[data-setting="species"][data-value="dog"]').click();
        await restoredPet.waitForSelector('pet-avatar[species="dog"][coat="cloud"][accessory="collar"]');
        assert.equal(await restored.locator('#pet-name').textContent(), '豆豆');
        assert.equal(await restored.locator('#pet-size-range').inputValue(), '43');
        assert.deepEqual((await restored.evaluate(() => window.pawpal.getState())).data.pet.playStats, { fetch: 1, ball: 1, bubbles: 1 });
        console.log('✓ both companion profiles survive restart with their own name, size, appearance and game totals');
        assert.equal((await restored.evaluate(() => window.pawpal.window('hide-home'))).ok, true);
        await assertPetClicksStayOnDesktop(application, restoredPet);
        await application.evaluate(({ app }) => { setTimeout(() => app.quit(), 50); });
        await application.close();
        application = null;

        const legacySave = JSON.parse(fs.readFileSync(path.join(userData, 'companion.json'), 'utf8')).pets.dog;
        legacySave.version = 1;
        legacySave.settings.size = 'medium';
        delete legacySave.settings.species;
        delete legacySave.settings.catPose;
        fs.writeFileSync(path.join(userData, 'companion.json'), JSON.stringify(legacySave));
        application = await openApplication(['--hidden', '--show-dashboard']);
        const migratedPet = await assertPetOnlyStartup(application, 30);
        const migrated = (await migratedPet.evaluate(() => window.pawpal.getState())).data.pet;
        assert.equal(migrated.name, '豆豆');
        assert.deepEqual(migrated.playStats, saved.pets.dog.playStats);
        assert.equal(migrated.version, 2);
        assert.equal(migrated.settings.species, 'dog');
        await application.evaluate(({ app }) => { setTimeout(() => app.quit(), 50); });
        await application.close();
        application = null;
        const migrationBackup = fs.readdirSync(userData).find((filename) => filename.startsWith('companion.json.before-profiles-'));
        assert.ok(migrationBackup);
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(userData, migrationBackup), 'utf8')), legacySave);
        assert.equal(JSON.parse(fs.readFileSync(path.join(userData, 'companion.json'), 'utf8')).version, 3);

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
        await testAlwaysAvailablePlay();
        assert.deepEqual(pageErrors, []);
        console.log(`\nAll Electron smoke checks passed. Screenshots: ${artifacts}`);
    } catch (error) {
        if (application) {
            console.error('Window diagnostics:', await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((window) => ({
                url: window.webContents.getURL(), visible: window.isVisible(), focused: window.isFocused(), bounds: window.getBounds(),
            }))).catch(() => []));
            const dashboard = application.windows().find((page) => page.url().endsWith('/index.html'));
            if (dashboard) {
                console.error('Dashboard diagnostics:', await dashboard.evaluate(() => ({
                    clicks: window.__smokeClicks,
                    views: [...document.querySelectorAll('.view')].map((view) => ({ id: view.id, hidden: view.hidden })),
                    dialogs: [...document.querySelectorAll('dialog[open]')].map((dialog) => dialog.id),
                })).catch(() => null));
                await dashboard.screenshot({ path: path.join(artifacts, 'smoke-failure.png'), timeout: 3000 }).catch(() => {});
            }
        }
        throw error;
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
