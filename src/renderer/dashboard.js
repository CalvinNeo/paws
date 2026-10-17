import './pet-avatar.js';
import { renderIcons } from './icons.js';

renderIcons();
const bridge = window.pawpal;
const element = (identifier) => document.getElementById(identifier);
const viewTitles = {
    home: ['YOUR EVERYDAY, A LITTLE HAPPIER', 'Meet your little sidekick'],
    wardrobe: ['A LITTLE SOMETHING THAT FEELS LIKE THEM', 'A little style. A lot of personality'],
    preferences: ['YOUR DESK. YOUR KIND OF COMPANY', 'Make yourself at home'],
};
const activityEmoji = { adopt: '🐾', pet: '🤍', feed: '🦴', play: '🎾', sleep: '🌙', wake: '☀️', rename: '✏️' };
const genericExplanations = {
    accessory: 'Choose a terracotta Bandana, a sage Collar, or Au naturel for your puppy. Your cat keeps their real photographic appearance.',
    species: 'Choose Puppy (🐶) or Your cat (🐱). The cat uses photographs and recorded movements shared by their owner and included with Pawpal. Only one companion appears at a time. Each has their own name, care, games, progress, size and position. Switching restores that companion and safely puts toys away.',
    catPose: 'Choose Sitting, Resting, Belly up, or Standing. Standing keeps your cat’s standing photo on the desk. Stand up adds a small rise and settle animated from that photo. Sitting includes quiet recorded movements; naps use a curled-up photograph.',
    size: 'Reset your companion to 30% of the original width and height. They stay on the current screen and keep their paws near the same spot.',
};
let currentState;
let activeView = 'home';
let pendingAction = false;
let explainMode = false;
let blockNextClick = false;
let toastTimer;
let sceneTimer;
let activitySignature = '';

for (const button of document.querySelectorAll('[data-setting]')) {
    button.dataset.explain ||= genericExplanations[button.dataset.setting];
}

function showToast(message) {
    clearTimeout(toastTimer);
    element('toast-text').textContent = message;
    element('toast').hidden = false;
    toastTimer = setTimeout(() => { element('toast').hidden = true; }, 3600);
}

function updateSceneMessage(message) {
    clearTimeout(sceneTimer);
    element('scene-message').textContent = message;
    sceneTimer = setTimeout(() => {
        element('scene-message').textContent = currentState.pet.sleeping ? currentState.companion.sleepMessage : currentState.companion.welcome;
    }, 4500);
}

function relativeTime(timestamp) {
    const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
    return `${Math.floor(minutes / 1440)}d ago`;
}

function renderActivity(pet) {
    const signature = `${pet.settings.species}:${JSON.stringify(pet.activity)}`;
    if (signature !== activitySignature) {
        activitySignature = signature;
        const fragment = document.createDocumentFragment();
        for (const entry of pet.activity) {
            const item = document.createElement('li');
            const emoji = document.createElement('span');
            emoji.className = 'activity-emoji';
            emoji.setAttribute('aria-hidden', 'true');
            emoji.textContent = currentState.companion.care[entry.type]?.emoji
                || (entry.type === 'play' ? Object.values(currentState.companion.games)[0].emoji : activityEmoji[entry.type]) || '🐾';
            const text = document.createElement('span');
            text.className = 'activity-text';
            text.textContent = entry.text;
            const time = document.createElement('time');
            time.dateTime = new Date(entry.at).toISOString();
            time.dataset.timestamp = String(entry.at);
            time.title = new Date(entry.at).toLocaleString();
            item.append(emoji, text, time);
            fragment.append(item);
        }
        element('activity-list').replaceChildren(fragment);
        element('activity-list').scrollTop = 0;
    }
    document.querySelectorAll('time[data-timestamp]').forEach((time) => {
        time.textContent = relativeTime(Number(time.dataset.timestamp));
    });
}

