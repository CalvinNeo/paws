const { DEFAULT_PET_SIZE, validPetSize } = require('./geometry.cjs');

const HOUR = 60 * 60 * 1000;
const MAX_OFFLINE_TIME = 8 * HOUR;
const MAX_ACTIVITY = 12;
const DEFAULT_SETTINGS = Object.freeze({
    roaming: true,
    alwaysOnTop: true,
    launchOnLogin: false,
    reducedMotion: false,
    species: 'dog',
    coat: 'apricot',
    accessory: 'bandana',
    catAccessory: 'none',
    size: DEFAULT_PET_SIZE,
});
const SETTING_CHOICES = Object.freeze({
    species: ['dog', 'cat'],
    coat: ['apricot', 'cloud', 'cocoa'],
    accessory: ['bandana', 'collar', 'none'],
    catAccessory: ['bandana', 'collar', 'none'],
});

function clamp(value, minimum = 0, maximum = 100) {
    return Math.min(maximum, Math.max(minimum, value));
}

function finiteOr(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function cleanName(value) {
    if (typeof value !== 'string') return 'Mochi';
    const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
    return Array.from(cleaned).slice(0, 18).join('') || 'Mochi';
}

function createState(now = Date.now()) {
    return {
        version: 2,
        name: 'Mochi',
        adoptedAt: now,
        updatedAt: now,
        fullness: 82,
        happiness: 88,
        energy: 76,
        sleeping: false,
        affection: 0,
        interactions: 0,
        playStats: { fetch: 0, ball: 0, bubbles: 0 },
        settings: { ...DEFAULT_SETTINGS },
        position: null,
        activity: [{ type: 'adopt', at: now, text: 'A little friendship begins.' }],
    };
}

function validSetting(key, value) {
    if (!Object.hasOwn(DEFAULT_SETTINGS, key)) return false;
    if (key === 'size') return validPetSize(value);
    if (Object.hasOwn(SETTING_CHOICES, key)) return SETTING_CHOICES[key].includes(value);
    return typeof value === 'boolean';
}

function normalizeState(input, now = Date.now()) {
    const defaults = createState(now);
    if (!input || typeof input !== 'object' || Array.isArray(input)) return defaults;
    const settings = { ...DEFAULT_SETTINGS };
    for (const key of Object.keys(settings)) {
        if (validSetting(key, input.settings?.[key])) settings[key] = input.settings[key];
    }
    const legacySizes = { small: 80, medium: DEFAULT_PET_SIZE, large: 120 };
    const savedSize = input.settings?.size;
    if (typeof savedSize === 'string' && Object.hasOwn(legacySizes, savedSize)) settings.size = legacySizes[savedSize];
    const position = input.position;
    const activity = Array.isArray(input.activity)
        ? input.activity.filter((entry) => entry && typeof entry.text === 'string'
            && ['adopt', 'pet', 'feed', 'play', 'sleep', 'wake', 'rename'].includes(entry.type)
            && Number.isFinite(entry.at) && entry.at >= 0 && entry.at <= now)
            .slice(0, MAX_ACTIVITY)
            .map((entry) => ({ type: entry.type, at: entry.at, text: entry.text.slice(0, 160) }))
        : defaults.activity;
    return {
        ...defaults,
        name: cleanName(input.name),
        adoptedAt: clamp(finiteOr(input.adoptedAt, now), 0, now),
        updatedAt: clamp(finiteOr(input.updatedAt, now), 0, now),
        fullness: clamp(finiteOr(input.fullness, defaults.fullness)),
        happiness: clamp(finiteOr(input.happiness, defaults.happiness)),
        energy: clamp(finiteOr(input.energy, defaults.energy)),
        sleeping: typeof input.sleeping === 'boolean' ? input.sleeping : false,
        affection: clamp(finiteOr(input.affection, 0), 0, 1000000),
        interactions: Math.floor(clamp(finiteOr(input.interactions, 0), 0, 1000000)),
        playStats: Object.fromEntries(['fetch', 'ball', 'bubbles'].map((mode) => [mode,
            Math.floor(clamp(finiteOr(input.playStats?.[mode], 0), 0, 1000000)),
        ])),
        settings,
        position: position && Number.isFinite(position.x) && Number.isFinite(position.y)
            ? { x: Math.round(clamp(position.x, -100000, 100000)), y: Math.round(clamp(position.y, -100000, 100000)) }
            : null,
        activity,
    };
}

function advanceState(state, now = Date.now()) {
    const elapsedHours = clamp(now - state.updatedAt, 0, MAX_OFFLINE_TIME) / HOUR;
    return {
        ...state,
        updatedAt: now,
        fullness: clamp(state.fullness - elapsedHours * (state.sleeping ? 2 : 4)),
        happiness: clamp(state.happiness - elapsedHours * (state.sleeping ? 1 : 3)),
        energy: clamp(state.energy + elapsedHours * (state.sleeping ? 18 : -5)),
    };
}

function addActivity(state, type, text, now) {
    return [{ type, text, at: now }, ...state.activity].slice(0, MAX_ACTIVITY);
}

function performAction(current, action, now = Date.now()) {
    const state = advanceState(current, now);
    let next = { ...state };
    let message;
    let behavior;
    let activity;
    if (action === 'pet') {
        next.happiness = clamp(state.happiness + 7);
        next.affection += 1;
        message = state.sleeping ? 'Dreaming of you. Zzz…'
            : state.settings.species === 'cat' ? 'Prrr… making biscuits just for you. ♥' : 'My favorite human. ♥';
        behavior = state.sleeping ? 'sleeping' : 'petting';
        activity = state.settings.species === 'cat'
            ? 'A few chin scratches. Soft purrs and kneading paws.' : 'A few head scratches. A very happy pup.';
    } else if (action === 'feed') {
        if (state.sleeping) throw new Error('Let your friend wake up before snack time.');
        if (state.fullness >= 98) throw new Error('A happy, full tummy! Save a treat for later.');
        next.fullness = clamp(state.fullness + 22);
        next.energy = clamp(state.energy + 3);
        next.affection += 2;
        message = 'A treat? For me? Nom nom!';
        behavior = 'eating';
        activity = 'A tasty treat, served with love.';
    } else if (action === 'play') {
        throw new Error('Choose a desktop game. Happiness is earned by actually playing together.');
    } else if (action === 'sleep' || action === 'wake') {
        const sleeping = action === 'sleep';
        if (sleeping === state.sleeping) throw new Error(sleeping ? 'Already dreaming away.' : 'Already wide awake!');
        next.sleeping = sleeping;
        message = sleeping ? 'Just five more minutes…' : 'Hello again, world!';
        behavior = sleeping ? 'sleeping' : 'idle';
        activity = sleeping ? 'Curled up for a well-earned nap.' : 'Fresh paws. Ready for a new adventure.';
    } else {
        throw new Error('That pet action is not available.');
    }
    if (['pet', 'feed'].includes(action)) next.interactions += 1;
    next.activity = addActivity(state, action, activity, now);
    return { state: next, message, behavior };
}

function ensureCanPlay(state) {
    if (state.sleeping) throw new Error('Your friend is napping. Wake them up to play.');
    if (state.energy < 12) throw new Error('A little nap first, then more adventures.');
}

function rewardPlay(current, mode, now = Date.now()) {
    const rewards = {
        fetch: { energy: 4, happiness: 8, affection: 2, text: 'A bone fetched and proudly brought back.', message: 'Fetched it! Another throw? 🦴' },
        ball: { energy: 5, happiness: 10, affection: 2, text: 'Chased a bouncing ball and nudged it back.', message: 'Your turn! That was a good rally. 🎾' },
        bubbles: { energy: 2, happiness: 5, affection: 1, text: 'Chased a floating bubble. Pop! One happy friend.', message: 'Pop! Did you see that? 🫧' },
    };
    if (!Object.hasOwn(rewards, mode)) throw new Error('Unknown pet game.');
    const state = advanceState(current, now);
    if (state.sleeping) throw new Error('Your friend is napping. Wake them up to play.');
    const reward = rewards[mode];
    return {
        state: {
            ...state,
            energy: clamp(state.energy - reward.energy),
            fullness: clamp(state.fullness - 1),
            happiness: clamp(state.happiness + reward.happiness),
            affection: state.affection + reward.affection,
            interactions: state.interactions + 1,
            playStats: { ...state.playStats, [mode]: Math.min(1000000, (state.playStats?.[mode] ?? 0) + 1) },
            activity: addActivity(state, 'play', reward.text, now),
        },
        message: reward.message,
    };
}

function updateSettings(state, patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid preferences.');
    for (const [key, value] of Object.entries(patch)) {
        if (!validSetting(key, value)) throw new Error(`Invalid preference: ${key}`);
    }
    return { ...state, settings: { ...state.settings, ...patch } };
}

function renamePet(state, value, now = Date.now()) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('Give your friend a name first.');
    const name = cleanName(value);
    if (name === state.name) return state;
    return {
        ...state,
        name,
        activity: addActivity(state, 'rename', `A new name, the same little friend: ${name}.`, now),
    };
}

