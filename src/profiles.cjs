const { createState, normalizeState, advanceState } = require('./model.cjs');
const { COMPANIONS, getCompanion } = require('./companions/index.cjs');

function createProfiles(now = Date.now()) {
    return {
        version: 3,
        activeSpecies: 'dog',
        pets: { dog: createState(now, 'dog'), cat: createState(now, 'cat') },
    };
}

function normalizeProfiles(input, now = Date.now()) {
    const profiles = createProfiles(now);
    if (!input || typeof input !== 'object' || Array.isArray(input)) return profiles;
    if (input.version === 3 && input.pets && typeof input.pets === 'object' && !Array.isArray(input.pets)) {
        for (const species of Object.keys(COMPANIONS)) profiles.pets[species] = normalizeState(input.pets[species], now, species);
        if (Object.hasOwn(COMPANIONS, input.activeSpecies)) profiles.activeSpecies = input.activeSpecies;
    } else {
        profiles.pets.dog = normalizeState(input, now, 'dog');
        if (input.settings?.species === 'cat') {
            profiles.activeSpecies = 'cat';
            profiles.pets.cat = normalizeState({
                ...input,
                settings: { ...input.settings, roaming: false },
                activity: Array.isArray(input.activity) ? input.activity.filter((entry) => entry && entry.type !== 'play' && !/puppy|\bpup\b|bone|dog|belly rub/i.test(entry.text || '')) : undefined,
            }, now, 'cat');
        }
    }
    const launchOnLogin = profiles.pets[profiles.activeSpecies].settings.launchOnLogin;
    for (const pet of Object.values(profiles.pets)) pet.settings.launchOnLogin = launchOnLogin;
    return profiles;
}

function rememberProfile(profiles, state) {
    const species = state.settings.species;
    getCompanion(species);
    const pets = Object.fromEntries(Object.entries(profiles.pets).map(([candidate, pet]) => [candidate,
        candidate === species ? state : { ...pet, settings: { ...pet.settings, launchOnLogin: state.settings.launchOnLogin } },
    ]));
    return { ...profiles, activeSpecies: species, pets };
}

function switchProfile(profiles, state, species, now = Date.now()) {
    getCompanion(species);
    const saved = rememberProfile(profiles, advanceState(state, now));
    const next = advanceState(saved.pets[species], now);
    const selected = { ...next, settings: { ...next.settings, launchOnLogin: state.settings.launchOnLogin } };
    return { profiles: rememberProfile(saved, selected), state: selected };
}

module.exports = { createProfiles, normalizeProfiles, rememberProfile, switchProfile };