function updateCareButtons() {
    if (!currentState) return;
    const { pet, companion, standingAvailable, groomingAvailable } = currentState;
    for (const button of document.querySelectorAll('[data-action]')) {
        const action = button.dataset.action;
        button.disabled = pendingAction
            || (action === 'feed' && (pet.sleeping || pet.fullness >= 98))
            || (Object.hasOwn(companion.tricks || {}, action) && pet.sleeping)
            || (action === 'stand' && !standingAvailable)
            || (action === 'groom' && !groomingAvailable);
        button.setAttribute('aria-busy', String(pendingAction));
    }
    document.querySelectorAll('[data-play-mode]').forEach((button) => {
        button.disabled = pendingAction;
    });
    element('reset-pet').disabled = pendingAction;
    element('confirm-reset').disabled = pendingAction;
}

function renderCompanion(companion) {
    const isCat = companion.species === 'cat';
    for (const button of document.querySelectorAll('[data-trick]')) {
        button.hidden = !Object.hasOwn(companion.tricks || {}, button.dataset.action);
    }
    for (const [action, care] of Object.entries({ ...companion.care, ...companion.tricks })) {
        const button = document.querySelector(`.care-button[data-action="${action}"]`);
        button.dataset.explain = care.explanation;
        button.querySelector('.care-emoji').textContent = care.emoji;
        button.querySelector('strong').textContent = care.label;
        button.querySelector('small').textContent = care.description;
    }
    const preview = document.querySelector('.preview-pet');
    preview.dataset.explain = `${companion.care.pet.explanation} On the desktop, click to pet them, or drag them to a new spot.`;
    preview.setAttribute('aria-label', companion.care.pet.menu);
    preview.title = companion.care.pet.menu;
    const playButton = document.querySelector('[data-action="play"]');
    playButton.dataset.explain = companion.playExplanation;
    playButton.querySelector('.care-emoji').textContent = isCat ? '🧶' : '🎾';
    playButton.querySelector('small').textContent = companion.playDescription;
    element('fullness-emoji').textContent = companion.care.feed.emoji;
    element('fullness-stat').dataset.explain = `Fullness (${companion.care.feed.emoji}) goes down gently over time. ${companion.care.feed.explanation}`;
    element('happiness-stat').dataset.explain = `Happiness (🤍) slowly drifts down while your ${companion.species} waits. ${companion.care.pet.label} and playtime bring it back up.`;
    element('help-hello').textContent = `Click your pet for ${companion.care.pet.label} (${companion.care.pet.emoji}). Double-clicks and repeated clicks also just pet them, without opening their home. Drag to move them. To open their home, right-click and choose Open …'s home, or use the system tray.`;
    element('help-care').textContent = `${companion.care.feed.label} (${companion.care.feed.emoji}) fills their tummy. Playtime (${isCat ? '🧶' : '🎾'}) brings joy but uses energy. Take a nap (🌙) to recharge; Wake up (☀️) when it's time.`;
    element('help-companion').textContent = isCat
        ? 'Your cat rests in place by default. Choose Sitting, Resting, Belly up or Standing in Wardrobe. Stand up adds a small rise and settle animated from a standing photo, then returns to the chosen pose. Sitting and play include short recorded movements; naps use a curled-up photo. Each companion keeps their own name, care, games, progress, size and position.'
        : 'Your puppy takes short walks, stays within the screen, and pauses when you hover. Choose Puppy (🐶) or Your cat (🐱) in Wardrobe or the right-click menu → Your companion. Each has their own name, care, games, progress, size and position. Your puppy’s coat and accessories stay with your puppy.';
    element('help-games').textContent = companion.playHelp;
    element('name-input').placeholder = companion.defaultName;
    const choices = document.createDocumentFragment();
    for (const [mode, game] of Object.entries(companion.games)) {
        const button = document.createElement('button');
        button.className = 'game-choice';
        button.dataset.playMode = mode;
        button.innerHTML = '<span class="game-emoji"></span><span class="game-copy"><strong></strong><span></span><small></small></span><span data-icon="arrow"></span>';
        button.querySelector('.game-emoji').textContent = game.emoji;
        button.querySelector('strong').textContent = game.label;
        button.querySelector('.game-copy > span').textContent = game.description;
        button.querySelector('small').id = `game-total-${mode}`;
        choices.append(button);
    }
    element('game-choices').replaceChildren(choices);
    renderIcons(element('game-choices'));
}

