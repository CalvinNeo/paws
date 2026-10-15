const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const { PlaySession, TOY_SIZE, toyHitTest, toySizeForPet } = require('../src/play.cjs');
const { homeBounds, petSize } = require('../src/geometry.cjs');

const AREA = { x: -1600, y: -900, width: 1600, height: 900 };
const SIZES = [[20, 24], [30, 29], [50, 48], [75, 72], [100, 96], [120, 115], [150, 144]];

test('cat toys follow pet bounds with a usable minimum while all dog toys retain their size', () => {
    for (const [percentage, expected] of SIZES) {
        const bounds = homeBounds(percentage, AREA);
        assert.equal(toySizeForPet('cat', bounds), expected);
        for (const mode of ['pounce', 'bubbles']) {
            const session = new PlaySession(mode, bounds, AREA, 'cat');
            assert.equal(session.toySize, expected);
            assert.equal(session.snapshot().toySize, expected);
            assert.equal(session.getToyBounds().width, expected);
            assert.equal(session.getToyBounds().height, expected);
        }
        for (const mode of ['fetch', 'ball', 'bubbles']) {
            const session = new PlaySession(mode, bounds, AREA);
            assert.equal(session.toySize, TOY_SIZE);
            assert.equal(session.getToyBounds().width, 96);
        }
    }
    assert.equal(toySizeForPet('cat', { width: 300, height: 133 }), 48);
    assert.equal(toySizeForPet('cat', { width: 1, height: 1 }), 24);
    assert.equal(toySizeForPet('cat', { width: 3000, height: 2660 }), 144);
    assert.equal(toySizeForPet('cat', { width: NaN, height: 266 }), 96);
});

test('scaled circular hit areas match their SVG radii and reject transparent padding', () => {
    for (const [, size] of SIZES) {
        for (const kind of ['yarn', 'bubble']) {
            const radius = size * (kind === 'bubble' ? .32 : .28);
            const center = size / 2;
            assert.equal(toyHitTest(kind, { x: center, y: center }, size), true);
            for (const axis of ['x', 'y']) {
                for (const direction of [-1, 1]) {
                    assert.equal(toyHitTest(kind, { x: center, y: center, [axis]: center + direction * (radius - .1) }, size), true);
                    assert.equal(toyHitTest(kind, { x: center, y: center, [axis]: center + direction * (radius + .1) }, size), false);
                }
            }
            for (const point of [{ x: 1, y: 1 }, { x: size - 1, y: size - 1 }, { x: -1, y: center }, { x: center, y: size + 1 }]) {
                assert.equal(toyHitTest(kind, point, size), false);
            }
        }
    }
    for (const size of [0, -24, NaN, Infinity]) assert.equal(toyHitTest('yarn', { x: 12, y: 12 }, size), false);
    assert.equal(toyHitTest('yarn', null, 24), false);
});

test('scaled toy windows remain centered and within negative-origin displays while dragging and bouncing', () => {
    for (const [percentage] of SIZES) {
        const session = new PlaySession('pounce', homeBounds(percentage, AREA), AREA, 'cat');
        const checkBounds = () => {
            const bounds = session.getToyBounds();
            assert.ok(Math.abs(bounds.x + bounds.width / 2 - session.toy.x) <= .5);
            assert.ok(Math.abs(bounds.y + bounds.height / 2 - session.toy.y) <= .5);
            assert.ok(bounds.x >= AREA.x && bounds.y >= AREA.y);
            assert.ok(bounds.x + bounds.width <= AREA.x + AREA.width);
            assert.ok(bounds.y + bounds.height <= AREA.y + AREA.height);
        };
        checkBounds();
        for (const target of [{ x: -10000, y: -10000 }, { x: 10000, y: 10000 }]) {
            assert.equal(session.beginDrag(session.toy, 1000), true);
            session.moveDrag(target, 1100);
            checkBounds();
            session.endDrag(target, 1200, true);
            checkBounds();
        }
        session.velocity = { x: -1500, y: -1500 };
        for (let frame = 0; frame < 120; frame += 1) {
            session.bounceToy(1 / 60, 0);
            checkBounds();
        }
    }
});

test('a proportionate cat throw starts at every size while tiny nudges remain clicks', () => {
    for (const [percentage] of SIZES) {
        const bounds = { x: -900, y: -600, ...petSize(percentage) };
        const session = new PlaySession('pounce', bounds, AREA, 'cat');
        const origin = { ...session.toy };
        const short = { x: origin.x + session.toySize * .2, y: origin.y };
        session.beginDrag(origin, 1000);
        assert.equal(session.endDrag(short, 1150), false);
        assert.equal(session.phase, 'ready');
        assert.deepEqual(session.toy, origin);
        const thrown = { x: origin.x + session.toySize * .5, y: origin.y };
        session.beginDrag(origin, 2000);
        assert.equal(session.endDrag(thrown, 2150), true);
        assert.equal(session.throws, 1);
    }
    const dog = new PlaySession('ball', { x: -900, y: -600, ...petSize(20) }, AREA);
    dog.beginDrag(dog.toy, 1000);
    assert.equal(dog.endDrag({ x: dog.toy.x + 20, y: dog.toy.y }, 1150), false);
});

