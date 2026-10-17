const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { createState, normalizeState, advanceState, performAction, updateSettings, resetPetData } = require('../src/model.cjs');
const { createProfiles } = require('../src/profiles.cjs');

const NOW = 1800000000000;
const TRICKS = { stand: 'standing', groom: 'grooming' };
const GROOM_CLIP = {
    frames: 64, fps: 15, durationMs: 4267, frameWidth: 768, frameHeight: 672, columns: 4, rows: 4, loop: false, mirror: false,
    files: ['motion/groom-0.webp', 'motion/groom-1.webp', 'motion/groom-2.webp', 'motion/groom-3.webp'],
};
const EAT_CLIP = {
    ...GROOM_CLIP, optional: true,
    files: Array.from({ length: 4 }, (_, index) => `motion/eat-${index}.webp`),
};

function catActionHarness({ animations = { groom: GROOM_CLIP, eat: EAT_CLIP }, missingFiles = [], catPose = 'sitting', sleeping = false, reducedMotion = false, fullness = 82,
    initialPet, nativePosition = { x: 240, y: 300 }, playing = false } = {}) {
    let clock = NOW;
    const handlers = new Map();
    const saves = [];
    const stops = [];
    const messages = [];
    const filename = path.join(__dirname, '../src/main.cjs');
    const localRequire = createRequire(filename);
    const missingPaths = new Set(missingFiles.map((file) => path.join(__dirname, '../assets/cat', file)));
    const initialCat = initialPet ?? { ...updateSettings(createState(NOW, 'cat'), { catPose, reducedMotion }), sleeping, fullness };
    const initialProfiles = createProfiles(NOW - 86400000);
    initialProfiles.activeSpecies = 'cat';
    initialProfiles.pets.cat = initialCat;
    Object.assign(initialProfiles.pets.dog, { name: 'Untouched sentinel', affection: 123, interactions: 45, position: { x: -500, y: 220 } });
    initialProfiles.pets.dog.settings.launchOnLogin = initialCat.settings.launchOnLogin;
    const testDesktopPlay = {
        active: playing,
        snapshot() { return this.active ? { mode: 'teaser', phase: 'pounce', completed: 0 } : null; },
        stop(notify) { stops.push(notify); this.active = false; },
    };
    const testPetWindow = {
        isDestroyed: () => false,
        getBounds: () => ({ ...nativePosition, width: 90, height: 80 }),
        setIgnoreMouseEvents() {},
        webContents: { mainFrame: {}, isDestroyed: () => false, send: (channel, payload) => messages.push({ channel, payload: structuredClone(payload) }) },
    };
    const testDashboard = { isDestroyed: () => false, webContents: { mainFrame: {}, isDestroyed: () => false, send() {} } };
    const electron = {
        app: { setName() {}, getPath: () => '/tmp/pawpal-cat-actions', getVersion: () => 'test', requestSingleInstanceLock: () => false, quit() {} },
        ipcMain: { handle: (channel, handler) => handlers.set(channel, handler), on: (channel, handler) => handlers.set(channel, handler) },
    };
    const context = vm.createContext({
        require: (name) => {
            if (name === 'electron') return electron;
            if (name === 'node:fs') return { existsSync: (file) => !missingPaths.has(file) };
            if (name === './store.cjs') return { saveState: (file, value) => saves.push({ file, profiles: structuredClone(value) }) };
            if (name === './desktop-play.cjs') return {};
            if (name === '../assets/cat/poses.mjs') return { default: {
                poses: { sitting: { file: 'sitting.png' }, standing: { file: 'standing.png', optional: true } },
                animations,
            } };
            return localRequire(name);
        },
        __dirname: path.dirname(filename), process: { platform: 'darwin', env: {} },
        Date: class extends Date { static now() { return clock; } },
        setTimeout() {}, clearTimeout() {}, initialCat, initialProfiles, testPetWindow, testDashboard, testDesktopPlay,
    });
    vm.runInContext(`${fs.readFileSync(filename, 'utf8')}
        state = initialCat;
        profiles = initialProfiles;
        petWindow = testPetWindow;
        dashboard = testDashboard;
        desktopPlay = testDesktopPlay;
        windowReady = true;
        runtime.behavior = restBehavior();
        registerIpc();
    `, context, { filename });
    const event = { sender: testPetWindow.webContents, senderFrame: testPetWindow.webContents.mainFrame };
    return {
        saves, stops, messages,
        snapshot: () => context.snapshot(),
        profiles: () => structuredClone(vm.runInContext('profiles', context)),
        playbackState: () => structuredClone(vm.runInContext('({ catActionPlayback, behaviorUntil })', context)),
        reset: (payload, now = clock, sender = 'dashboard') => {
            clock = now;
            const unknownContents = { mainFrame: {} };
            const senderEvent = sender === 'dashboard'
                ? { sender: testDashboard.webContents, senderFrame: testDashboard.webContents.mainFrame }
                : sender === 'subframe' ? { ...event, senderFrame: {} }
                    : sender === 'unknown' ? { sender: unknownContents, senderFrame: unknownContents.mainFrame } : event;
            return handlers.get('pawpal:reset')(senderEvent, payload);
        },
        menu: () => context.contextMenuTemplate(),
        action: (action, now = clock) => {
            clock = now;
            return handlers.get('pawpal:action')(event, action);
        },
        playback: (payload, now = clock, sender = 'pet') => {
            clock = now;
            const senderEvent = sender === 'dashboard'
                ? { sender: testDashboard.webContents, senderFrame: testDashboard.webContents.mainFrame }
                : sender === 'subframe' ? { ...event, senderFrame: {} } : event;
            handlers.get('pawpal:cat-action-playback')(senderEvent, payload);
        },
        hide: () => vm.runInContext('runtime.visible = false;', context),
        tick: (now) => { clock = now; context.tickMotion(); },
    };
}