function renderState(snapshot) {
    const changingSpecies = currentState?.pet.settings.species !== snapshot.pet.settings.species;
    currentState = snapshot;
    const { pet, companion, mood, friendship, runtime } = snapshot;
    if (changingSpecies) {
        clearTimeout(toastTimer);
        clearTimeout(sceneTimer);
        element('toast').hidden = true;
        element('scene-message').textContent = pet.sleeping ? companion.sleepMessage : companion.welcome;
        element('play-dialog').close();
        element('explanation-dialog').close();
        element('rename-dialog').close();
        element('reset-dialog').close();
        renderCompanion(companion);
    }
    const isCat = pet.settings.species === 'cat';
    document.body.classList.toggle('reduced-motion', pet.settings.reducedMotion);
    document.querySelectorAll('pet-avatar').forEach((avatar) => avatar.update(snapshot));
    element('dog-coat-card').hidden = isCat;
    element('cat-coat-card').hidden = !isCat;
    element('dog-accessory-card').hidden = isCat;
    element('cat-pose-card').hidden = !isCat;
    element('cat-assets-note').hidden = snapshot.catAvailable;
    element('appearance-description').textContent = isCat ? 'Your real cat. Right here.' : 'Same little soul. A fresh little look.';
    document.querySelectorAll('[data-setting="species"][data-value="cat"]').forEach((button) => {
        button.disabled = !snapshot.catAvailable;
    });
    document.querySelectorAll('[data-setting="catPose"][data-value="standing"]').forEach((button) => {
        button.disabled = !snapshot.standingAvailable;
    });
    element('pet-name').textContent = pet.name;
    element('pet-name').title = pet.name;
    element('wardrobe-name').textContent = pet.name;
    element('days-together').textContent = `DAY ${String(Math.floor((Date.now() - pet.adoptedAt) / 86400000) + 1).padStart(2, '0')} TOGETHER`;
    element('pet-presence').textContent = runtime.visible ? 'ON YOUR DESKTOP' : 'TAKING A LITTLE BREAK';
    element('mood-label').textContent = mood.label;
    element('mood-description').textContent = mood.description;
    element('mood-symbol').textContent = pet.sleeping ? '☾' : '✦';
    element('friendship-label').textContent = friendship.label;
    element('friendship-description').textContent = friendship.next;
    element('interaction-count').textContent = pet.interactions ? `${pet.interactions} LITTLE MOMENT${pet.interactions === 1 ? '' : 'S'} TOGETHER` : 'YOUR STORY STARTS HERE';
    element('sleep-button').dataset.action = pet.sleeping ? 'wake' : 'sleep';
    element('sleep-emoji').textContent = pet.sleeping ? '☀️' : '🌙';
    element('sleep-label').textContent = pet.sleeping ? 'Wake up' : 'Take a nap';
    element('sleep-description').textContent = pet.sleeping ? 'Hello, sunshine' : 'Dream a little';
    element('visibility-button').textContent = runtime.visible ? 'Hide pet' : 'Show pet';
    element('play-status').hidden = !snapshot.game;
    element('play-dialog-stop').hidden = !snapshot.game;
    if (snapshot.game) {
        const game = companion.games[snapshot.game.mode];
        element('play-status-text').textContent = `${game.emoji} ${game.label} · ${snapshot.game.completed} this session · ${snapshot.game.phase === 'ready' ? 'Your turn!' : 'Playing together'}`;
    }
    for (const [mode, game] of Object.entries(companion.games)) {
        element(`game-total-${mode}`).textContent = `${pet.playStats?.[mode] ?? 0} ${game.progress}`;
    }
    element('window-controls').hidden = snapshot.platform === 'darwin';
    element('app-version').textContent = `v${snapshot.version}`;
    element('warning-banner').hidden = !runtime.warning;
    element('warning-banner').textContent = runtime.warning || '';
    for (const stat of ['happiness', 'fullness', 'energy']) {
        const value = Math.round(pet[stat]);
        element(`${stat}-value`).textContent = String(value);
        element(`${stat}-meter`).setAttribute('aria-valuenow', String(value));
        element(`${stat}-meter`).firstElementChild.style.width = `${value}%`;
    }
    document.querySelectorAll('[data-preference]').forEach((input) => {
        input.checked = pet.settings[input.dataset.preference];
    });
    document.querySelectorAll('[data-setting]').forEach((button) => {
        button.setAttribute('aria-pressed', String(String(pet.settings[button.dataset.setting]) === button.dataset.value));
    });
    element('pet-size-range').value = String(pet.settings.size);
    element('pet-size-value').textContent = `${pet.settings.size}%`;
    element('pet-size-range').setAttribute('aria-valuetext', `${pet.settings.size}% of original size`);
    element('setting-launchOnLogin').disabled = !snapshot.canLaunchOnLogin;
    element('login-description').textContent = snapshot.canLaunchOnLogin
        ? 'Launch Pawpal when you sign in to your computer.'
        : 'Available after installing the packaged app.';
    renderActivity(pet);
    updateCareButtons();
    if (snapshot.message) {
        showToast(snapshot.message);
        updateSceneMessage(snapshot.message);
    }
}