function desktopHarness(percentage, species = 'cat') {
    let cursor = { x: 0, y: 0 };
    let clock = 1000;
    let petBounds = homeBounds(percentage, AREA);
    const timers = new Set();
    const petWindow = {
        getBounds: () => ({ ...petBounds }),
        setPosition: (horizontal, vertical) => { petBounds = { ...petBounds, x: horizontal, y: vertical }; },
    };
    class ToyWindow extends EventEmitter {
        constructor(options) {
            super();
            this.options = options;
            this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
            this.visible = false;
            this.destroyed = false;
            this.messages = [];
            this.webContents = new EventEmitter();
            this.webContents.send = (channel, snapshot) => this.messages.push({ channel, snapshot });
        }
        getBounds() { return { ...this.bounds }; }
        setPosition(horizontal, vertical) { this.bounds.x = horizontal; this.bounds.y = vertical; }
        setIgnoreMouseEvents(ignore) { this.ignoresMouse = ignore; }
        setAlwaysOnTop() {}
        setVisibleOnAllWorkspaces() {}
        isVisible() { return this.visible; }
        isDestroyed() { return this.destroyed; }
        showInactive() { this.visible = true; }
        hide() { this.visible = false; }
        loadFile() { return Promise.resolve(); }
        destroy() { this.destroyed = true; this.emit('closed'); }
    }
    const filename = path.join(__dirname, '../src/desktop-play.cjs');
    const localRequire = createRequire(filename);
    const context = {
        require: (name) => name === 'electron' ? {
            BrowserWindow: ToyWindow, Menu: {},
            screen: { getDisplayMatching: () => ({ workArea: AREA }), getCursorScreenPoint: () => cursor },
        } : localRequire(name),
        module: { exports: {} }, __dirname: path.dirname(filename), process,
        performance: { now: () => clock },
        setInterval: (callback) => { timers.add(callback); return callback; },
        clearInterval: (callback) => timers.delete(callback),
    };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
    const desktop = new context.module.exports.DesktopPlay({
        getSpecies: () => species, getPetWindow: () => petWindow, webPreferences: () => ({}),
        canPlay() {}, onStart() {}, onStop() {}, onPose() {}, onComplete: () => true, secureWindow() {},
    });
    return {
        desktop, timers, setCursor: (point) => { cursor = point; },
        resizePet: (size) => { petBounds = homeBounds(size, AREA); },
        tick: () => { clock += 16; desktop.tick(); },
    };
}

test('native window creation, pointer checks, drags and movement use the same per-session dimensions', () => {
    for (const [percentage, expected] of SIZES) {
        const { desktop, timers, setCursor, tick } = desktopHarness(percentage);
        desktop.start('pounce');
        const window = desktop.window;
        try {
            assert.equal(window.getBounds().width, expected);
            assert.equal(window.getBounds().height, expected);
            assert.equal(window.options.focusable, false);
            assert.equal(window.options.fullscreenable, false);
            assert.equal(window.options.transparent, true);
            assert.equal(window.options.show, false);
            window.emit('ready-to-show');
            assert.equal(window.isVisible(), true);
            assert.equal(timers.size, 1);
            const bounds = window.getBounds();
            const center = { x: expected / 2, y: expected / 2 };
            const screenCenter = { x: bounds.x + center.x, y: bounds.y + center.y };
            desktop.updateHitTest(screenCenter);
            assert.equal(window.ignoresMouse, false);
            desktop.updateHitTest({ x: bounds.x + 1, y: bounds.y + 1 });
            assert.equal(window.ignoresMouse, true);
            desktop.drag('start', { x: 1, y: 1 });
            assert.equal(desktop.session.phase, 'ready');
            setCursor(screenCenter);
            desktop.drag('start', center);
            assert.equal(desktop.session.phase, 'held');
            assert.equal(window.ignoresMouse, false);
            setCursor({ x: screenCenter.x - 70, y: screenCenter.y - 40 });
            tick();
            assert.deepEqual(window.getBounds(), desktop.session.getToyBounds());
            assert.equal(window.messages.at(-1).snapshot.toySize, expected);
            desktop.drag('cancel');
            tick();
            assert.equal(desktop.session.phase, 'ready');
            assert.deepEqual(window.getBounds(), desktop.session.getToyBounds());
        } finally {
            desktop.stop(false);
        }
        assert.equal(window.isDestroyed(), true);
        assert.equal(timers.size, 0);
    }
});

test('starting another session recomputes toy size without changing the dog window contract', () => {
    for (const species of ['cat', 'dog']) {
        const { desktop, resizePet } = desktopHarness(30, species);
        desktop.start(species === 'cat' ? 'pounce' : 'ball');
        assert.equal(desktop.window.getBounds().width, species === 'cat' ? 29 : 96);
        const previous = desktop.window;
        resizePet(150);
        desktop.start('bubbles');
        assert.equal(previous.isDestroyed(), true);
        assert.equal(desktop.window.getBounds().width, species === 'cat' ? 144 : 96);
        assert.equal(desktop.snapshot().toySize, species === 'cat' ? 144 : 96);
        desktop.stop(false);
        assert.equal(desktop.active, false);
    }
});
