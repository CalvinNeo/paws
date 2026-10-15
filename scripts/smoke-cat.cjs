const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const { createState } = require('../src/model.cjs');
const catProfile = require('../assets/cat/poses.mjs').default;
const catCompanion = require('../src/companions/cat.cjs');

const root = path.join(__dirname, '..');
const artifacts = path.join(root, '.test-artifacts', 'cat-only');
const modes = ['pounce', 'bubbles', 'teaser'];
const pageErrors = [];
let userData;
let application;
let petPage;

function checkAssets() {
    assert.deepEqual(Object.keys(catCompanion.games).sort(), [...modes].sort(), 'cat QA requires all three registered games');
    assert.equal(catCompanion.games.teaser.toy, 'feather');
    const files = Object.values(catProfile.poses).map((pose) => pose.file);
    for (const name of ['idle', 'watch', 'bat']) {
        const clip = catProfile.animations?.[name];
        assert.ok(clip?.frames > 1, `cat QA requires the real ${name} atlas`);
        files.push(...clip.files);
    }
    for (const file of files) assert.ok(fs.existsSync(path.join(root, 'assets/cat', file)), `Missing private cat asset: ${file}`);
}

async function state() {
    const result = await petPage.evaluate(() => window.pawpal.getState());
    assert.equal(result.ok, true);
    assert.equal(result.data.pet.settings.species, 'cat', 'every scenario stays on the cat profile');
    return result.data;
}

async function preferences(patch) {
    const result = await petPage.evaluate((patch) => window.pawpal.preferences(patch), patch);
    assert.equal(result.ok, true, result.error);
    return result.data;
}

async function pageFor(filename) {
    return application.windows().find((page) => page.url().endsWith(`/${filename}`))
        || application.waitForEvent('window', { predicate: (page) => page.url().endsWith(`/${filename}`) });
}

async function nativeWindows() {
    return application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((window) => ({
        id: window.id, filename: window.webContents.getURL().split('/').pop(), bounds: window.getBounds(),
        visible: window.isVisible(), focused: window.isFocused(), focusable: window.isFocusable(),
        fullscreen: window.isFullScreen(), ignoresMouse: window.__catQAIgnoresMouse,
    })));
}

async function toyWindow() {
    const window = (await nativeWindows()).find((window) => window.filename === 'toy.html');
    assert.ok(window, 'the cat toy has its own small window');
    assert.equal(window.focused, false);
    assert.equal(window.focusable, false);
    assert.equal(window.fullscreen, false);
    return window;
}

async function setCursor(point) {
    await application.evaluate((_electron, point) => { globalThis.__catQACursor = point; }, point);
}

async function waitForNativePassthrough(expected) {
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
        if ((await toyWindow()).ignoresMouse === expected) return;
        await petPage.waitForTimeout(25);
    }
    assert.equal((await toyWindow()).ignoresMouse, expected, 'native toy input agrees with the painted hit region');
}

async function sampleToy(page) {
    return page.evaluate(() => {
        const hit = (horizontal, vertical) => Boolean(document.elementFromPoint(horizontal, vertical)?.closest('[data-hit]'));
        let opaque = null;
        let blank = null;
        let nearest = Infinity;
        for (let vertical = 2; vertical < innerHeight - 2; vertical += 2) {
            for (let horizontal = 2; horizontal < innerWidth - 2; horizontal += 2) {
                const neighbors = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]];
                const painted = neighbors.every(([offsetX, offsetY]) => hit(horizontal + offsetX, vertical + offsetY));
                const clear = neighbors.every(([offsetX, offsetY]) => !hit(horizontal + offsetX, vertical + offsetY));
                const distance = Math.hypot(horizontal - innerWidth / 2, vertical - innerHeight / 2);
                if (painted && distance < nearest) {
                    opaque = { x: horizontal, y: vertical };
                    nearest = distance;
                }
                if (clear && !blank) blank = { x: horizontal, y: vertical };
            }
        }
        return { opaque, blank, width: innerWidth, height: innerHeight };
    });
}

