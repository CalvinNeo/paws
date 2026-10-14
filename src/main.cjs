const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, screen, powerMonitor, dialog } = require('electron');
const { advanceState, performAction, updateSettings, renamePet, getMood, getFriendship, ensureCanPlay, rewardPlay } = require('./model.cjs');
const { DEFAULT_PET_SIZE, PET_SIZE_PRESETS, petSize, clampBounds, homeBounds, walkStep } = require('./geometry.cjs');
const { loadState, saveState } = require('./store.cjs');
const { DesktopPlay } = require('./desktop-play.cjs');
const { PLAY_MODES } = require('./play.cjs');

app.setName('Pawpal');
if (!app.isPackaged && process.env.PAWPAL_USER_DATA) {
    app.setPath('userData', path.resolve(process.env.PAWPAL_USER_DATA));
}
if (process.platform === 'win32') app.setAppUserModelId('com.openboardgame.pawpal');

const rendererDirectory = path.join(__dirname, 'renderer');
const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
const dataPath = path.join(app.getPath('userData'), 'companion.json');
const runtime = { behavior: 'idle', direction: -1, visible: true, warning: null };
let state;
let dashboard;
let petWindow;
let tray;
let quitting = false;
let suspended = false;
let dragging = null;
let hovering = false;
let menuOpen = false;
let ignoringMouse = true;
let behaviorUntil = 0;
let nextWanderAt = Date.now() + 12000;
let lastTickAt = Date.now();
let lastActionAt = 0;
let motionTimer;
let careTimer;
let saveTimer;
let windowReady = false;
let desktopPlay;

function snapshot() {
    return {
        pet: state,
        mood: getMood(state),
        friendship: getFriendship(state),
        runtime: { ...runtime },
        game: desktopPlay?.snapshot() ?? null,
        platform: process.platform,
        version: app.getVersion(),
        canLaunchOnLogin: app.isPackaged && ['darwin', 'win32'].includes(process.platform),
    };
}

function broadcast(message = null) {
    if (!state) return;
    const payload = { ...snapshot(), message };
    for (const window of [dashboard, petWindow]) {
        if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
            window.webContents.send('pawpal:state', payload);
        }
    }
}

function saveNow() {
    clearTimeout(saveTimer);
    if (!state) return;
    try {
        saveState(dataPath, state);
        if (runtime.warning?.startsWith('Could not save')) {
            runtime.warning = null;
            broadcast();
        }
    } catch (error) {
        console.error('Pawpal save failed:', error.message);
        runtime.warning = 'Could not save your pet. Check available disk space and folder permissions.';
        broadcast();
    }
}

function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 300);
}

function rememberPosition() {
    if (!petWindow || petWindow.isDestroyed()) return;
    const { x, y } = petWindow.getBounds();
    state = { ...state, position: { x, y } };
    scheduleSave();
}

function setBehavior(behavior, duration = 0) {
    runtime.behavior = behavior;
    behaviorUntil = duration ? Date.now() + duration : 0;
    broadcast();
}

function restBehavior() {
    return state.sleeping ? 'sleeping' : 'idle';
}

function pauseWandering() {
    nextWanderAt = Date.now() + 8000 + Math.random() * 10000;
    if (desktopPlay?.active) return;
    if (runtime.behavior === 'walking') {
        setBehavior(restBehavior());
        rememberPosition();
    }
}

function performPetAction(action) {
    const now = Date.now();
    if (now - lastActionAt < 450) throw new Error('One little moment…');
    const result = performAction(state, action, now);
    desktopPlay?.stop(false);
    state = result.state;
    lastActionAt = now;
    runtime.behavior = result.behavior;
    behaviorUntil = ['petting', 'eating', 'playing'].includes(result.behavior) ? now + 4200 : 0;
    nextWanderAt = now + 13000;
    scheduleSave();
    updateTray();
    broadcast(result.message);
    return result.message;
}

function actionFromMenu(action) {
    try {
        performPetAction(action);
    } catch (error) {
        broadcast(error.message);
    }
}