function catRendererHarness({ loadMs = () => 0, failedFiles = [], animations = { groom: GROOM_CLIP, eat: EAT_CLIP }, systemReducedMotion = false, onPlayback = () => {}, onTick = () => {} } = {}) {
    let clock = 0;
    let nextFrame = 0;
    let Cat;
    const frames = new Map();
    const pendingImages = [];
    const events = [];
    const drawing = {
        clearRect() {}, save() {}, restore() {}, drawImage() {}, setTransform() {}, translate() {}, scale() {}, fillRect() {},
        getImageData: () => ({ data: new Uint8ClampedArray(4) }), createRadialGradient: () => ({ addColorStop() {} }),
    };
    const canvas = () => ({ getContext: () => drawing });
    class Element {
        constructor() { this.attributes = new Map(); this.dataset = {}; this.isConnected = true; }
        attachShadow() { this.shadowRoot = { querySelector: () => canvas() }; return this.shadowRoot; }
        setAttribute(name, value) { this.attributes.set(name, value); }
        hasAttribute(name) { return this.attributes.has(name); }
        removeAttribute(name) { this.attributes.delete(name); }
        toggleAttribute(name, value) { if (value) this.setAttribute(name, ''); else this.removeAttribute(name); }
        dispatchEvent(event) {
            if (event.type !== 'cat-action-playback') return;
            assert.equal(event.bubbles, true);
            assert.equal(event.composed, true);
            const payload = structuredClone(event.detail);
            events.push({ ...payload, at: clock });
            onPlayback(payload, clock);
        }
    }
    class TestImage {
        set src(value) {
            if (!value) return;
            const file = value.split('/assets/cat/')[1];
            pendingImages.push({ image: this, file, at: clock + loadMs(file) });
        }
    }
    const filename = path.join(__dirname, '../src/renderer/cat.js');
    const context = vm.createContext({
        ...require('../src/renderer/cat-animation.mjs'), ...require('../src/renderer/cat-standing.mjs'),
        profile: { width: 1280, height: 1120, poses: { sitting: { file: 'sitting.png', shadow: [640, 1036, 180, 24] }, loaf: { file: 'loaf.png' }, sleeping: { file: 'sleeping.png' } }, animations },
        HTMLElement: Element, Image: TestImage, URL, performance: { now: () => clock },
        document: { hidden: false, createElement: canvas }, matchMedia: () => ({ matches: systemReducedMotion }),
        customElements: { define: (_name, value) => { Cat = value; } },
        CustomEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
        requestAnimationFrame: (callback) => { frames.set(++nextFrame, callback); return nextFrame; },
        cancelAnimationFrame: (identifier) => frames.delete(identifier),
    });
    vm.runInContext(fs.readFileSync(filename, 'utf8').replace(/^import .*;\n/gm, '')
        .replaceAll('import.meta.url', JSON.stringify(pathToFileURL(filename).href)), context, { filename });
    const cat = new Cat();
    cat.inView = true;
    return {
        cat, events,
        update: (snapshot) => cat.update(snapshot),
        pendingFrames: () => frames.size,
        advanceTo: async (target) => {
            while (clock < target) {
                clock = Math.min(target, clock + 10);
                for (let index = pendingImages.length - 1; index >= 0; index -= 1) {
                    if (pendingImages[index].at > clock) continue;
                    const { image, file } = pendingImages.splice(index, 1)[0];
                    if (failedFiles.includes(file)) image.onerror?.();
                    else image.onload?.();
                }
                await Promise.resolve();
                await Promise.resolve();
                const callbacks = [...frames.values()];
                frames.clear();
                callbacks.forEach((callback) => callback(clock));
                await Promise.resolve();
                await Promise.resolve();
                onTick(clock);
            }
        },
    };
}

for (const [action, behavior] of Object.entries(TRICKS)) {
    test(`an awake cat can ${action} without changing their chosen pose or receiving care rewards`, () => {
        for (const catPose of ['sitting', 'loaf', 'relaxed', 'standing']) {
            const cat = updateSettings(createState(NOW, 'cat'), { catPose });
            const before = structuredClone(cat);
            const result = performAction(cat, action, NOW);
            assert.equal(result.behavior, behavior);
            assert.equal(typeof result.message, 'string');
            assert.ok(result.message.length > 0);
            assert.deepEqual(result.state, before);
            assert.deepEqual(cat, before);
            assert.deepEqual(normalizeState(JSON.parse(JSON.stringify(result.state)), NOW), before);
        }
    });

    test(`${action} only applies normal elapsed care time, including at zero energy`, () => {
        const cat = { ...createState(NOW, 'cat'), energy: 0, affection: 12, interactions: 7 };
        const later = NOW + 60000;
        const result = performAction(cat, action, later);
        assert.equal(result.behavior, behavior);
        assert.deepEqual(result.state, advanceState(cat, later));
        assert.equal(result.state.affection, 12);
        assert.equal(result.state.interactions, 7);
        assert.deepEqual(result.state.playStats, cat.playStats);
    });

    test(`a sleeping cat must wake before ${action} and a rejected action leaves state intact`, () => {
        const cat = { ...createState(NOW, 'cat'), sleeping: true };
        const before = structuredClone(cat);
        assert.throws(() => performAction(cat, action, NOW), { message: 'Wake up first.' });
        assert.deepEqual(cat, before);
        const awake = performAction(cat, 'wake', NOW).state;
        assert.equal(performAction(awake, action, NOW).behavior, behavior);
    });

    test(`repeating ${action} preserves every chosen pose without care rewards`, () => {
        for (const catPose of ['sitting', 'loaf', 'relaxed', 'standing']) {
            const cat = updateSettings(createState(NOW, 'cat'), { catPose });
            let current = cat;
            for (const elapsed of [0, 0, 500, 1000, 60000]) {
                const result = performAction(current, action, NOW + elapsed);
                assert.equal(result.behavior, behavior);
                assert.deepEqual(result.state, advanceState(current, NOW + elapsed));
                assert.deepEqual(result.state.settings, cat.settings);
                assert.equal(result.state.affection, cat.affection);
                assert.equal(result.state.interactions, cat.interactions);
                assert.deepEqual(result.state.activity, cat.activity);
                assert.deepEqual(result.state.playStats, cat.playStats);
                current = result.state;
            }
        }
    });
}

test('the standing pose survives settings updates and save normalization', () => {
    const cat = createState(NOW, 'cat');
    const standing = updateSettings(cat, { catPose: 'standing' });
    assert.equal(cat.settings.catPose, 'sitting');
    assert.equal(standing.settings.catPose, 'standing');
    assert.deepEqual(normalizeState(JSON.parse(JSON.stringify(standing)), NOW), standing);
    assert.equal(updateSettings(standing, { catPose: 'loaf' }).settings.catPose, 'loaf');
    assert.throws(() => updateSettings(cat, { catPose: 'unknown' }), /Invalid preference/);
});

test('cat tricks accept registered actions only, excluding inherited object properties', () => {
    const cat = createState(NOW, 'cat');
    for (const action of ['unknown', '__proto__', 'constructor', 'toString']) {
        assert.throws(() => performAction(cat, action, NOW), /not available/);
    }
});