async function startGame(mode) {
    const before = (await state()).pet.playStats;
    const result = await petPage.evaluate((mode) => window.pawpal.play(mode), mode);
    assert.equal(result.ok, true, result.error);
    const page = await pageFor('toy.html');
    await page.waitForFunction((mode) => document.body.dataset.mode === mode && document.body.dataset.phase === 'ready', mode);
    await page.evaluate(async () => {
        window.__catQATrace = [];
        window.__catQAPointer = null;
        document.addEventListener('pointerdown', (event) => { window.__catQAPointer = event.pointerId; }, true);
        const record = (snapshot) => {
            if (!snapshot) return;
            window.__catQATrace.push({
                action: snapshot.catMotion?.action, phase: snapshot.phase, completed: snapshot.completed,
                captured: window.__catQAPointer !== null && document.getElementById('toy').hasPointerCapture(window.__catQAPointer),
            });
            if (window.__catQATrace.length > 5000) window.__catQATrace.shift();
        };
        window.pawpal.onToyState(record);
        record((await window.pawpal.toyState()).data);
    });
    const snapshot = await state();
    assert.equal(snapshot.game.mode, mode);
    assert.equal(snapshot.pet.sleeping, false, 'starting a game wakes a sleeping cat');
    assert.deepEqual(snapshot.pet.playStats, before, 'opening a game awards no points');
    await toyWindow();
    return page;
}

async function stopGame(page) {
    const closed = page && !page.isClosed() ? page.waitForEvent('close') : Promise.resolve();
    const result = await petPage.evaluate(() => window.pawpal.play('stop'));
    assert.equal(result.ok, true, result.error);
    await closed;
    assert.equal((await state()).game, null);
}

async function holdToy(page) {
    const points = await sampleToy(page);
    assert.ok(points.opaque && points.blank, 'toy has both painted and transparent points');
    const window = await toyWindow();
    await setCursor({ x: window.bounds.x + points.opaque.x, y: window.bounds.y + points.opaque.y });
    await page.mouse.move(points.opaque.x, points.opaque.y);
    await waitForNativePassthrough(false);
    await page.mouse.down();
    await page.waitForFunction(() => window.__catQAPointer !== null
        && document.getElementById('toy').hasPointerCapture(window.__catQAPointer));
    return {
        center: { x: window.bounds.x + window.bounds.width / 2, y: window.bounds.y + window.bounds.height / 2 },
        offset: { x: points.opaque.x - window.bounds.width / 2, y: points.opaque.y - window.bounds.height / 2 },
    };
}

async function moveHeldToy(grab, center) {
    await setCursor({ x: center.x + grab.offset.x, y: center.y + grab.offset.y });
}

async function releaseToy(page, cancel = false) {
    if (cancel) {
        await page.evaluate(() => document.getElementById('toy').dispatchEvent(new PointerEvent('pointercancel', {
            pointerId: window.__catQAPointer, bubbles: true,
        })));
    }
    await page.mouse.up();
    await page.waitForFunction(() => !document.getElementById('toy').hasPointerCapture(window.__catQAPointer));
    const window = await toyWindow();
    await setCursor({ x: window.bounds.x - 50, y: window.bounds.y - 50 });
    await page.mouse.move(0, 0);
    await waitForNativePassthrough(true);
}

async function noSurpriseSettings(label) {
    const baseline = await nativeWindows();
    const calls = await application.evaluate(() => globalThis.__catQAHomeCalls.length);
    await preferences({ reducedMotion: true });
    for (const clickCount of [1, 2, 3]) {
        await petPage.waitForTimeout(500);
        await petPage.locator('silver-cat[ready]').waitFor();
        const point = await petPage.locator('silver-cat').evaluate((cat) => {
            const bounds = cat.canvas.getBoundingClientRect();
            const scale = Math.min(bounds.width / cat.maskWidth, bounds.height / cat.maskHeight);
            for (let vertical = 4; vertical < cat.maskHeight - 4; vertical += 4) {
                for (let horizontal = 4; horizontal < cat.maskWidth - 4; horizontal += 4) {
                    const alpha = (offsetX, offsetY) => cat.mask[((vertical + offsetY) * cat.maskWidth + horizontal + offsetX) * 4 + 3];
                    if ([[0, 0], [-3, 0], [3, 0], [0, -3], [0, 3]].every(([offsetX, offsetY]) => alpha(offsetX, offsetY) > 230)) {
                        return {
                            x: bounds.left + (bounds.width - cat.maskWidth * scale) / 2 + (horizontal + .5) * scale,
                            y: bounds.top + (bounds.height - cat.maskHeight * scale) / 2 + (vertical + .5) * scale,
                        };
                    }
                }
            }
            return null;
        });
        assert.ok(point, 'cat has an opaque interior to click');
        const before = (await state()).pet.interactions;
        await petPage.mouse.click(point.x, point.y, { clickCount, delay: 30 });
        await petPage.waitForFunction((before) => window.pawpal.getState().then((result) => result.data.pet.interactions > before), before);
        await application.evaluate(({ app }) => app.emit('activate', {}, false));
        const after = await nativeWindows();
        assert.deepEqual(after.map(({ id, filename, visible, focused }) => ({ id, filename, visible, focused })),
            baseline.map(({ id, filename, visible, focused }) => ({ id, filename, visible, focused })), label);
        assert.equal(await application.evaluate(() => globalThis.__catQAHomeCalls.length), calls, label);
    }
    await preferences({ reducedMotion: false });
    console.log(`✓ cat clicks: ${label}`);
}