function secureWindow(window, filename) {
    const allowedUrl = pathToFileURL(path.join(rendererDirectory, filename)).href;
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, destination) => {
        if (destination !== allowedUrl) event.preventDefault();
    });
    window.webContents.on('will-attach-webview', (event) => event.preventDefault());
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    window.webContents.session.setPermissionCheckHandler(() => false);
    window.webContents.on('render-process-gone', (_event, details) => {
        if (quitting || details.reason === 'clean-exit') return;
        console.error(`Pawpal renderer stopped: ${details.reason}`);
        if (window === petWindow) endDrag(false);
        desktopPlay?.stop(false);
        runtime.warning = 'A puppy window stopped unexpectedly. Restart Pawpal if it does not recover.';
        broadcast();
    });
}

function commonPreferences() {
    return {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        spellcheck: false,
    };
}

function showDashboard() {
    if (!dashboard || dashboard.isDestroyed()) {
        createDashboard();
        dashboard.once('ready-to-show', showDashboard);
        return;
    }
    if (process.platform === 'darwin') app.dock?.show();
    if (dashboard.isMinimized()) dashboard.restore();
    dashboard.show();
    dashboard.focus();
}

function showPetOnLaunch() {
    if (!windowReady || !petWindow || petWindow.isDestroyed()) return;
    if (!runtime.visible) setPetVisible(true);
    else petWindow.showInactive();
}

function hideDashboard() {
    if (!dashboard || dashboard.isDestroyed()) return;
    dashboard.hide();
    if (process.platform === 'darwin' && tray) app.dock?.hide();
}

function createDashboard() {
    const workArea = screen.getPrimaryDisplay().workArea;
    dashboard = new BrowserWindow({
        width: Math.min(1120, workArea.width),
        height: Math.min(820, workArea.height),
        minWidth: Math.min(780, workArea.width),
        minHeight: Math.min(600, workArea.height),
        show: false,
        title: 'Pawpal — a little company',
        backgroundColor: '#f8f7f3',
        icon: iconPath,
        titleBarStyle: 'hidden',
        trafficLightPosition: { x: 18, y: 17 },
        webPreferences: commonPreferences(),
    });
    dashboard.setMenuBarVisibility(false);
    secureWindow(dashboard, 'index.html');
    dashboard.on('close', (event) => {
        if (!quitting && tray) {
            event.preventDefault();
            hideDashboard();
        }
    });
    dashboard.on('closed', () => { dashboard = null; });
    dashboard.loadFile(path.join(rendererDirectory, 'index.html'));
}

function setMousePassthrough(ignore) {
    if (!petWindow || petWindow.isDestroyed() || ignoringMouse === ignore) return;
    ignoringMouse = ignore;
    petWindow.setIgnoreMouseEvents(ignore, { forward: true });
}

function applyPetWindowSettings() {
    if (!petWindow || petWindow.isDestroyed()) return;
    petWindow.setAlwaysOnTop(state.settings.alwaysOnTop, 'floating');
    const bounds = petWindow.getBounds();
    const dimensions = petSize(state.settings.size);
    const display = screen.getDisplayMatching(bounds);
    petWindow.setBounds(clampBounds({
        ...dimensions,
        x: bounds.x + (bounds.width - dimensions.width) / 2,
        y: bounds.y + bounds.height - dimensions.height,
    }, display.workArea));
    if (!state.settings.roaming || state.settings.reducedMotion) pauseWandering();
    rememberPosition();
}

function createPetWindow() {
    const workArea = state.position
        ? screen.getDisplayNearestPoint(state.position).workArea
        : screen.getPrimaryDisplay().workArea;
    const bounds = state.position
        ? clampBounds({ ...state.position, ...petSize(state.settings.size) }, workArea)
        : homeBounds(state.settings.size, workArea);
    petWindow = new BrowserWindow({
        ...bounds,
        show: false,
        title: 'Pawpal companion',
        transparent: true,
        frame: false,
        backgroundColor: '#00000000',
        hasShadow: false,
        resizable: false,
        maximizable: false,
        minimizable: false,
        fullscreenable: false,
        focusable: false,
        acceptFirstMouse: true,
        skipTaskbar: true,
        alwaysOnTop: state.settings.alwaysOnTop,
        webPreferences: { ...commonPreferences(), backgroundThrottling: false },
    });
    if (process.platform === 'darwin') {
        petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    }
    petWindow.setAlwaysOnTop(state.settings.alwaysOnTop, 'floating');
    petWindow.setIgnoreMouseEvents(true, { forward: true });
    ignoringMouse = true;
    secureWindow(petWindow, 'pet.html');
    petWindow.once('ready-to-show', () => {
        windowReady = true;
        petWindow.showInactive();
        broadcast();
    });
    petWindow.on('blur', () => endDrag(false));
    petWindow.on('close', (event) => {
        if (!quitting) {
            event.preventDefault();
            setPetVisible(false);
        }
    });
    petWindow.loadFile(path.join(rendererDirectory, 'pet.html'));
}