test('cat trick IPC replays from the start and returns to every chosen pose without rewards', () => {
    for (const [action, behavior] of Object.entries(TRICKS)) {
        const duration = action === 'groom' ? 4567 : 4200;
        for (const catPose of ['sitting', 'loaf', 'relaxed', 'standing']) {
            const harness = catActionHarness({ catPose });
            const before = harness.snapshot().pet;
            const menuItem = harness.menu().find((item) => item.id === `cat-${action}`);
            assert.equal(menuItem.enabled, true);
            if (action === 'groom') assert.equal(menuItem.label, 'Groom');
            const first = harness.action(action);
            assert.equal(first.ok, true);
            assert.equal(first.data.runtime.behavior, behavior);
            assert.equal(first.data.runtime.catActionStartedAt, NOW);
            assert.deepEqual(first.data.pet, before);
            const repeated = harness.action(action, NOW + 500);
            assert.equal(repeated.ok, true);
            assert.equal(repeated.data.runtime.catActionStartedAt, NOW + 500);
            assert.deepEqual(repeated.data.pet, advanceState(before, NOW + 500));
            if (action === 'groom') harness.playback({ startedAt: NOW + 500, phase: 'playing', elapsedMs: 0 });
            harness.tick(NOW + 500 + duration - 1);
            assert.equal(harness.snapshot().runtime.behavior, behavior);
            harness.tick(NOW + 500 + duration);
            const settled = harness.snapshot();
            assert.equal(settled.runtime.behavior, 'idle');
            assert.deepEqual(settled.pet.settings, before.settings);
            assert.equal(settled.pet.affection, before.affection);
            assert.equal(settled.pet.interactions, before.interactions);
            assert.deepEqual(settled.pet.activity, before.activity);
            assert.deepEqual(settled.pet.playStats, before.playStats);
        }
    }
});

test('sleeping disables each cat trick menu item and rejects its IPC without state changes', () => {
    for (const action of Object.keys(TRICKS)) {
        const harness = catActionHarness({ catPose: 'relaxed', sleeping: true });
        const before = harness.snapshot();
        assert.equal(harness.menu().find((item) => item.id === `cat-${action}`).enabled, false);
        const result = harness.action(action);
        assert.equal(result.ok, false);
        assert.equal(result.error, 'Wake up first.');
        assert.deepEqual(harness.snapshot(), before);
        assert.equal(harness.action('wake').ok, true);
        assert.equal(harness.action(action, NOW + 500).ok, true);
    }
});

test('missing grooming metadata or any atlas disables grooming without disabling the cat', () => {
    const cases = [
        { animations: null },
        { animations: {} },
        { animations: { groom: { ...GROOM_CLIP, files: [] } } },
        { animations: { groom: { ...GROOM_CLIP, files: undefined } } },
        { animations: { groom: { ...GROOM_CLIP, files: [null] } } },
        { animations: { groom: { ...GROOM_CLIP, frames: 0 } } },
        { animations: { groom: { ...GROOM_CLIP, fps: 0 } } },
        ...GROOM_CLIP.files.map((file) => ({ missingFiles: [file] })),
    ];
    for (const options of cases) {
        const harness = catActionHarness(options);
        const before = harness.snapshot();
        assert.equal(before.catAvailable, true);
        assert.equal(before.groomingAvailable, false);
        assert.equal(harness.menu().find((item) => item.id === 'cat-groom').enabled, false);
        assert.equal(harness.menu().find((item) => item.id === 'cat-stand').enabled, true);
        const result = harness.action('groom');
        assert.equal(result.ok, false);
        assert.equal(result.error, 'The grooming animation is not installed.');
        assert.deepEqual(harness.snapshot(), before);
        assert.equal(harness.action('stand').ok, true);
    }
    assert.equal(catActionHarness().snapshot().groomingAvailable, true);
});

test('grooming timing follows clip frame rate rather than a fixed action duration', () => {
    const harness = catActionHarness({ animations: { groom: { ...GROOM_CLIP, frames: 30, fps: 24 } } });
    assert.equal(harness.action('groom').ok, true);
    harness.playback({ startedAt: NOW, phase: 'playing', elapsedMs: 0 });
    harness.tick(NOW + 1549);
    assert.equal(harness.snapshot().runtime.behavior, 'grooming');
    harness.tick(NOW + 1550);
    assert.equal(harness.snapshot().runtime.behavior, 'idle');
});

test('grooming waits for atlas loads and uses the remaining playback duration after each load', () => {
    const harness = catActionHarness();
    harness.action('groom');
    const signal = (phase, elapsedMs, now) => harness.playback({ startedAt: NOW, phase, elapsedMs }, NOW + now);
    signal('loading', 0, 0);
    signal('playing', 0, 600);
    signal('loading', 1400, 2000);
    signal('playing', 1400, 4000);
    signal('playing', 1000, 4500);
    signal('playing', 1400, 5000);
    signal('playing', 4200, 6800);
    harness.tick(NOW + 7166);
    assert.equal(harness.snapshot().runtime.behavior, 'grooming');
    harness.tick(NOW + 7167);
    assert.equal(harness.snapshot().runtime.behavior, 'idle');
});

test('grooming signals reject dashboard, subframe, stale replay and malformed messages', () => {
    const harness = catActionHarness();
    harness.action('groom');
    harness.action('groom', NOW + 1000);
    const active = { startedAt: NOW + 1000, phase: 'playing', elapsedMs: 0 };
    harness.playback(active);
    harness.playback({ ...active, phase: 'failed', startedAt: NOW }, NOW + 1100);
    for (const sender of ['dashboard', 'subframe']) {
        harness.playback({ ...active, phase: 'failed' }, NOW + 1200, sender);
        harness.playback({ ...active, phase: 'loading' }, NOW + 1300, sender);
    }
    for (const payload of [null, {}, { ...active, phase: 'unknown' }, { ...active, startedAt: String(active.startedAt) },
        ...[NaN, Infinity, -1, 999999, '0'].map((elapsedMs) => ({ ...active, phase: 'failed', elapsedMs }))]) {
        harness.playback(payload, NOW + 1400);
    }
    harness.tick(NOW + 5566);
    assert.equal(harness.snapshot().runtime.behavior, 'grooming');
    harness.tick(NOW + 5567);
    assert.equal(harness.snapshot().runtime.behavior, 'idle');
    harness.playback({ ...active, phase: 'loading' }, NOW + 5600);
    assert.equal(harness.snapshot().runtime.behavior, 'idle');
});