async function checkMenus() {
    await application.evaluate(({ Menu }) => {
        const popup = Menu.prototype.popup;
        globalThis.__catQAMenu = null;
        Menu.prototype.popup = function (options) {
            Menu.prototype.popup = popup;
            const play = this.items.find((item) => item.label === 'Play together');
            globalThis.__catQAMenu = { enabled: play.enabled, items: play.submenu.items.map((item) => ({ id: item.id, enabled: item.enabled })) };
            options.callback?.();
        };
    });
    await petPage.evaluate(() => window.pawpal.menu());
    const deadline = Date.now() + 3000;
    let menu;
    while (Date.now() < deadline) {
        menu = await application.evaluate(() => globalThis.__catQAMenu);
        if (menu) break;
        await petPage.waitForTimeout(25);
    }
    assert.ok(menu);
    assert.equal(menu.enabled, true);
    assert.deepEqual(menu.items.map((item) => item.id).sort(), modes.map((mode) => `game-${mode}`).sort());
    assert.ok(menu.items.every((item) => item.enabled), 'sleep and low energy never disable cat games');
    assert.equal((await petPage.evaluate(() => window.pawpal.window('home'))).ok, true);
    const dashboard = await pageFor('index.html');
    await dashboard.locator('#happiness-meter[aria-valuenow]').waitFor();
    await dashboard.locator('[data-action="play"]').click();
    assert.deepEqual((await dashboard.locator('[data-play-mode]').evaluateAll((buttons) => buttons.map((button) => button.dataset.playMode))).sort(), [...modes].sort());
    assert.ok((await dashboard.locator('[data-play-mode]').evaluateAll((buttons) => buttons.map((button) => !button.disabled))).every(Boolean));
    await dashboard.screenshot({ path: path.join(artifacts, 'cat-three-games.png') });
    await dashboard.keyboard.press('Escape');
    assert.equal((await petPage.evaluate(() => window.pawpal.window('hide-home'))).ok, true);
    await petPage.waitForTimeout(100);
    console.log('✓ cat menu and dashboard expose three enabled cat games');
}

