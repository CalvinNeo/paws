const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HOUR, createState, performAction, renamePet, updateSettings, rewardPlay } = require('../src/model.cjs');
const { createProfiles, normalizeProfiles, rememberProfile, switchProfile } = require('../src/profiles.cjs');

const NOW = 1800000000000;

test('new companions have independent objects, defaults and game counters', () => {
    const profiles = createProfiles(NOW);
    assert.equal(profiles.version, 3);
    assert.equal(profiles.activeSpecies, 'dog');
    assert.deepEqual(profiles.pets.dog, createState(NOW, 'dog'));
    assert.deepEqual(profiles.pets.cat, createState(NOW, 'cat'));
    profiles.pets.dog.settings.size = 43;
    profiles.pets.dog.activity[0].text = 'A puppy';
    profiles.pets.dog.playStats.bubbles = 6;
    assert.equal(profiles.pets.cat.settings.size, 30);
    assert.equal(profiles.pets.cat.activity[0].text, 'A little friendship begins.');
    assert.equal(profiles.pets.cat.playStats.bubbles, 0);
    assert.deepEqual(createProfiles(NOW).pets.dog, createState(NOW));
});

test('switching restores each name, care, sleep, appearance, position and game history', () => {
    const profiles = createProfiles(NOW);
    const initial = structuredClone(profiles);
    let dog = renamePet(profiles.pets.dog, '豆豆', NOW);
    dog = updateSettings(dog, { coat: 'cloud', accessory: 'collar', size: 43, reducedMotion: true, alwaysOnTop: false });
    dog = rewardPlay(dog, 'fetch', NOW).state;
    dog = performAction(dog, 'sleep', NOW).state;
    dog = { ...dog, position: { x: -800, y: 450 } };
    const selectedCat = switchProfile(profiles, dog, 'cat', NOW);
    assert.deepEqual(selectedCat.state, initial.pets.cat);
    let cat = renamePet(selectedCat.state, '小猫', NOW);
    cat = updateSettings(cat, { catPose: 'loaf', size: 65 });
    cat = performAction(cat, 'pet', NOW).state;
    cat = performAction(cat, 'feed', NOW).state;
    cat = rewardPlay(cat, 'pounce', NOW).state;
    cat = { ...cat, position: { x: 120, y: 250 } };
    const selectedDog = switchProfile(selectedCat.profiles, cat, 'dog', NOW);
    assert.deepEqual(selectedDog.state, dog);
    assert.equal(selectedDog.state.sleeping, true);
    assert.deepEqual(selectedDog.state.playStats, { fetch: 1, ball: 0, bubbles: 0 });
    const restoredCat = switchProfile(selectedDog.profiles, selectedDog.state, 'cat', NOW);
    assert.deepEqual(restoredCat.state, cat);
    assert.equal(restoredCat.state.sleeping, false);
    assert.deepEqual(restoredCat.state.playStats, { pounce: 1, bubbles: 0, teaser: 0 });
    assert.deepEqual(profiles, initial);
    assert.deepEqual(selectedCat.profiles.pets.cat, initial.pets.cat);
    assert.deepEqual(normalizeProfiles(restoredCat.profiles, NOW), restoredCat.profiles);
});

test('inactive companions advance their own clock and naps without double-counting time', () => {
    const profiles = createProfiles(NOW);
    const dog = performAction(profiles.pets.dog, 'sleep', NOW).state;
    const selectedCat = switchProfile(profiles, dog, 'cat', NOW + HOUR);
    assert.equal(selectedCat.profiles.pets.dog.energy, 94);
    assert.equal(selectedCat.state.energy, 73);
    assert.equal(selectedCat.state.fullness, 79);
    const selectedDog = switchProfile(selectedCat.profiles, selectedCat.state, 'dog', NOW + HOUR * 2);
    assert.equal(selectedDog.state.energy, 100);
    assert.equal(selectedDog.state.fullness, 78);
    assert.equal(selectedDog.profiles.pets.cat.energy, 70);
    assert.equal(selectedDog.profiles.pets.cat.fullness, 76);
    const sameTime = switchProfile(selectedDog.profiles, selectedDog.state, 'cat', NOW + HOUR * 2);
    assert.deepEqual(sameTime.state, selectedDog.profiles.pets.cat);
    const longAbsence = switchProfile(sameTime.profiles, sameTime.state, 'dog', NOW + HOUR * 26);
    assert.equal(longAbsence.state.fullness, 62);
    assert.equal(longAbsence.profiles.pets.cat.fullness, 52);
});

test('login is shared but other preferences remain per companion without mutating inputs', () => {
    const profiles = createProfiles(NOW);
    const initial = structuredClone(profiles);
    const dog = updateSettings(profiles.pets.dog, { launchOnLogin: true, size: 75, reducedMotion: true, roaming: false });
    const remembered = rememberProfile(profiles, dog);
    assert.equal(remembered.pets.cat.settings.launchOnLogin, true);
    assert.equal(remembered.pets.cat.settings.size, 30);
    assert.equal(remembered.pets.cat.settings.reducedMotion, false);
    const selectedCat = switchProfile(remembered, dog, 'cat', NOW);
    assert.equal(selectedCat.state.settings.launchOnLogin, true);
    const cat = updateSettings(selectedCat.state, { launchOnLogin: false, size: 65 });
    const selectedDog = switchProfile(selectedCat.profiles, cat, 'dog', NOW);
    assert.equal(selectedDog.state.settings.launchOnLogin, false);
    assert.equal(selectedDog.state.settings.size, 75);
    assert.equal(selectedDog.state.settings.reducedMotion, true);
    assert.equal(selectedDog.profiles.pets.cat.settings.size, 65);
    assert.deepEqual(profiles, initial);
});

