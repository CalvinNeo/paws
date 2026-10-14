const path = require('node:path');
const { BrowserWindow, Menu, screen } = require('electron');
const { PlaySession, TOY_SIZE, PLAY_MODES, toyHitTest } = require('./play.cjs');
const { clampBounds } = require('./geometry.cjs');

class DesktopPlay {
    constructor(options) {
        this.options = options;
        this.session = null;
        this.window = null;
        this.timer = null;
        this.ready = false;
        this.ignoringMouse = true;
        this.lastPose = '';
    }

    get active() {
        return Boolean(this.session);
    }

    snapshot() {
        return this.session?.snapshot() ?? null;
    }

    isSender(event) {
        return Boolean(this.window && !this.window.isDestroyed()
            && event.sender === this.window.webContents && event.senderFrame === event.sender.mainFrame);
    }

    start(mode) {
        if (!Object.hasOwn(PLAY_MODES, mode)) throw new Error('Choose one of the available pet games.');
        this.options.canPlay();
        this.stop(false);
        const petWindow = this.options.getPetWindow();
        const petBounds = petWindow.getBounds();
        const workArea = screen.getDisplayMatching(petBounds).workArea;
        this.session = new PlaySession(mode, clampBounds(petBounds, workArea), workArea);
        this.options.onStart();
        this.lastPose = '';
        this.ready = false;
        this.ignoringMouse = true;
        this.window = new BrowserWindow({
            x: Math.round(this.session.toy.x - TOY_SIZE / 2),
            y: Math.round(this.session.toy.y - TOY_SIZE / 2),
            width: TOY_SIZE,
            height: TOY_SIZE,
            show: false,
            title: 'Pawpal toy',
            frame: false,
            transparent: true,
            backgroundColor: '#00000000',
            hasShadow: false,
            resizable: false,
            minimizable: false,
            maximizable: false,
            fullscreenable: false,
            focusable: false,
            acceptFirstMouse: true,
            skipTaskbar: true,
            alwaysOnTop: true,
            webPreferences: { ...this.options.webPreferences(), backgroundThrottling: false },
        });
        const window = this.window;
        window.setIgnoreMouseEvents(true, { forward: true });
        window.setAlwaysOnTop(true, 'floating');
        if (process.platform === 'darwin') {
            window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
        }
        this.options.secureWindow(window, 'toy.html');
        window.once('ready-to-show', () => {
            if (this.window !== window) return;
            this.ready = true;
            this.lastTickAt = performance.now();
            this.publish(true);
            window.showInactive();
            this.timer = setInterval(() => this.tick(), 16);
        });
        window.on('closed', () => { if (this.window === window) this.stop(); });
        window.webContents.on('render-process-gone', () => this.stop());
        window.loadFile(path.join(__dirname, 'renderer', 'toy.html')).catch(() => {
            if (this.window === window) this.stop();
        });
        this.publish(true);
    }

    stop(notify = true) {
        if (!this.session && !this.window) return;
        clearInterval(this.timer);
        this.timer = null;
        const window = this.window;
        this.window = null;
        this.session = null;
        this.ready = false;
        if (window && !window.isDestroyed()) window.destroy();
        this.options.onStop(notify);
    }

    setPassthrough(ignore) {
        if (!this.window || this.window.isDestroyed() || this.ignoringMouse === ignore) return;
        this.ignoringMouse = ignore;
        this.window.setIgnoreMouseEvents(ignore, { forward: true });
    }

    pointer(inside) {
        if (!this.session || this.session.drag) return;
        this.setPassthrough(!inside || !this.session.snapshot().interactive);
    }

    updateHitTest(cursor) {
        if (!this.session || this.session.drag) return;
        const bounds = this.window.getBounds();
        const inside = toyHitTest(PLAY_MODES[this.session.mode].toy, { x: cursor.x - bounds.x, y: cursor.y - bounds.y });
        this.pointer(inside);
    }

    drag(phase, point) {
        if (!this.session || !this.ready) return;
        const cursor = screen.getCursorScreenPoint();
        const now = performance.now();
        if (phase === 'start') {
            const bounds = this.window.getBounds();
            if (!point || !toyHitTest(PLAY_MODES[this.session.mode].toy, point)) return;
            this.options.canPlay();
            if (this.session.beginDrag({ x: bounds.x + point.x, y: bounds.y + point.y }, now)) this.setPassthrough(false);
        } else if (phase === 'end' || phase === 'cancel') {
            this.session.endDrag(cursor, now, phase === 'cancel');
            this.setPassthrough(true);
        }
        this.publish(true);
    }

    menu() {
        if (!this.window) return;
        this.drag('cancel');
        Menu.buildFromTemplate([
            { label: PLAY_MODES[this.session.mode].label, enabled: false },
            { label: 'Put toys away', click: () => this.stop() },
            { label: 'Open Pawpal', click: () => { this.stop(false); this.options.openHome(); } },
        ]).popup({ window: this.window, callback: () => this.setPassthrough(true) });
    }

    publish(force = false) {
        if (!this.session) return;
        const pose = this.session.snapshot();
        const signature = JSON.stringify(pose);
        if (!force && signature === this.lastPose) return;
        this.lastPose = signature;
        this.options.onPose(pose);
        if (this.ready) this.window.webContents.send('pawpal:toy-state', pose);
    }

    tick() {
        if (!this.session || !this.ready) return;
        const now = performance.now();
        const cursor = screen.getCursorScreenPoint();
        const elapsed = (now - this.lastTickAt) / 1000;
        this.lastTickAt = now;
        if (this.session.drag) this.session.moveDrag(cursor, now);
        const completed = this.session.step(elapsed);
        const petWindow = this.options.getPetWindow();
        const petBounds = this.session.getPetBounds();
        const previous = petWindow.getBounds();
        if (previous.x !== petBounds.x || previous.y !== petBounds.y) petWindow.setPosition(petBounds.x, petBounds.y, false);
        const toyX = Math.round(this.session.toy.x - TOY_SIZE / 2);
        const toyY = Math.round(this.session.toy.y - TOY_SIZE / 2);
        const previousToy = this.window.getBounds();
        if (previousToy.x !== toyX || previousToy.y !== toyY) this.window.setPosition(toyX, toyY, false);
        const visible = this.session.snapshot().toyVisible;
        if (visible && !this.window.isVisible()) this.window.showInactive();
        else if (!visible && this.window.isVisible()) this.window.hide();
        this.updateHitTest(cursor);
        this.publish();
        if (completed) {
            const continuePlaying = this.options.onComplete(this.session.mode);
            if (!continuePlaying) this.stop(false);
        }
    }
}

module.exports = { DesktopPlay };