async function checkStanding() {
    await petPage.waitForTimeout(500);
    const asleep = await petPage.evaluate(() => window.pawpal.action('stand'));
    assert.equal(asleep.ok, false);
    assert.equal(asleep.error, 'Wake up first.');
    assert.equal((await petPage.evaluate(() => window.pawpal.action('wake'))).ok, true);
    await preferences({ catPose: 'loaf', reducedMotion: false });
    await petPage.waitForTimeout(500);
    const before = await state();
    const windows = await nativeWindows();
    assert.equal(before.standingAvailable, true);
    const start = await petPage.evaluate(() => window.pawpal.action('stand'));
    assert.equal(start.ok, true, start.error);
    const avatar = petPage.locator('silver-cat');
    await avatar.locator('canvas').waitFor();
    await petPage.waitForFunction(() => document.querySelector('pet-avatar').avatar.dataset.animation === 'photo-stand');
    await petPage.waitForTimeout(1400);
    assert.equal(await avatar.getAttribute('data-stand-phase'), 'hold');
    const firstTimestamp = (await state()).runtime.catActionStartedAt;
    const replay = await petPage.evaluate(() => window.pawpal.action('stand'));
    assert.equal(replay.ok, true, replay.error);
    assert.ok((await state()).runtime.catActionStartedAt > firstTimestamp);
    assert.ok(await avatar.evaluate(cat => cat.elapsedMs) < 400, 'a repeated action restarts playback');
    await petPage.waitForTimeout(1100);
    await petPage.screenshot({ path: path.join(artifacts, 'cat-standing-30.png'), omitBackground: true });
    const during = await state();
    assert.equal(during.pet.interactions, before.pet.interactions);
    assert.equal(during.pet.affection, before.pet.affection);
    assert.deepEqual(during.pet.playStats, before.pet.playStats);
    assert.equal(during.pet.settings.catPose, 'loaf');
    const windowGeometry = (items) => items.map(({ ignoresMouse, ...window }) => window);
    assert.deepEqual(windowGeometry(await nativeWindows()), windowGeometry(windows), 'standing never resizes, moves, focuses, or creates a window');
    await petPage.waitForFunction(() => window.pawpal.getState().then(result => result.data.runtime.behavior === 'idle'));
    await petPage.waitForFunction(() => document.querySelector('pet-avatar').avatar.dataset.pose === 'loaf');
    await preferences({ catPose: 'standing', reducedMotion: true });
    await petPage.waitForFunction(() => document.querySelector('pet-avatar').avatar.dataset.pose === 'standing');
    assert.equal((await petPage.evaluate(() => window.pawpal.action('stand'))).ok, true);
    await petPage.waitForTimeout(100);
    assert.equal(await avatar.evaluate(cat => cat.animationFrame), null);
    await petPage.waitForTimeout(500);
    assert.equal((await petPage.evaluate(() => window.pawpal.action('sleep'))).ok, true);
    await preferences({ catPose: 'sitting', reducedMotion: false });
    console.log('✓ cat standing: replay, return to prior pose, reduced motion, no rewards, and no screen takeover');
}

async function assertShapeInput(page, expectedSize) {
    const window = await toyWindow();
    const snapshot = (await page.evaluate(() => window.pawpal.toyState())).data;
    assert.equal(window.bounds.width, expectedSize);
    assert.equal(window.bounds.height, expectedSize);
    assert.equal(snapshot.toySize, expectedSize);
    const points = await sampleToy(page);
    assert.equal(points.width, expectedSize);
    assert.equal(points.height, expectedSize);
    assert.ok(points.opaque && points.blank);
    for (const [point, ignore] of [[points.opaque, false], [points.blank, true]]) {
        await setCursor({ x: window.bounds.x + point.x, y: window.bounds.y + point.y });
        await page.mouse.move(point.x, point.y);
        await waitForNativePassthrough(ignore);
    }
    const windows = await nativeWindows();
    assert.ok(windows.length <= 3, 'only cat, toy and explicitly opened settings exist');
    assert.ok(windows.filter((window) => window.filename !== 'index.html').every((window) => !window.focusable && !window.focused && !window.fullscreen));
    assert.ok(windows.filter((window) => window.filename === 'index.html').every((window) => !window.visible && !window.focused));
}

async function checkToyScales() {
    const baseline = (await state()).pet.playStats;
    for (const [size, expected] of [[30, 29], [20, 24], [150, 144]]) {
        await preferences({ size });
        for (const mode of modes) {
            const page = await startGame(mode);
            await assertShapeInput(page, expected);
            await page.screenshot({ path: path.join(artifacts, `cat-${mode}-${size}.png`), omitBackground: true });
            await stopGame(page);
        }
    }
    assert.deepEqual((await state()).pet.playStats, baseline);
    await preferences({ size: 30 });
    console.log('✓ cat-only toys at 20%, default 30% and 150% keep painted input and non-focusing windows aligned');
}