function setPetVisible(visible) {
    desktopPlay?.stop(false);
    endDrag(false);
    runtime.visible = visible;
    hovering = false;
    pauseWandering();
    if (visible) {
        recoverPetPosition();
        petWindow.showInactive();
    } else {
        petWindow.hide();
    }
    setMousePassthrough(true);
    updateTray();
    broadcast();
}

function recoverPetPosition() {
    if (!petWindow || petWindow.isDestroyed()) return;
    const bounds = petWindow.getBounds();
    const workArea = screen.getDisplayMatching(bounds).workArea;
    petWindow.setBounds(clampBounds(bounds, workArea));
    rememberPosition();
}

function bringPetHome() {
    desktopPlay?.stop(false);
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    petWindow.setBounds(homeBounds(state.settings.size, area));
    setPetVisible(true);
    rememberPosition();
    broadcast('Here I am!');
}

function changePreferences(patch) {
    const updated = updateSettings(state, patch);
    const changingSpecies = updated.settings.species !== state.settings.species;
    if (updated.settings.size !== state.settings.size || changingSpecies) desktopPlay?.stop(false);
    if (Object.hasOwn(patch, 'launchOnLogin') && patch.launchOnLogin !== state.settings.launchOnLogin) {
        if (!app.isPackaged || !['darwin', 'win32'].includes(process.platform)) {
            throw new Error('Launch at login is available after installing Pawpal.');
        }
        app.setLoginItemSettings({ openAtLogin: patch.launchOnLogin, args: ['--hidden'] });
        updated.settings.launchOnLogin = app.getLoginItemSettings().openAtLogin;
        if (updated.settings.launchOnLogin !== patch.launchOnLogin) {
            throw new Error('Your system did not apply this change. Check system login-item settings.');
        }
    }
    if (changingSpecies) {
        endDrag(false);
        hovering = false;
        runtime.behavior = restBehavior();
        runtime.carrying = null;
        behaviorUntil = 0;
        nextWanderAt = Date.now() + 12000;
        setMousePassthrough(true);
    }
    state = { ...state, settings: updated.settings };
    applyPetWindowSettings();
    if (desktopPlay?.active) petWindow.setAlwaysOnTop(true, 'floating');
    updateTray();
    scheduleSave();
    broadcast();
}

function contextMenuTemplate() {
    return [
        { label: `Open ${state.name}'s home`, click: showDashboard },
        { type: 'separator' },
        { label: 'Give a head scratch', click: () => actionFromMenu('pet') },
        { label: 'Give a treat', enabled: !state.sleeping && state.fullness < 98, click: () => actionFromMenu('feed') },
        { label: 'Play together', enabled: !state.sleeping && state.energy >= 12, submenu: Object.entries(PLAY_MODES).map(([mode, game]) => ({
            label: game.label,
            click: () => {
                try { startPlay(mode); } catch (error) { broadcast(error.message); }
            },
        })) },
        { label: 'Put toys away', visible: Boolean(desktopPlay?.active), click: () => desktopPlay?.stop() },
        { label: state.sleeping ? 'Wake up' : 'Take a nap', click: () => actionFromMenu(state.sleeping ? 'wake' : 'sleep') },
        { type: 'separator' },
        { label: 'Your companion', submenu: [
            { id: 'pet-species-dog', label: 'Puppy', type: 'radio', checked: state.settings.species === 'dog', click: () => changePreferences({ species: 'dog' }) },
            { id: 'pet-species-cat', label: 'Silver tabby', type: 'radio', checked: state.settings.species === 'cat', click: () => changePreferences({ species: 'cat' }) },
        ] },
        { label: `Pet size (${state.settings.size}%)`, submenu: [...new Set([...PET_SIZE_PRESETS, state.settings.size])].sort((first, second) => first - second).map((size) => ({
            id: `pet-size-${size}`,
            label: `${size}%${size === DEFAULT_PET_SIZE ? ' (default)' : ''}`,
            type: 'radio',
            checked: state.settings.size === size,
            click: () => changePreferences({ size }),
        })) },
        { label: 'Let your friend wander', type: 'checkbox', checked: state.settings.roaming, click: (item) => changePreferences({ roaming: item.checked }) },
        { label: runtime.visible ? 'Hide pet' : 'Show pet', click: () => setPetVisible(!runtime.visible) },
        { label: 'Bring your friend here', click: bringPetHome },
        { type: 'separator' },
        { label: 'Quit Pawpal', click: () => app.quit() },
    ];
}