async function request(operation, payload) {
    if (!bridge) {
        showToast('Open Pawpal with npm start to use your desktop companion.');
        return false;
    }
    try {
        const response = await bridge[operation](payload);
        if (!response.ok) throw new Error(response.error);
        if (response.data?.pet) renderState({ ...response.data, message: null });
        return true;
    } catch (error) {
        showToast(error.message || 'Something went wrong. Please try again.');
        return false;
    }
}

function selectView(view) {
    if (!Object.hasOwn(viewTitles, view)) return;
    activeView = view;
    for (const candidate of Object.keys(viewTitles)) element(`view-${candidate}`).hidden = candidate !== view;
    document.querySelectorAll('[data-view]').forEach((button) => {
        const selected = button.dataset.view === view;
        button.classList.toggle('active', selected);
        if (selected) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
    });
    element('page-eyebrow').textContent = viewTitles[view][0];
    const dot = document.createElement('span');
    dot.textContent = '.';
    element('page-title').replaceChildren(document.createTextNode(viewTitles[view][1]), dot);
    element('main-content').scrollTop = 0;
}

function setExplainMode(enabled) {
    explainMode = enabled;
    element('explain-button').setAttribute('aria-pressed', String(enabled));
    element('explain-banner').hidden = !enabled;
    document.body.classList.toggle('explain-mode', enabled);
}

function showExplanation(target) {
    setExplainMode(false);
    element('explanation-text').textContent = target.dataset.explain;
    element('explanation-dialog').showModal();
}

function isExplanationException(target) {
    return target.closest('#explain-button, #help-button, dialog');
}

document.addEventListener('pointerdown', (event) => {
    if (!explainMode || isExplanationException(event.target)) return;
    blockNextClick = true;
    event.preventDefault();
    event.stopImmediatePropagation();
    const candidates = [...document.querySelectorAll('[data-explain]')].reverse();
    const target = event.target.closest('[data-explain]') || candidates.find((candidate) => {
        const bounds = candidate.getBoundingClientRect();
        return bounds.width && bounds.height && event.clientX >= bounds.left && event.clientX <= bounds.right
            && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
    });
    if (target) showExplanation(target);
}, true);