async function quickRound(mode) {
    const before = (await state()).pet.playStats[mode];
    const page = await startGame(mode);
    const grab = await holdToy(page);
    if (mode === 'pounce') {
        for (let step = 1; step <= 10; step += 1) {
            await moveHeldToy(grab, { x: grab.center.x - step * 29, y: grab.center.y - step * 13 });
            await page.waitForTimeout(20);
        }
    }
    await releaseToy(page);
    await page.waitForFunction(() => document.body.dataset.completed === '1' && document.body.dataset.phase === 'ready', undefined, { timeout: 15000 });
    const completed = await state();
    assert.equal(completed.pet.playStats[mode], before + 1);
    assert.equal(completed.pet.energy, 0, 'cat can finish another round at zero energy');
    await page.waitForTimeout(900);
    assert.equal((await state()).pet.playStats[mode], before + 1, 'idle toys never repeat rewards');
    await petPage.screenshot({ path: path.join(artifacts, `cat-${mode}-completed.png`), omitBackground: true });
    await stopGame(page);
    console.log(`✓ cat ${mode}: one completed round at zero energy`);
}

async function teaserRound() {
    const before = (await state()).pet.playStats.teaser;
    const page = await startGame('teaser');
    assert.equal((await state()).game.toy, 'feather');
    const grab = await holdToy(page);
    await moveHeldToy(grab, { x: grab.center.x - 30, y: grab.center.y - 15 });
    await page.waitForFunction(() => window.__catQATrace.some((entry) => entry.action === 'pounce' && entry.captured), undefined, { timeout: 10000, polling: 10 });
    const heldActions = await page.evaluate(() => window.__catQATrace.filter((entry) => entry.captured).map((entry) => entry.action));
    const watch = heldActions.indexOf('watch');
    const crouch = heldActions.indexOf('crouch', watch + 1);
    const pounce = heldActions.indexOf('pounce', crouch + 1);
    assert.ok(watch >= 0 && crouch > watch && pounce > crouch, `held teaser stages: ${heldActions.join(', ')}`);
    assert.equal((await state()).pet.playStats.teaser, before, 'watching and preparing a pounce earn no reward');
    const target = await application.evaluate(({ BrowserWindow, screen }) => {
        const bounds = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/pet.html')).getBounds();
        const area = screen.getDisplayMatching(bounds).workArea;
        const centerX = bounds.x + bounds.width / 2;
        return {
            x: centerX > area.x + area.width / 2 ? area.x + bounds.width + 80 : area.x + area.width - bounds.width - 80,
            y: Math.max(area.y + bounds.height + 40, Math.min(area.y + area.height - 100, bounds.y + bounds.height * .7)),
        };
    });
    const previousWindow = await toyWindow();
    await moveHeldToy(grab, target);
    await page.waitForTimeout(180);
    const escapedWindow = await toyWindow();
    assert.ok(Math.hypot(escapedWindow.bounds.x - previousWindow.bounds.x, escapedWindow.bounds.y - previousWindow.bounds.y) > 100, 'moving the held feather evades the first pounce');
    assert.equal((await state()).pet.playStats.teaser, before, 'a missed pounce cannot award a distant catch');
    assert.equal(await page.evaluate(() => document.getElementById('toy').hasPointerCapture(window.__catQAPointer)), true);
    await petPage.screenshot({ path: path.join(artifacts, 'cat-teaser-evade-mechanics.png'), omitBackground: true });
    await page.waitForFunction(() => document.body.dataset.phase === 'ready', undefined, { timeout: 15000, polling: 10 });
    assert.equal((await state()).pet.playStats.teaser, before, 'the first missed jump settles without a reward');
    const nearby = await application.evaluate(({ BrowserWindow }, geometry) => {
        const bounds = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/pet.html')).getBounds();
        if (!geometry.contact) return { x: bounds.x + bounds.width * .7, y: bounds.y + bounds.height * .65 };
        const scale = Math.min(bounds.width * .88 / geometry.width, bounds.height * .86 / geometry.height);
        return {
            x: bounds.x + bounds.width * .5 + (geometry.contact.x - .5) * geometry.width * scale + bounds.width * .15,
            y: bounds.y + bounds.height * geometry.anchor + (geometry.contact.y - .925) * geometry.height * scale - bounds.height * .15,
        };
    }, { contact: catProfile.animations?.['teaser-jump']?.contact, width: catProfile.width, height: catProfile.height, anchor: catCompanion.playAnchor });
    const restart = await page.evaluate(() => window.__catQATrace.length);
    await moveHeldToy(grab, nearby);
    await page.waitForFunction((restart) => window.__catQATrace.slice(restart).some((entry) => entry.action === 'pounce' && entry.captured), restart, { timeout: 10000, polling: 10 });
    const replay = await page.evaluate((restart) => window.__catQATrace.slice(restart).filter((entry) => entry.captured).map((entry) => entry.action), restart);
    const replayWatch = replay.indexOf('watch');
    const replayCrouch = replay.indexOf('crouch', replayWatch + 1);
    assert.ok(replayWatch >= 0 && replayCrouch > replayWatch && replay.indexOf('pounce', replayCrouch + 1) > replayCrouch,
        `moving the held feather back within reach starts another watch → crouch → pounce: ${replay.join(', ')}`);
    await petPage.locator('silver-cat[data-action="pounce"]').waitFor();
    const animation = await petPage.locator('silver-cat').getAttribute('data-animation');
    assert.ok(animation && animation !== 'static', 'teaser mechanics render available moving footage or its fallback');
    await petPage.screenshot({ path: path.join(artifacts, 'cat-teaser-nearby-mechanics.png'), omitBackground: true });
    const motion = (await state()).game.catMotion;
    const contactReady = Boolean(motion.contactReady);
    const canCatch = contactReady || Boolean(motion.prototype);
    if (canCatch) {
        await page.waitForFunction(() => Number(document.body.dataset.completed) === 1, undefined, { timeout: 15000 });
    }
    await page.waitForFunction(() => document.body.dataset.phase === 'ready', undefined, { timeout: 15000 });
    const expected = before + Number(canCatch);
    assert.equal((await state()).pet.playStats.teaser, expected, canCatch
        ? 'one nearby paw contact earns one reward' : 'uncalibrated jump footage cannot earn a fabricated catch');
    const attempts = (await state()).game.throws;
    await page.waitForTimeout(1800);
    assert.equal((await state()).pet.playStats.teaser, expected, 'holding still never repeats a catch reward');
    assert.equal((await state()).game.throws, attempts, 'holding still never starts another jump');
    await releaseToy(page);
    await page.waitForTimeout(1000);
    assert.equal((await state()).pet.playStats.teaser, expected, 'letting go and idling never repeat the reward');
    assert.equal((await state()).game.throws, attempts);
    if (canCatch) assert.equal((await state()).pet.energy, 0);
    await stopGame(page);
    const catchLabel = motion.prototype ? 'prototype catch once' : contactReady ? 'calibrated catch once' : 'uncalibrated catch disabled';
    console.log(`✓ held feather mechanics: watch → crouch → pounce, evade, move back within reach, ${catchLabel}, release to click-through`);
    if (!contactReady) console.log('Pending media QA: no annotated full-jump contact clip; authentic jump appearance and contact alignment remain unverified.');
}