function updateTray() {
    if (!tray || tray.isDestroyed()) return;
    tray.setToolTip(`Pawpal · ${state.name}`);
    tray.setContextMenu(Menu.buildFromTemplate(contextMenuTemplate()));
}

function createTray() {
    try {
        const filename = process.platform === 'darwin' ? 'trayTemplate.png' : 'icon.png';
        let image = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', filename));
        if (image.isEmpty()) throw new Error('Tray icon is missing. Run npm run icons.');
        image = image.resize({ width: process.platform === 'darwin' ? 18 : 24 });
        if (process.platform === 'darwin') image.setTemplateImage(true);
        tray = new Tray(image);
        tray.on('double-click', showDashboard);
        if (process.platform === 'win32') tray.on('click', showDashboard);
        updateTray();
    } catch (error) {
        console.error(error.message);
        runtime.warning = 'The system tray is unavailable. Right-click your pet to open Pawpal or quit.';
    }
}

function beginDrag() {
    if (!runtime.visible || dragging) return;
    desktopPlay?.stop(false);
    pauseWandering();
    dragging = { cursor: screen.getCursorScreenPoint(), bounds: petWindow.getBounds(), moved: false };
    setMousePassthrough(false);
}

function endDrag(allowPet) {
    if (!dragging) return;
    const moved = dragging.moved;
    dragging = null;
    rememberPosition();
    nextWanderAt = Date.now() + 12000;
    if (allowPet && !moved) actionFromMenu('pet');
}

function tickMotion() {
    const now = Date.now();
    const elapsed = (now - lastTickAt) / 1000;
    lastTickAt = now;
    if (suspended || !windowReady || !runtime.visible || petWindow.isDestroyed() || desktopPlay?.active) return;
    if (dragging) {
        const cursor = screen.getCursorScreenPoint();
        const offsetX = cursor.x - dragging.cursor.x;
        const offsetY = cursor.y - dragging.cursor.y;
        if (Math.hypot(offsetX, offsetY) > 5) dragging.moved = true;
        if (dragging.moved) {
            const workArea = screen.getDisplayNearestPoint(cursor).workArea;
            petWindow.setBounds(clampBounds({
                ...dragging.bounds,
                x: dragging.bounds.x + offsetX,
                y: dragging.bounds.y + offsetY,
            }, workArea));
        }
        return;
    }
    if (behaviorUntil && now >= behaviorUntil) {
        const wasWalking = runtime.behavior === 'walking';
        setBehavior(restBehavior());
        if (wasWalking) {
            rememberPosition();
            nextWanderAt = now + 9000 + Math.random() * 14000;
        }
    }
    const canWander = !state.sleeping && state.energy >= 12 && state.settings.roaming
        && !state.settings.reducedMotion && !hovering && !menuOpen;
    if (!canWander) {
        if (runtime.behavior === 'walking') pauseWandering();
        return;
    }
    if (runtime.behavior === 'idle' && now >= nextWanderAt) {
        runtime.direction = Math.random() > 0.5 ? 1 : -1;
        setBehavior('walking', 3500 + Math.random() * 4500);
    }
    if (runtime.behavior === 'walking') {
        const bounds = petWindow.getBounds();
        const area = screen.getDisplayMatching(bounds).workArea;
        const step = walkStep(bounds, runtime.direction, elapsed, area);
        petWindow.setPosition(Math.round(step.x), bounds.y, false);
        if (step.direction !== runtime.direction) {
            runtime.direction = step.direction;
            broadcast();
        }
    }
}