test('legacy dog saves preserve progress and start a fresh, independent cat', () => {
    const legacy = {
        ...createState(NOW), version: 1, name: '豆豆', affection: 42,
        playStats: { fetch: 9, ball: 2, bubbles: 3 },
        settings: { coat: 'cocoa', accessory: 'collar', size: 'medium', launchOnLogin: true },
        position: { x: -500, y: 300 },
    };
    const copy = structuredClone(legacy);
    const profiles = normalizeProfiles(legacy, NOW);
    assert.equal(profiles.activeSpecies, 'dog');
    assert.equal(profiles.pets.dog.name, '豆豆');
    assert.equal(profiles.pets.dog.affection, 42);
    assert.equal(profiles.pets.dog.settings.size, 30);
    assert.equal(profiles.pets.dog.settings.coat, 'cocoa');
    assert.deepEqual(profiles.pets.dog.position, legacy.position);
    assert.deepEqual(profiles.pets.dog.playStats, legacy.playStats);
    assert.deepEqual(profiles.pets.cat, updateSettings(createState(NOW, 'cat'), { launchOnLogin: true }));
    assert.deepEqual(legacy, copy);
});

test('legacy active cats retain identity while dog games and belly-rub history stay out', () => {
    const legacy = {
        ...createState(NOW), name: '旧名字', affection: 42, sleeping: true,
        playStats: { fetch: 9, ball: 2, bubbles: 3 },
        settings: { ...createState(NOW).settings, species: 'cat', catPose: 'loaf', size: 43 },
        activity: [
            { type: 'pet', text: 'A few head scratches. A very happy pup.', at: NOW },
            { type: 'pet', text: 'A belly rub for a happy cat.', at: NOW },
            { type: 'play', text: 'A bone fetched and proudly brought back.', at: NOW },
            { type: 'sleep', text: 'Curled up for a well-earned nap.', at: NOW },
        ],
    };
    const copy = structuredClone(legacy);
    const profiles = normalizeProfiles(legacy, NOW);
    assert.equal(profiles.activeSpecies, 'cat');
    assert.equal(profiles.pets.cat.name, legacy.name);
    assert.equal(profiles.pets.cat.affection, 42);
    assert.equal(profiles.pets.cat.sleeping, true);
    assert.equal(profiles.pets.cat.settings.catPose, 'loaf');
    assert.equal(profiles.pets.cat.settings.size, 43);
    assert.equal(profiles.pets.cat.settings.roaming, false);
    assert.equal(profiles.pets.cat.settings.coat, undefined);
    assert.deepEqual(profiles.pets.cat.playStats, { pounce: 0, bubbles: 3, teaser: 0 });
    assert.deepEqual(profiles.pets.cat.activity, [legacy.activity[3]]);
    assert.deepEqual(profiles.pets.dog.playStats, legacy.playStats);
    assert.deepEqual(profiles.pets.dog.activity, legacy.activity);
    assert.deepEqual(legacy, copy);
    assert.deepEqual(normalizeProfiles(profiles, NOW), profiles);
});

test('invalid saved profiles are sanitized using the enclosing species, not copied across pets', () => {
    const profiles = normalizeProfiles({
        version: 3, activeSpecies: 'fox',
        pets: {
            dog: { name: 'Puppy', energy: -10, settings: { species: 'cat', catPose: 'loaf', launchOnLogin: true } },
            cat: { name: null, energy: 150, settings: { species: 'dog', coat: 'cocoa', catPose: 'loaf' }, playStats: { fetch: 100, pounce: 2.9, bubbles: -1 } },
        },
    }, NOW);
    assert.equal(profiles.activeSpecies, 'dog');
    assert.equal(profiles.pets.dog.settings.species, 'dog');
    assert.equal(profiles.pets.dog.settings.catPose, undefined);
    assert.equal(profiles.pets.dog.energy, 0);
    assert.equal(profiles.pets.cat.settings.species, 'cat');
    assert.equal(profiles.pets.cat.settings.coat, undefined);
    assert.equal(profiles.pets.cat.settings.catPose, 'loaf');
    assert.equal(profiles.pets.cat.settings.launchOnLogin, true);
    assert.equal(profiles.pets.cat.name, 'My cat');
    assert.equal(profiles.pets.cat.energy, 100);
    assert.deepEqual(profiles.pets.cat.playStats, { pounce: 2, bubbles: 0, teaser: 0 });
    const missingCat = normalizeProfiles({ version: 3, activeSpecies: 'cat', pets: { dog: { name: 'Saved puppy' } } }, NOW);
    assert.deepEqual(missingCat.pets.cat, createState(NOW, 'cat'));
    assert.equal(missingCat.pets.dog.name, 'Saved puppy');
    for (const invalid of [null, [], 'invalid', 7, { version: 3, pets: [] }]) {
        assert.deepEqual(normalizeProfiles(invalid, NOW), createProfiles(NOW));
    }
});

test('unknown companion switches fail without modifying either profile', () => {
    const profiles = createProfiles(NOW);
    const original = structuredClone(profiles);
    assert.throws(() => switchProfile(profiles, profiles.pets.dog, 'fox', NOW), /Unknown companion/);
    assert.deepEqual(profiles, original);
    const same = switchProfile(profiles, profiles.pets.dog, 'dog', NOW);
    assert.deepEqual(same.profiles, profiles);
    assert.deepEqual(same.state, profiles.pets.dog);
});