async function teaserInputCleanup() {
    for (const cancel of [false, true]) {
        const before = (await state()).pet.playStats.teaser;
        const page = await startGame('teaser');
        const grab = await holdToy(page);
        await moveHeldToy(grab, { x: grab.center.x - 100, y: grab.center.y - 60 });
        await releaseToy(page, cancel);
        await page.waitForFunction(() => document.body.dataset.phase === 'ready', undefined, { timeout: 15000 });
        await page.waitForTimeout(700);
        if (cancel) assert.equal((await state()).pet.playStats.teaser, before, 'cancelled feather input earns no reward');
        await waitForNativePassthrough(true);
        await stopGame(page);
    }
    console.log('✓ teaser release and pointer cancellation clear capture and restore mouse passthrough');
}

(async () => {
    checkAssets();
    fs.mkdirSync(artifacts, { recursive: true });
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pawpal-cat-only-'));
    const cat = createState(Date.now(), 'cat');
    assert.equal(cat.settings.size, 30, 'new cats default to 30%');
    Object.assign(cat, { name: 'Cat QA', energy: 0, sleeping: true });
    Object.assign(cat.settings, { roaming: false, reducedMotion: false });
    fs.writeFileSync(path.join(userData, 'companion.json'), JSON.stringify({ version: 3, activeSpecies: 'cat', pets: { cat } }));
    const environment = { ...process.env, PAWPAL_USER_DATA: userData };
    delete environment.ELECTRON_RUN_AS_NODE;
    try {
        application = await electron.launch({ args: [root], env: environment, timeout: 60000 });
        application.context().setDefaultTimeout(10000);
        await application.evaluate(({ BrowserWindow }) => {
            globalThis.__catQAStops = [];
            const destroy = BrowserWindow.prototype.destroy;
            BrowserWindow.prototype.destroy = function (...args) {
                if (this.webContents.getURL().endsWith('/toy.html')) globalThis.__catQAStops.push(new Error('Toy closed').stack);
                return destroy.apply(this, args);
            };
        });
        const observe = (page) => page.on('pageerror', (error) => pageErrors.push(`${page.url()}: ${error.message}`));
        application.on('window', observe);
        for (const page of application.windows()) observe(page);
        petPage = await pageFor('pet.html');
        await petPage.locator('pet-avatar[species="cat"] silver-cat[ready]').waitFor();
        await application.evaluate(({ BrowserWindow, screen }) => {
            globalThis.__catQACursor = screen.getCursorScreenPoint();
            screen.getCursorScreenPoint = () => globalThis.__catQACursor;
            globalThis.__catQAHomeCalls = [];
            const ignoreMouse = BrowserWindow.prototype.setIgnoreMouseEvents;
            BrowserWindow.prototype.setIgnoreMouseEvents = function (ignore, options) {
                this.__catQAIgnoresMouse = ignore;
                return ignoreMouse.call(this, ignore, options);
            };
            for (const method of ['show', 'focus', 'restore']) {
                const original = BrowserWindow.prototype[method];
                BrowserWindow.prototype[method] = function (...argumentsList) {
                    if (this.webContents.getURL().endsWith('/index.html')) globalThis.__catQAHomeCalls.push(method);
                    return original.apply(this, argumentsList);
                };
            }
        });
        const startup = await nativeWindows();
        assert.equal(startup.length, 1, 'startup shows only the seeded cat');
        assert.equal(startup[0].filename, 'pet.html');
        assert.equal(startup[0].visible, true);
        assert.equal(startup[0].focused, false);
        assert.equal(startup[0].focusable, false);
        assert.equal(startup[0].bounds.width, 90);
        assert.equal(startup[0].bounds.height, 80);
        assert.equal((await state()).pet.sleeping, true);
        assert.ok((await state()).pet.energy < 1, 'the zero-energy seed gains only a little resting energy before play');
        await petPage.screenshot({ path: path.join(artifacts, 'cat-startup-30.png'), omitBackground: true });
        await noSurpriseSettings('settings never created');
        await checkMenus();
        await noSurpriseSettings('settings remain hidden');
        await checkStanding();
        assert.equal((await state()).pet.sleeping, true);
        await teaserRound();
        await teaserInputCleanup();
        await checkToyScales();
        for (const mode of ['pounce', 'bubbles']) await quickRound(mode);
        assert.deepEqual(pageErrors, []);
        assert.equal((await state()).pet.settings.species, 'cat');
        const missingClips = ['teaser-watch', 'teaser-ready', 'teaser-jump'].filter((name) => {
            const clip = catProfile.animations?.[name];
            return !clip || clip.frames < 2 || !clip.files?.length
                || !clip.files.every((file) => fs.existsSync(path.join(root, 'assets/cat', file)));
        });
        if (missingClips.length) console.log(`Media pending (${missingClips.join(', ')}): mechanics tested using existing fallback footage; this run does not certify three authentic captured stages.`);
        console.log(`✓ Cat-only Electron mechanics QA passed. Screenshots: ${artifacts}`);
    } catch (error) {
        if (application) {
            console.error('Cat-only window diagnostics:', await nativeWindows().catch(() => []));
            console.error('Cat game stop diagnostics:', await application.evaluate(() => globalThis.__catQAStops).catch(() => []));
            console.error('Cat-only snapshot:', petPage ? await state().catch(() => null) : null);
            for (const page of application.windows()) {
                const filename = page.url().split('/').pop().replace(/[^a-z0-9.-]/gi, '_');
                await page.screenshot({ path: path.join(artifacts, `cat-failure-${filename}.png`), timeout: 2000 }).catch(() => {});
            }
        }
        throw error;
    } finally {
        if (application) {
            await application.evaluate(({ app }) => { setTimeout(() => app.quit(), 50); }).catch(() => {});
            await application.close().catch(() => {});
        }
        if (userData) fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