test('cancelled grooming ignores late playback and failure signals', () => {
    for (const action of ['sleep', 'stand', 'pet']) {
        const harness = catActionHarness();
        harness.action('groom');
        const cancelled = harness.action(action, NOW + 500).data;
        for (const phase of ['loading', 'playing', 'static', 'failed']) {
            harness.playback({ startedAt: NOW, phase, elapsedMs: 0 }, NOW + 600);
            assert.deepEqual(harness.snapshot().runtime, cancelled.runtime);
        }
    }
});

test('grooming loading watchdog recovers without renderer signals or while the pet is hidden', () => {
    for (const hidden of [false, true]) {
        const harness = catActionHarness();
        harness.action('groom');
        if (hidden) harness.hide();
        harness.tick(NOW + 9999);
        assert.equal(harness.snapshot().runtime.behavior, 'grooming');
        harness.tick(NOW + 10000);
        assert.equal(harness.snapshot().runtime.behavior, 'idle');
        harness.playback({ startedAt: NOW, phase: 'playing', elapsedMs: 0 }, NOW + 10001);
        assert.equal(harness.snapshot().runtime.behavior, 'idle');
    }
    const harness = catActionHarness();
    harness.action('groom');
    harness.playback({ startedAt: NOW, phase: 'loading', elapsedMs: 0 });
    harness.playback({ startedAt: NOW, phase: 'loading', elapsedMs: 0 }, NOW + 9000);
    harness.tick(NOW + 10000);
    assert.equal(harness.snapshot().runtime.behavior, 'idle');
});

test('repeated page loads cannot exceed the total grooming loading allowance', () => {
    const harness = catActionHarness();
    harness.action('groom');
    harness.playback({ startedAt: NOW, phase: 'playing', elapsedMs: 0 }, NOW + 9000);
    harness.playback({ startedAt: NOW, phase: 'loading', elapsedMs: 500 }, NOW + 9500);
    harness.playback({ startedAt: NOW, phase: 'playing', elapsedMs: 500 }, NOW + 14000);
    harness.tick(NOW + 14566);
    assert.equal(harness.snapshot().runtime.behavior, 'grooming');
    harness.tick(NOW + 14567);
    assert.equal(harness.snapshot().runtime.behavior, 'idle');
});

test('reduced motion keeps the normal grooming duration despite loading or frozen frames', () => {
    for (const reducedMotion of [false, true]) {
        const harness = catActionHarness({ reducedMotion });
        harness.action('groom');
        harness.playback({ startedAt: NOW, phase: 'static', elapsedMs: 0 }, NOW + 100);
        harness.playback({ startedAt: NOW, phase: reducedMotion ? 'loading' : 'static', elapsedMs: 0 }, NOW + 3000);
        harness.tick(NOW + 4566);
        assert.equal(harness.snapshot().runtime.behavior, 'grooming');
        harness.tick(NOW + 4567);
        assert.equal(harness.snapshot().runtime.behavior, 'idle');
    }
});

test('the renderer completes all four grooming pages with slow loads before the main action expires', async () => {
    const harness = catActionHarness();
    harness.action('groom');
    const renderer = catRendererHarness({
        loadMs: (file) => file.includes('groom') ? 600 : 0,
        onPlayback: (payload, clock) => harness.playback(payload, NOW + clock),
        onTick: (clock) => harness.tick(NOW + clock),
    });
    renderer.update(harness.snapshot());
    await renderer.advanceTo(4567);
    assert.equal(harness.snapshot().runtime.behavior, 'grooming');
    await renderer.advanceTo(6500);
    assert.equal(renderer.cat.dataset.frame, '63');
    assert.equal(renderer.cat.source.file, 'motion/groom-3.webp');
    assert.equal(renderer.events.filter((event) => event.phase === 'loading').length, 4);
    assert.equal(harness.snapshot().runtime.behavior, 'idle');
    assert.equal(renderer.pendingFrames(), 0);
});

test('the renderer reports reduced motion before a slow atlas finishes loading', async () => {
    for (const systemReducedMotion of [false, true]) {
        const harness = catActionHarness({ reducedMotion: !systemReducedMotion });
        harness.action('groom');
        const renderer = catRendererHarness({
            systemReducedMotion, loadMs: () => 6000,
            onPlayback: (payload, clock) => harness.playback(payload, NOW + clock),
            onTick: (clock) => harness.tick(NOW + clock),
        });
        renderer.update(harness.snapshot());
        assert.equal(renderer.events[0].phase, 'static');
        await renderer.advanceTo(4567);
        assert.equal(harness.snapshot().runtime.behavior, 'idle');
        assert.equal(renderer.pendingFrames(), 0);
    }
});

test('missing or failed grooming clips recover without removing the cat', async () => {
    for (const options of [{ animations: {} }, ...GROOM_CLIP.files.map((file) => ({ failedFiles: [file] }))]) {
        const harness = catActionHarness();
        harness.action('groom');
        const renderer = catRendererHarness({
            ...options,
            onPlayback: (payload, clock) => harness.playback(payload, NOW + clock),
            onTick: (clock) => harness.tick(NOW + clock),
        });
        renderer.update(harness.snapshot());
        await renderer.advanceTo(5000);
        assert.ok(renderer.events.some((event) => event.phase === 'failed'));
        assert.equal(harness.snapshot().runtime.behavior, 'idle');
        assert.equal(harness.snapshot().catAvailable, true);
        assert.equal(renderer.cat.hasAttribute('asset-error'), false);
        assert.equal(renderer.cat.dataset.pose, 'sitting');
    }
});

test('replay and cancellation discard signals from outstanding atlas requests', async () => {
    const harness = catActionHarness();
    harness.action('groom');
    const renderer = catRendererHarness({
        loadMs: () => 1000,
        onPlayback: (payload, clock) => harness.playback(payload, NOW + clock),
    });
    renderer.update(harness.snapshot());
    await renderer.advanceTo(500);
    harness.action('groom', NOW + 500);
    renderer.update(harness.snapshot());
    await renderer.advanceTo(1200);
    assert.ok(renderer.events.some((event) => event.phase === 'playing' && event.startedAt === NOW + 500));
    assert.ok(!renderer.events.some((event) => event.phase === 'playing' && event.startedAt === NOW));
    await renderer.advanceTo(2300);
    assert.equal(renderer.cat.loading, true);
    harness.action('sleep', NOW + 2300);
    renderer.update(harness.snapshot());
    const count = renderer.events.length;
    await renderer.advanceTo(4000);
    assert.equal(renderer.events.length, count);
    assert.equal(harness.snapshot().runtime.behavior, 'sleeping');
});