function getMood(state) {
    if (state.sleeping) return { label: 'Dreaming', description: 'Recharging one little dream at a time.', key: 'sleeping' };
    if (state.energy < 25) return { label: 'Sleepy', description: 'A soft spot and a little nap would be lovely.', key: 'sleepy' };
    if (state.fullness < 30) return { label: 'Peckish', description: 'Someone is thinking about snack time.', key: 'hungry' };
    if (state.happiness < 40) return { label: 'Missing you', description: 'A little company would make their day.', key: 'lonely' };
    return { label: 'Happy as can be', description: 'Quite simply, happy to be here with you.', key: 'happy' };
}

function getFriendship(state) {
    if (state.affection >= 100) return { label: 'Best friends', progress: 100, next: 'A small dog. A very big friendship.' };
    if (state.affection >= 30) return { label: 'Good pals', progress: (state.affection - 30) / 70 * 100, next: 'Every little moment brings you closer.' };
    return { label: 'New friends', progress: state.affection / 30 * 100, next: 'The beginning of something lovely.' };
}

module.exports = {
    HOUR, MAX_OFFLINE_TIME, DEFAULT_SETTINGS, createState, normalizeState,
    advanceState, performAction, updateSettings, renamePet, getMood, getFriendship,
    ensureCanPlay, rewardPlay,
};