document.addEventListener('click', (event) => {
    if (blockNextClick) {
        blockNextClick = false;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
    }
    if (!explainMode || isExplanationException(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const target = event.target.closest('[data-explain]');
    if (target) showExplanation(target);
}, true);

document.addEventListener('pointerup', () => {
    setTimeout(() => { blockNextClick = false; }, 0);
}, true);

document.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', () => selectView(button.dataset.view));
});
document.querySelector('.brand').addEventListener('click', (event) => {
    event.preventDefault();
    selectView('home');
});
document.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', async () => {
        if (pendingAction) return;
        if (button.dataset.action === 'play') {
            element('play-dialog').showModal();
            return;
        }
        pendingAction = true;
        updateCareButtons();
        await request('action', button.dataset.action);
        pendingAction = false;
        updateCareButtons();
    });
});
element('game-choices').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-play-mode]');
    if (!button || button.disabled || pendingAction) return;
    pendingAction = true;
    updateCareButtons();
    if (await request('play', button.dataset.playMode)) element('play-dialog').close();
    pendingAction = false;
    updateCareButtons();
});
document.querySelectorAll('[data-stop-play]').forEach((button) => {
    button.addEventListener('click', () => request('play', 'stop'));
});
document.querySelectorAll('[data-window]').forEach((button) => {
    button.addEventListener('click', () => request('window', button.dataset.window));
});
document.querySelectorAll('[data-preference]').forEach((input) => {
    input.addEventListener('change', async () => {
        const success = await request('preferences', { [input.dataset.preference]: input.checked });
        if (!success && currentState) input.checked = currentState.pet.settings[input.dataset.preference];
    });
});
document.querySelectorAll('[data-setting]').forEach((button) => {
    button.addEventListener('click', () => request('preferences', {
        [button.dataset.setting]: button.dataset.setting === 'size' ? Number(button.dataset.value) : button.dataset.value,
    }));
});
element('pet-size-range').addEventListener('input', (event) => {
    element('pet-size-value').textContent = `${event.target.value}%`;
    event.target.setAttribute('aria-valuetext', `${event.target.value}% of original size`);
});
element('pet-size-range').addEventListener('change', async (event) => {
    if (!await request('preferences', { size: Number(event.target.value) }) && currentState) renderState(currentState);
});
element('explain-button').addEventListener('click', () => setExplainMode(!explainMode));
element('help-button').addEventListener('click', () => {
    setExplainMode(false);
    element('help-dialog').showModal();
});
element('rename-button').addEventListener('click', () => {
    element('name-input').value = currentState?.pet.name || '';
    element('rename-dialog').showModal();
    element('name-input').select();
});
element('rename-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (await request('rename', element('name-input').value)) element('rename-dialog').close();
});
element('reset-pet').addEventListener('click', () => {
    if (!currentState || pendingAction) return;
    element('reset-title').textContent = `Reset data for ${currentState.pet.name}?`;
    element('reset-form').dataset.species = currentState.pet.settings.species;
    element('reset-dialog').showModal();
});
element('reset-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (pendingAction) return;
    pendingAction = true;
    updateCareButtons();
    if (await request('reset', element('reset-form').dataset.species)) element('reset-dialog').close();
    pendingAction = false;
    updateCareButtons();
});
document.querySelectorAll('[data-close-dialog]').forEach((button) => {
    button.addEventListener('click', () => button.closest('dialog').close());
});
document.querySelectorAll('dialog').forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
        if (event.target !== dialog) return;
        const bounds = dialog.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
    });
});
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        setExplainMode(false);
        blockNextClick = false;
    }
    if (event.key === '?' && !event.target.closest('input, textarea') && !document.querySelector('dialog[open]')) {
        setExplainMode(false);
        element('help-dialog').showModal();
    }
});

if (bridge) {
    bridge.onState(renderState);
    await request('getState');
} else {
    element('warning-banner').hidden = false;
    element('warning-banner').textContent = 'This is a desktop application. Run npm start from the puppy folder to meet your companion.';
    document.querySelectorAll('[data-action], [data-setting], [data-preference], [data-window], #rename-button, #pet-size-range, #reset-pet').forEach((control) => { control.disabled = true; });
}

window.addEventListener('focus', () => { if (bridge) request('getState'); });
setInterval(() => { if (currentState && activeView === 'home') renderActivity(currentState.pet); }, 30000);