test('changing the resting pose during grooming preserves playback progress', async () => {
    const harness = catActionHarness();
    harness.action('groom');
    const renderer = catRendererHarness();
    renderer.update(harness.snapshot());
    await renderer.advanceTo(2000);
    const elapsedMs = renderer.cat.elapsedMs;
    const snapshot = harness.snapshot();
    snapshot.pet = updateSettings(snapshot.pet, { catPose: 'loaf' });
    renderer.update(snapshot);
    assert.equal(renderer.cat.elapsedMs, elapsedMs);
    await renderer.advanceTo(5000);
    assert.equal(renderer.cat.dataset.frame, '63');
    assert.equal(renderer.cat.dataset.pose, 'loaf');
    assert.ok(renderer.events.every((event, index) => index === 0 || event.elapsedMs >= renderer.events[index - 1].elapsedMs));
});

test('feeding grants the existing care reward once, independently of renderer playback', () => {
    const harness = catActionHarness({ fullness: 40, catPose: 'loaf' });
    const before = harness.snapshot().pet;
    const result = harness.action('feed');
    assert.equal(result.ok, true);
    assert.equal(result.data.runtime.behavior, 'eating');
    assert.equal(result.data.runtime.catActionStartedAt, NOW);
    assert.deepEqual(result.data.pet, performAction(before, 'feed', NOW).state);
    assert.equal(result.data.pet.fullness, 58);
    assert.equal(result.data.pet.energy, before.energy + 2);
    assert.equal(result.data.pet.affection, before.affection + 1);
    assert.equal(result.data.pet.interactions, before.interactions + 1);
    const rewarded = structuredClone(result.data.pet);
    for (const phase of ['loading', 'playing', 'playing', 'static', 'failed', 'playing']) {
        harness.playback({ startedAt: NOW, phase, elapsedMs: 0 }, NOW + 100);
        assert.deepEqual(harness.snapshot().pet, rewarded);
    }
    assert.equal(harness.snapshot().runtime.behavior, 'idle');
    assert.deepEqual(rewarded.playStats, before.playStats);
    assert.equal(rewarded.settings.catPose, 'loaf');
});

test('feeding keeps sleeping, fullness and action cooldown restrictions', () => {
    for (const [options, error] of [
        [{ sleeping: true }, 'Let your friend wake up before snack time.'],
        [{ fullness: 98 }, 'A happy, full tummy! Save a treat for later.'],
    ]) {
        const harness = catActionHarness(options);
        const before = harness.snapshot();
        assert.equal(harness.menu().find((item) => item.id === 'care-feed').enabled, false);
        assert.equal(harness.action('feed').error, error);
        assert.deepEqual(harness.snapshot(), before);
    }
    const harness = catActionHarness();
    assert.equal(harness.action('feed').ok, true);
    const before = harness.snapshot();
    assert.equal(harness.action('feed', NOW + 100).error, 'One little moment…');
    assert.equal(harness.action('feed', NOW + 500).error, 'A happy, full tummy! Save a treat for later.');
    assert.deepEqual(harness.snapshot(), before);
});

test('missing or malformed optional eating assets do not prevent normal feeding', () => {
    const cases = [
        { animations: null }, { animations: {} },
        ...[{ files: [] }, { files: [null] }, { frames: 0 }, { frames: 1000 }, { fps: 0 }, { columns: 0 }]
            .map((patch) => ({ animations: { eat: { ...EAT_CLIP, ...patch } } })),
        ...EAT_CLIP.files.map((file) => ({ missingFiles: [file] })),
    ];
    for (const options of cases) {
        const harness = catActionHarness({ ...options, catPose: 'loaf' });
        const before = harness.snapshot().pet;
        assert.equal(harness.snapshot().catAvailable, true);
        assert.equal(harness.menu().find((item) => item.id === 'care-feed').enabled, true);
        assert.equal(harness.action('feed').ok, true);
        const rewarded = harness.snapshot().pet;
        assert.deepEqual(rewarded, performAction(before, 'feed', NOW).state);
        harness.playback({ startedAt: NOW, phase: 'failed', elapsedMs: 0 }, NOW + 100);
        harness.tick(NOW + 4199);
        assert.equal(harness.snapshot().runtime.behavior, 'eating');
        harness.tick(NOW + 4200);
        assert.equal(harness.snapshot().runtime.behavior, 'idle');
        assert.deepEqual(harness.snapshot().pet, rewarded);
    }
});

test('eating duration follows actual metadata, including a partial final atlas', () => {
    for (const [frames, fps] of [[37, 12], [64, 15], [5, 24]]) {
        const clip = { ...EAT_CLIP, frames, fps, durationMs: 1 };
        const harness = catActionHarness({ animations: { eat: clip } });
        harness.action('feed');
        harness.playback({ startedAt: NOW, phase: 'playing', elapsedMs: 0 });
        const duration = Math.ceil(frames / fps * 1000) + 300;
        harness.tick(NOW + duration - 1);
        assert.equal(harness.snapshot().runtime.behavior, 'eating');
        harness.tick(NOW + duration);
        assert.equal(harness.snapshot().runtime.behavior, 'idle');
    }
});

test('eating replay rejects stale, untrusted and malformed signals without duplicating rewards', () => {
    const harness = catActionHarness({ fullness: 40 });
    harness.action('feed');
    const firstReward = harness.snapshot().pet;
    assert.equal(harness.action('feed', NOW + 1000).ok, true);
    const replay = harness.snapshot();
    assert.equal(replay.runtime.catActionStartedAt, NOW + 1000);
    assert.deepEqual(replay.pet, performAction(firstReward, 'feed', NOW + 1000).state);
    const active = { startedAt: NOW + 1000, phase: 'playing', elapsedMs: 0 };
    harness.playback(active);
    harness.playback({ ...active, phase: 'failed', startedAt: NOW }, NOW + 1100);
    for (const sender of ['dashboard', 'subframe']) {
        harness.playback({ ...active, phase: 'failed' }, NOW + 1200, sender);
        harness.playback({ ...active, phase: 'loading' }, NOW + 1300, sender);
    }
    for (const payload of [null, {}, { ...active, phase: 'unknown' }, { ...active, startedAt: String(active.startedAt) },
        ...[NaN, Infinity, -1, 999999, '0'].map((elapsedMs) => ({ ...active, phase: 'failed', elapsedMs }))]) {
        harness.playback(payload, NOW + 1400);
    }
    harness.tick(NOW + 5566);
    assert.equal(harness.snapshot().runtime.behavior, 'eating');
    harness.tick(NOW + 5567);
    assert.equal(harness.snapshot().runtime.behavior, 'idle');
    assert.deepEqual(harness.snapshot().pet, replay.pet);
});