function trustedSender(event, onlyPet = false) {
    const allowed = onlyPet ? [petWindow] : [dashboard, petWindow];
    return event.senderFrame === event.sender.mainFrame
        && allowed.some((window) => window && !window.isDestroyed() && window.webContents === event.sender);
}

function createDesktopPlay() {
    desktopPlay = new DesktopPlay({
        getPetWindow: () => petWindow,
        webPreferences: commonPreferences,
        secureWindow,
        openHome: showDashboard,
        canPlay: () => {
            if (!windowReady || suspended) throw new Error('Your friend is not ready just yet.');
            ensureCanPlay(advanceState(state));
        },
        onStart: () => {
            endDrag(false);
            runtime.visible = true;
            runtime.carrying = null;
            hovering = false;
            behaviorUntil = 0;
            setMousePassthrough(true);
            petWindow.setAlwaysOnTop(true, 'floating');
            petWindow.showInactive();
        },
        onPose: (pose) => {
            runtime.behavior = pose.behavior;
            runtime.direction = pose.direction;
            runtime.carrying = pose.carrying;
            broadcast();
        },
        onStop: (notify) => {
            runtime.behavior = restBehavior();
            runtime.carrying = null;
            behaviorUntil = 0;
            nextWanderAt = Date.now() + 12000;
            petWindow.setAlwaysOnTop(state.settings.alwaysOnTop, 'floating');
            setMousePassthrough(true);
            rememberPosition();
            updateTray();
            broadcast(notify ? 'Toys tucked away. I’m still right here. ♥' : null);
        },
        onComplete: (mode) => {
            const reward = rewardPlay(state, mode);
            state = reward.state;
            rememberPosition();
            updateTray();
            broadcast(reward.message);
            return state.energy >= 12;
        },
    });
}

function startPlay(mode) {
    desktopPlay.start(mode);
    updateTray();
    broadcast(PLAY_MODES[mode].instruction);
    return snapshot();
}