test('cancelled eating ignores late signals across other care actions and grooming', () => {
    for (const action of ['sleep', 'stand', 'pet', 'groom']) {
        const harness = catActionHarness();
        harness.action('feed');
        const cancelled = harness.action(action, NOW + 500).data;
        for (const phase of ['loading', 'playing', 'static', 'failed']) {
            harness.playback({ startedAt: NOW, phase, elapsedMs: 0 }, NOW + 600);
            assert.deepEqual(harness.snapshot().runtime, cancelled.runtime);
            assert.deepEqual(harness.snapshot().pet, cancelled.pet);
        }
    }
});

test('eating watchdog expires while hidden, without signals, and under repeated loading', () => {
    for (const hidden of [false, true]) {
        const harness = catActionHarness();
        harness.action('feed');
        if (hidden) harness.hide();
        harness.tick(NOW + 9999);
        assert.equal(harness.snapshot().runtime.behavior, 'eating');
        harness.tick(NOW + 10000);
        assert.equal(harness.snapshot().runtime.behavior, 'idle');
        harness.playback({ startedAt: NOW, phase: 'playing', elapsedMs: 0 }, NOW + 10001);
        assert.equal(harness.snapshot().runtime.behavior, 'idle');
        assert.equal(harness.snapshot().pet.interactions, 1);
    }
    const harness = catActionHarness();
    harness.action('feed');
    harness.playback({ startedAt: NOW, phase: 'playing', elapsedMs: 0 }, NOW + 9000);
    harness.playback({ startedAt: NOW, phase: 'loading', elapsedMs: 500 }, NOW + 9500);
    harness.playback({ startedAt: NOW, phase: 'playing', elapsedMs: 500 }, NOW + 14000);
    harness.tick(NOW + 14566);
    assert.equal(harness.snapshot().runtime.behavior, 'eating');
    harness.tick(NOW + 14567);
    assert.equal(harness.snapshot().runtime.behavior, 'idle');
});

test('eating completes every atlas under slow loading and keeps the successful feed reward', async () => {
    const clip = { ...EAT_CLIP, frames: 53, fps: 12, durationMs: 1 };
    const animations = { eat: clip };
    const harness = catActionHarness({ animations, catPose: 'loaf' });
    harness.action('feed');
    const rewarded = harness.snapshot().pet;
    const renderer = catRendererHarness({
        animations, loadMs: (file) => file.includes('eat') ? 900 : 0,
        onPlayback: (payload, clock) => harness.playback(payload, NOW + clock),
        onTick: (clock) => harness.tick(NOW + clock),
    });
    renderer.update(harness.snapshot());
    await renderer.advanceTo(5000);
    assert.equal(harness.snapshot().runtime.behavior, 'eating');
    await renderer.advanceTo(8500);
    assert.equal(renderer.cat.dataset.frame, '52');
    assert.equal(renderer.cat.source.file, 'motion/eat-3.webp');
    assert.equal(renderer.events.filter((event) => event.phase === 'loading').length, 4);
    assert.equal(harness.snapshot().runtime.behavior, 'idle');
    assert.deepEqual(harness.snapshot().pet, rewarded);
    assert.equal(renderer.pendingFrames(), 0);
    renderer.update(harness.snapshot());
    await renderer.advanceTo(9000);
    assert.equal(renderer.cat.dataset.pose, 'loaf');
    assert.equal(renderer.cat.dataset.animation, 'static');
});

test('eating respects app and system reduced motion even before a slow atlas loads', async () => {
    for (const systemReducedMotion of [false, true]) {
        const harness = catActionHarness({ reducedMotion: !systemReducedMotion });
        harness.action('feed');
        const renderer = catRendererHarness({
            systemReducedMotion, loadMs: () => 6000,
            onPlayback: (payload, clock) => harness.playback(payload, NOW + clock),
            onTick: (clock) => harness.tick(NOW + clock),
        });
        renderer.update(harness.snapshot());
        assert.equal(renderer.events[0].phase, 'static');
        await renderer.advanceTo(4566);
        assert.equal(harness.snapshot().runtime.behavior, 'eating');
        await renderer.advanceTo(4567);
        assert.equal(harness.snapshot().runtime.behavior, 'idle');
        assert.equal(renderer.pendingFrames(), 0);
        assert.equal(harness.snapshot().pet.interactions, 1);
        renderer.update(harness.snapshot());
        const count = renderer.events.length;
        await renderer.advanceTo(11000);
        assert.equal(renderer.events.length, count);
        assert.equal(renderer.cat.dataset.animation, 'static');
    }
});

test('missing or failed eating clips fall back to the selected still without undoing feeding', async () => {
    for (const options of [{ animations: {} }, ...EAT_CLIP.files.map((file) => ({ failedFiles: [file] }))]) {
        const harness = catActionHarness({ catPose: 'loaf' });
        harness.action('feed');
        const rewarded = harness.snapshot().pet;
        const renderer = catRendererHarness({
            ...options,
            onPlayback: (payload, clock) => harness.playback(payload, NOW + clock),
            onTick: (clock) => harness.tick(NOW + clock),
        });
        renderer.update(harness.snapshot());
        await renderer.advanceTo(5000);
        assert.ok(renderer.events.some((event) => event.phase === 'failed'));
        assert.equal(harness.snapshot().runtime.behavior, 'idle');
        assert.deepEqual(harness.snapshot().pet, rewarded);
        assert.equal(renderer.cat.hasAttribute('asset-error'), false);
        assert.equal(renderer.cat.dataset.pose, 'loaf');
        assert.equal(renderer.cat.dataset.animation, 'static');
    }
});

test('eating replay and cancellation discard outstanding atlas requests', async () => {
    const harness = catActionHarness({ fullness: 40 });
    harness.action('feed');
    const renderer = catRendererHarness({
        loadMs: () => 1000,
        onPlayback: (payload, clock) => harness.playback(payload, NOW + clock),
    });
    renderer.update(harness.snapshot());
    await renderer.advanceTo(500);
    harness.action('feed', NOW + 500);
    renderer.update(harness.snapshot());
    assert.equal(renderer.cat.elapsedMs, 0);
    await renderer.advanceTo(1200);
    assert.ok(renderer.events.some((event) => event.phase === 'playing' && event.startedAt === NOW + 500));
    assert.ok(!renderer.events.some((event) => event.phase === 'playing' && event.startedAt === NOW));
    await renderer.advanceTo(2300);
    assert.equal(renderer.cat.loading, true);
    harness.action('sleep', NOW + 2300);
    renderer.update(harness.snapshot());
    const count = renderer.events.length;
    await renderer.advanceTo(4000);
    assert.equal(renderer.events.length, count);
    assert.equal(harness.snapshot().runtime.behavior, 'sleeping');
    assert.equal(harness.snapshot().pet.interactions, 2);
});

test('changing the resting pose during eating preserves progress and restores the new choice', async () => {
    const harness = catActionHarness();
    harness.action('feed');
    const renderer = catRendererHarness();
    renderer.update(harness.snapshot());
    await renderer.advanceTo(2000);
    const elapsedMs = renderer.cat.elapsedMs;
    const snapshot = harness.snapshot();
    snapshot.pet = updateSettings(snapshot.pet, { catPose: 'loaf' });
    renderer.update(snapshot);
    assert.equal(renderer.cat.elapsedMs, elapsedMs);
    await renderer.advanceTo(5000);
    assert.equal(renderer.cat.dataset.frame, '63');
    assert.equal(renderer.cat.dataset.pose, 'loaf');
    renderer.update({ ...snapshot, runtime: { ...snapshot.runtime, behavior: 'idle' } });
    await renderer.advanceTo(5500);
    assert.equal(renderer.cat.dataset.pose, 'loaf');
    assert.equal(renderer.cat.dataset.animation, 'static');
});

function catResetFixture() {
    const cat = updateSettings(createState(NOW, 'cat'), {
        catPose: 'loaf', size: 55, alwaysOnTop: false, reducedMotion: true, launchOnLogin: true,
    });
    return {
        ...cat, name: '芝麻 QA', adoptedAt: NOW - 86400000, fullness: 100, happiness: 19, energy: 0,
        sleeping: true, affection: 141, interactions: 27, playStats: { pounce: 7, bubbles: 11, teaser: 4 },
        position: { x: -240, y: 180 }, activity: [{ type: 'feed', text: 'A previous cat snack.', at: NOW - 1000 }],
    };
}

function assertCatReset(pet, before, now, position = before.position) {
    assert.deepEqual([pet.fullness, pet.happiness, pet.energy], [82, 88, 76]);
    assert.equal(pet.sleeping, false);
    assert.equal(pet.affection, 0);
    assert.equal(pet.interactions, 0);
    assert.deepEqual(pet.playStats, { pounce: 0, bubbles: 0, teaser: 0 });
    assert.deepEqual(pet.activity, []);
    assert.equal(pet.updatedAt, now);
    assert.equal(pet.name, before.name);
    assert.equal(pet.adoptedAt, before.adoptedAt);
    assert.deepEqual(pet.settings, before.settings);
    assert.deepEqual(pet.position, position);
}

test('cat reset restores care and clears progress without mutating the original profile', () => {
    const cat = catResetFixture();
    const before = structuredClone(cat);
    cat.activity.forEach(Object.freeze);
    Object.values(cat).filter((value) => value && typeof value === 'object').forEach(Object.freeze);
    Object.freeze(cat);
    const result = resetPetData(cat, NOW + 60000);
    assertCatReset(result, before, NOW + 60000);
    assert.notEqual(result, cat);
    assert.deepEqual(cat, before);
    assert.deepEqual(normalizeState(JSON.parse(JSON.stringify(result)), NOW + 60000), result);
});

test('repeated cat resets keep identity and preferences, including an unset position', () => {
    const cat = { ...catResetFixture(), position: null };
    const first = resetPetData(cat, NOW);
    assertCatReset(first, cat, NOW);
    assert.deepEqual(resetPetData(first, NOW), first);
    const later = resetPetData(first, NOW + 86400000);
    assertCatReset(later, cat, NOW + 86400000);
    assertCatReset(first, cat, NOW);
});

test('reset lets a full sleeping cat feed again without an extra wake or care reward', () => {
    const sleeping = catResetFixture();
    assert.throws(() => performAction(sleeping, 'feed', NOW), /wake up/i);
    assert.throws(() => performAction({ ...sleeping, sleeping: false }, 'feed', NOW), /full tummy/i);
    const reset = resetPetData(sleeping, NOW);
    const fed = performAction(reset, 'feed', NOW);
    assert.equal(fed.behavior, 'eating');
    assert.equal(fed.state.fullness, 100);
    assert.equal(fed.state.energy, 78);
    assert.equal(fed.state.affection, 1);
    assert.equal(fed.state.interactions, 1);
    assert.deepEqual(fed.state.activity.map((entry) => entry.type), ['feed']);
    assert.deepEqual(fed.state.playStats, reset.playStats);
    assertCatReset(reset, sleeping, NOW);
});

test('cat reset preload forwards the selected species and the IPC result', async () => {
    let bridge;
    const calls = [];
    const response = { ok: false, error: 'Your companion changed.' };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/preload.cjs'), 'utf8'), {
        require: (name) => {
            assert.equal(name, 'electron');
            return {
                contextBridge: { exposeInMainWorld: (key, value) => { assert.equal(key, 'pawpal'); bridge = value; } },
                ipcRenderer: { invoke: (...args) => { calls.push(args); return Promise.resolve(response); } },
            };
        },
    });
    assert.equal(await bridge.reset('cat'), response);
    assert.deepEqual(calls, [['pawpal:reset', 'cat']]);
});

test('trusted cat reset immediately saves the native position and leaves the other saved profile untouched', () => {
    for (const sender of ['dashboard', 'pet']) {
        const initialPet = catResetFixture();
        const nativePosition = { x: -620, y: 250 };
        const harness = catActionHarness({ initialPet, nativePosition });
        const sentinel = harness.profiles().pets.dog;
        const result = harness.reset('cat', NOW + 60000, sender);
        assert.equal(result.ok, true, result.error);
        assertCatReset(result.data.pet, initialPet, NOW + 60000, nativePosition);
        assert.equal(result.data.runtime.behavior, 'idle');
        assert.equal(result.data.runtime.catActionStartedAt, 0);
        assert.equal(result.data.runtime.warning, null);
        assert.deepEqual(harness.playbackState(), { catActionPlayback: null, behaviorUntil: 0 });
        assert.equal(harness.saves.length, 1, 'the IPC must finish with a save, without running a debounce timer');
        const saved = harness.saves[0];
        assert.equal(path.basename(saved.file), 'companion.json');
        assert.equal(saved.profiles.activeSpecies, 'cat');
        assert.deepEqual(saved.profiles.pets.cat, result.data.pet);
        assert.deepEqual(saved.profiles.pets.dog, sentinel);
        assert.deepEqual(harness.profiles().pets.dog, sentinel);
        assert.ok(harness.messages.some(({ channel, payload }) => channel === 'pawpal:state'
            && payload.message?.includes(initialPet.name) && payload.pet.interactions === 0));
    }
});