function registerIpc() {
    const handlers = {
        'pawpal:get': () => snapshot(),
        'pawpal:action': (action) => ({ message: performPetAction(action), ...snapshot() }),
        'pawpal:play': (mode) => {
            if (mode === 'stop') {
                desktopPlay.stop();
                return snapshot();
            }
            return startPlay(mode);
        },
        'pawpal:preferences': (patch) => { changePreferences(patch); return snapshot(); },
        'pawpal:rename': (name) => {
            state = renamePet(state, name);
            scheduleSave();
            updateTray();
            broadcast();
            return snapshot();
        },
        'pawpal:window': (command) => {
            if (command === 'home') showDashboard();
            else if (command === 'hide-home') hideDashboard();
            else if (command === 'minimize') dashboard?.minimize();
            else if (command === 'toggle-pet') setPetVisible(!runtime.visible);
            else if (command === 'locate') bringPetHome();
            else if (command === 'quit') app.quit();
            else throw new Error('Unknown window command.');
            return snapshot();
        },
    };
    for (const [channel, handler] of Object.entries(handlers)) {
        ipcMain.handle(channel, (event, payload) => {
            if (!trustedSender(event)) return { ok: false, error: 'Untrusted window.' };
            try {
                return { ok: true, data: handler(payload) };
            } catch (error) {
                return { ok: false, error: error.message };
            }
        });
    }
    ipcMain.handle('pawpal:toy-get', (event) => {
        if (!desktopPlay?.isSender(event)) return { ok: false, error: 'Untrusted toy window.' };
        return { ok: true, data: desktopPlay.snapshot() };
    });
    ipcMain.on('pawpal:toy-pointer', (event, inside) => {
        if (desktopPlay?.isSender(event) && typeof inside === 'boolean') desktopPlay.pointer(inside);
    });
    ipcMain.on('pawpal:toy-drag', (event, phase, point) => {
        if (!desktopPlay?.isSender(event) || !['start', 'end', 'cancel'].includes(phase)) return;
        try { desktopPlay.drag(phase, point); } catch (error) { desktopPlay.stop(false); broadcast(error.message); }
    });
    ipcMain.on('pawpal:toy-menu', (event) => {
        if (desktopPlay?.isSender(event)) desktopPlay.menu();
    });
    ipcMain.on('pawpal:pointer', (event, interactive) => {
        if (!trustedSender(event, true) || typeof interactive !== 'boolean') return;
        hovering = interactive;
        if (!dragging) setMousePassthrough(!interactive);
        if (interactive) pauseWandering();
    });
    ipcMain.on('pawpal:drag', (event, phase) => {
        if (!trustedSender(event, true)) return;
        if (phase === 'start') beginDrag();
        else if (phase === 'end') endDrag(true);
        else if (phase === 'cancel') endDrag(false);
    });
    ipcMain.on('pawpal:menu', (event) => {
        if (!trustedSender(event, true)) return;
        endDrag(false);
        pauseWandering();
        menuOpen = true;
        Menu.buildFromTemplate(contextMenuTemplate()).popup({
            window: petWindow,
            callback: () => {
                menuOpen = false;
                hovering = false;
                setMousePassthrough(true);
            },
        });
    });
}

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', (_event, argumentsList) => {
        if (!state) return;
        if (argumentsList.includes('--show-dashboard') && !argumentsList.includes('--hidden')) showDashboard();
        else showPetOnLaunch();
    });
    app.whenReady().then(() => {
        const loaded = loadState(dataPath);
        state = advanceState(loaded.state);
        runtime.warning = loaded.warning;
        runtime.behavior = restBehavior();
        if (app.isPackaged) state.settings.launchOnLogin = app.getLoginItemSettings().openAtLogin;
        Menu.setApplicationMenu(Menu.buildFromTemplate([
            ...(process.platform === 'darwin' ? [{ label: 'Pawpal', submenu: [
                { label: 'Open Pawpal', click: showDashboard }, { type: 'separator' },
                { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' },
            ] }] : []),
            { role: 'editMenu' },
        ]));
        registerIpc();
        createPetWindow();
        createDesktopPlay();
        createTray();
        if (process.argv.includes('--show-dashboard') && !process.argv.includes('--hidden')) {
            showDashboard();
        } else if (process.platform === 'darwin') {
            app.dock?.hide();
        }
        motionTimer = setInterval(tickMotion, 50);
        careTimer = setInterval(() => {
            state = advanceState(state);
            saveNow();
            updateTray();
            broadcast();
        }, 30000);
        for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) {
            screen.on(event, () => {
                desktopPlay?.stop(false);
                endDrag(false);
                recoverPetPosition();
                if (dashboard && !dashboard.isDestroyed()) {
                    const bounds = dashboard.getBounds();
                    dashboard.setBounds(clampBounds(bounds, screen.getDisplayMatching(bounds).workArea));
                }
            });
        }
        powerMonitor.on('suspend', () => { suspended = true; desktopPlay?.stop(false); endDrag(false); saveNow(); });
        powerMonitor.on('lock-screen', () => desktopPlay?.stop(false));
        powerMonitor.on('resume', () => {
            suspended = false;
            state = advanceState(state);
            lastTickAt = Date.now();
            nextWanderAt = Date.now() + 10000;
            setBehavior(restBehavior());
            recoverPetPosition();
        });
        app.on('activate', () => {
            if (dashboard && !dashboard.isDestroyed() && dashboard.isVisible()) showDashboard();
            else showPetOnLaunch();
        });
    }).catch((error) => {
        console.error(error);
        dialog.showErrorBox('Pawpal could not start', `${error.message}\n\nYour existing save has not been reset.`);
        app.quit();
    });
    app.on('before-quit', () => {
        quitting = true;
        clearInterval(motionTimer);
        clearInterval(careTimer);
        if (state) {
            desktopPlay?.stop(false);
            endDrag(false);
            state = advanceState(state);
            rememberPosition();
            saveNow();
        }
    });
    app.on('window-all-closed', () => { if (!tray) app.quit(); });
}