test('repeating cat reset saves consistently and clears the previous action cooldown for feeding', () => {
    const harness = catActionHarness({ fullness: 82 });
    assert.equal(harness.action('feed').ok, true);
    const before = harness.snapshot().pet;
    const first = harness.reset('cat', NOW + 10);
    assert.equal(first.ok, true, first.error);
    const repeated = harness.reset('cat', NOW + 10);
    assert.equal(repeated.ok, true, repeated.error);
    assert.deepEqual(repeated.data.pet, first.data.pet);
    assert.equal(harness.saves.length, 2);
    const fed = harness.action('feed', NOW + 10);
    assert.equal(fed.ok, true, fed.error);
    assert.equal(fed.data.pet.interactions, 1);
    assert.equal(fed.data.pet.affection, 1);
    assert.deepEqual(fed.data.pet.activity.map((entry) => entry.type), ['feed']);
    const later = harness.reset('cat', NOW + 60000);
    assert.equal(later.ok, true, later.error);
    assertCatReset(later.data.pet, before, NOW + 60000, { x: 240, y: 300 });
    assert.equal(harness.saves.length, 3);
});

test('reset stops an active cat game without awarding the unfinished round', () => {
    const initialPet = { ...catResetFixture(), sleeping: false };
    const harness = catActionHarness({ initialPet, playing: true });
    assert.equal(harness.snapshot().game.mode, 'teaser');
    const result = harness.reset('cat', NOW + 100);
    assert.equal(result.ok, true, result.error);
    assert.deepEqual(harness.stops, [false]);
    assert.equal(result.data.game, null);
    assert.equal(result.data.runtime.behavior, 'idle');
    assert.equal(result.data.runtime.carrying, null);
    assertCatReset(result.data.pet, initialPet, NOW + 100, { x: 240, y: 300 });
    assert.deepEqual(harness.saves[0].profiles.pets.cat, result.data.pet);
});

test('cat reset rejects invalid and stale species before stopping a game or saving', () => {
    const harness = catActionHarness({ initialPet: catResetFixture(), playing: true });
    const before = structuredClone(harness.snapshot());
    const profiles = harness.profiles();
    for (const payload of [undefined, null, '', 'dog', 'Cat', 'cat ', 'rabbit', 0, true, {}, ['cat'], { species: 'cat' }, new String('cat')]) {
        const result = harness.reset(payload, NOW + 1000);
        assert.equal(result.ok, false, `reject reset payload ${JSON.stringify(payload)}`);
        assert.ok(result.error);
        assert.deepEqual(structuredClone(harness.snapshot()), before);
        assert.deepEqual(harness.profiles(), profiles);
    }
    assert.deepEqual(harness.stops, []);
    assert.deepEqual(harness.saves, []);
    assert.deepEqual(harness.messages, []);
});

test('cat reset rejects unknown windows and subframes without cancelling the active animation', () => {
    const harness = catActionHarness();
    assert.equal(harness.action('groom').ok, true);
    const before = structuredClone(harness.snapshot());
    const playback = harness.playbackState();
    const stopCount = harness.stops.length;
    const messageCount = harness.messages.length;
    for (const sender of ['unknown', 'subframe']) {
        const result = harness.reset('cat', NOW + 500, sender);
        assert.equal(result.ok, false);
        assert.match(result.error, /untrusted/i);
        assert.deepEqual(structuredClone(harness.snapshot()), before);
        assert.deepEqual(harness.playbackState(), playback);
    }
    assert.equal(harness.stops.length, stopCount);
    assert.equal(harness.messages.length, messageCount);
    assert.deepEqual(harness.saves, []);
});

test('cat reset invalidates standing, grooming and eating, including delayed playback signals', () => {
    for (const action of ['stand', 'groom', 'feed']) {
        const harness = catActionHarness({ catPose: 'loaf' });
        assert.equal(harness.action(action).ok, true);
        const startedAt = harness.snapshot().runtime.catActionStartedAt;
        assert.equal(startedAt, NOW);
        const result = harness.reset('cat', NOW + 500);
        assert.equal(result.ok, true, result.error);
        const reset = structuredClone(result.data);
        for (const phase of ['loading', 'playing', 'static', 'failed']) {
            harness.playback({ startedAt, phase, elapsedMs: 0 }, NOW + 600);
            harness.playback({ startedAt: 0, phase, elapsedMs: 0 }, NOW + 600);
            assert.deepEqual(structuredClone(harness.snapshot()), reset);
            assert.deepEqual(harness.playbackState(), { catActionPlayback: null, behaviorUntil: 0 });
        }
        harness.tick(NOW + 20000);
        assert.deepEqual(structuredClone(harness.snapshot()), reset);
        const feed = harness.action('feed', NOW + 21000);
        assert.equal(feed.ok, true, feed.error);
        harness.playback({ startedAt, phase: 'failed', elapsedMs: 0 }, NOW + 21100);
        assert.equal(harness.snapshot().runtime.behavior, 'eating');
        assert.equal(harness.snapshot().pet.interactions, 1);
    }
});

test('cat reset discards pending renderer atlas loads and returns to the saved resting pose', async () => {
    for (const action of ['groom', 'feed']) {
        const harness = catActionHarness({ catPose: 'loaf' });
        harness.action(action);
        const renderer = catRendererHarness({
            loadMs: () => 1500,
            onPlayback: (payload, clock) => harness.playback(payload, NOW + clock),
            onTick: (clock) => harness.tick(NOW + clock),
        });
        renderer.update(harness.snapshot());
        await renderer.advanceTo(500);
        assert.equal(renderer.cat.loading, true);
        const result = harness.reset('cat', NOW + 500);
        assert.equal(result.ok, true, result.error);
        renderer.update(result.data);
        const count = renderer.events.length;
        await renderer.advanceTo(6000);
        assert.equal(renderer.events.length, count, 'old image promises cannot report playback after reset');
        assert.equal(renderer.cat.dataset.pose, 'loaf');
        assert.equal(renderer.cat.dataset.animation, 'static');
        assert.equal(harness.snapshot().runtime.behavior, 'idle');
        assert.equal(harness.snapshot().runtime.catActionStartedAt, 0);
        assert.deepEqual(harness.snapshot().pet, result.data.pet);
    }
});
