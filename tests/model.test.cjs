const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    HOUR, createState, normalizeState, advanceState, performAction,
    updateSettings, renamePet, getMood, getFriendship,
    ensureCanPlay, rewardPlay,
} = require('../src/model.cjs');

const NOW = 1800000000000;

test('a new puppy has independent preferences and healthy defaults', () => {
    const first = createState(NOW);
    const second = createState(NOW);
    first.settings.coat = 'cloud';
    assert.equal(second.settings.coat, 'apricot');
    assert.equal(first.name, 'Mochi');
    assert.equal(first.settings.launchOnLogin, false);
    assert.equal(first.settings.size, 30);
    assert.equal(first.version, 2);
    assert.equal(first.position, null);
    assert.equal(first.activity[0].type, 'adopt');
});

test('normalization accepts only known, correctly typed saved values', () => {
    const restored = normalizeState({
        name: '  小狗\n  ',
        fullness: -200,
        happiness: 400,
        energy: 'full',
        sleeping: 'false',
        updatedAt: NOW + HOUR,
        adoptedAt: -1,
        affection: Infinity,
        interactions: -4,
        settings: { roaming: 'yes', alwaysOnTop: false, coat: 'rainbow', size: 'large', extra: true },
        position: { x: 10.7, y: -15.1 },
        activity: [{ type: 'pet', text: 'Hello', at: NOW }, { type: 'unknown', text: 'Oops', at: NOW }],
    }, NOW);
    assert.equal(restored.name, '小狗');
    assert.equal(restored.fullness, 0);
    assert.equal(restored.happiness, 100);
    assert.equal(restored.energy, 76);
    assert.equal(restored.sleeping, false);
    assert.equal(restored.updatedAt, NOW);
    assert.equal(restored.adoptedAt, 0);
    assert.equal(restored.affection, 0);
    assert.equal(restored.interactions, 0);
    assert.equal(restored.settings.roaming, true);
    assert.equal(restored.settings.alwaysOnTop, false);
    assert.equal(restored.settings.coat, 'apricot');
    assert.equal(restored.settings.size, 120);
    assert.equal(restored.settings.extra, undefined);
    assert.deepEqual(restored.position, { x: 11, y: -15 });
    assert.equal(restored.activity.length, 1);
    for (const invalid of [null, [], 4, 'bad']) {
        assert.deepEqual(normalizeState(invalid, NOW), createState(NOW));
    }
    assert.equal(normalizeState({ position: { x: null, y: 10 } }, NOW).position, null);
});

test('awake needs decay gently and elapsed time is counted only once', () => {
    const initial = createState(NOW);
    const later = advanceState(initial, NOW + HOUR);
    assert.equal(later.fullness, 78);
    assert.equal(later.happiness, 85);
    assert.equal(later.energy, 71);
    assert.deepEqual(advanceState(later, NOW + HOUR), later);
    assert.equal(initial.fullness, 82);
});

test('a long absence is capped at eight hours and a backwards clock never increases decay', () => {
    const initial = createState(NOW);
    const later = advanceState(initial, NOW + 24 * HOUR);
    assert.equal(later.fullness, 50);
    assert.equal(later.energy, 36);
    const backwards = advanceState(initial, NOW - HOUR);
    assert.equal(backwards.fullness, 82);
    assert.equal(backwards.energy, 76);
});

test('naps restore energy and still consume a little food', () => {
    const sleeping = performAction(createState(NOW), 'sleep', NOW).state;
    const rested = advanceState(sleeping, NOW + 2 * HOUR);
    assert.equal(rested.energy, 100);
    assert.equal(rested.fullness, 78);
    assert.equal(rested.happiness, 86);
    assert.equal(getMood(rested).key, 'sleeping');
    assert.throws(() => performAction(rested, 'feed', NOW + 2 * HOUR), /wake up/);
    assert.doesNotThrow(() => ensureCanPlay(rested));
    assert.throws(() => performAction(rested, 'sleep', NOW + 2 * HOUR), /Already/);
    const awake = performAction(rested, 'wake', NOW + 2 * HOUR);
    assert.equal(awake.state.sleeping, false);
    assert.equal(awake.behavior, 'idle');
});

test('head scratches add happiness, friendship and one interaction without mutating the input', () => {
    const initial = createState(NOW);
    const result = performAction(initial, 'pet', NOW);
    assert.equal(result.state.happiness, 95);
    assert.equal(result.state.affection, 1);
    assert.equal(result.state.interactions, 1);
    assert.equal(result.behavior, 'petting');
    assert.equal(initial.interactions, 0);
    const sleeping = { ...initial, sleeping: true };
    assert.equal(performAction(sleeping, 'pet', NOW).behavior, 'sleeping');
});

test('treats clamp fullness and refuse overfeeding', () => {
    const initial = createState(NOW);
    const fed = performAction(initial, 'feed', NOW);
    assert.equal(fed.state.fullness, 100);
    assert.equal(fed.state.energy, 79);
    assert.equal(fed.state.affection, 2);
    assert.equal(fed.behavior, 'eating');
    assert.throws(() => performAction(fed.state, 'feed', NOW), /full tummy/);
});

test('games remain available at any energy or sleep state without granting free rewards', () => {
    const initial = { ...createState(NOW), happiness: 50 };
    assert.doesNotThrow(() => ensureCanPlay(initial));
    for (const species of ['dog', 'cat']) {
        const pet = createState(NOW, species);
        for (const energy of [0, 1, 7.9, 11, 100]) {
            for (const sleeping of [false, true]) {
                for (const mode of Object.keys(pet.playStats)) {
                    assert.doesNotThrow(() => ensureCanPlay({ ...pet, energy, sleeping }, mode));
                }
            }
        }
    }
    assert.throws(() => performAction(initial, 'play', NOW), /Choose a desktop game/);
    assert.throws(() => performAction(initial, 'unknown', NOW), /not available/);
});

test('completed games grant distinct, bounded rewards and persistent counters', () => {
    const initial = { ...createState(NOW), happiness: 50 };
    const fetched = rewardPlay(initial, 'fetch', NOW);
    assert.equal(fetched.state.happiness, 58);
    assert.equal(fetched.state.energy, 72);
    assert.equal(fetched.state.fullness, 81);
    assert.equal(fetched.state.affection, 2);
    assert.equal(fetched.state.interactions, 1);
    assert.deepEqual(fetched.state.playStats, { fetch: 1, ball: 0, bubbles: 0 });
    assert.equal(fetched.state.activity[0].type, 'play');
    assert.equal(initial.playStats.fetch, 0);
    const rallied = rewardPlay(fetched.state, 'ball', NOW).state;
    const bubbled = rewardPlay(rallied, 'bubbles', NOW).state;
    assert.equal(bubbled.energy, 65);
    assert.equal(bubbled.happiness, 73);
    assert.deepEqual(bubbled.playStats, { fetch: 1, ball: 1, bubbles: 1 });
    assert.deepEqual(normalizeState(bubbled, NOW).playStats, bubbled.playStats);
    assert.equal(rewardPlay({ ...initial, happiness: 99, energy: 1 }, 'ball', NOW).state.energy, 0);
    assert.equal(rewardPlay({ ...initial, happiness: 99 }, 'ball', NOW).state.happiness, 100);
    assert.throws(() => rewardPlay(initial, 'unknown', NOW), /not available for your dog/);
    assert.throws(() => rewardPlay({ ...initial, sleeping: true }, 'fetch', NOW), /napping/);
});

test('old saves gain game counters and invalid saved counters are sanitized', () => {
    assert.deepEqual(normalizeState({}, NOW).playStats, { fetch: 0, ball: 0, bubbles: 0 });
    const restored = normalizeState({ playStats: { fetch: -10, ball: 3.7, bubbles: Infinity, extra: 5 } }, NOW);
    assert.deepEqual(restored.playStats, { fetch: 0, ball: 3, bubbles: 0 });
});

test('old default sizes migrate to 30 percent without losing puppy progress', () => {
    const saved = {
        ...createState(NOW),
        version: 1,
        name: '豆豆',
        affection: 42,
        playStats: { fetch: 9, ball: 2, bubbles: 3 },
        settings: { ...createState(NOW).settings, coat: 'cloud', size: 'medium' },
    };
    const migrated = normalizeState(saved, NOW);
    assert.equal(migrated.version, 2);
    assert.equal(migrated.settings.size, 30);
    assert.equal(migrated.settings.coat, 'cloud');
    assert.equal(migrated.name, '豆豆');
    assert.equal(migrated.affection, 42);
    assert.deepEqual(migrated.playStats, saved.playStats);
    assert.equal(saved.settings.size, 'medium');
    assert.equal(normalizeState({ settings: { size: 'small' } }, NOW).settings.size, 80);
    assert.equal(normalizeState({ settings: { size: 'large' } }, NOW).settings.size, 120);
    assert.equal(normalizeState({ settings: {} }, NOW).settings.size, 30);
    assert.equal(normalizeState({ settings: { size: 43 } }, NOW).settings.size, 43);
    assert.equal(normalizeState({ settings: { size: 500 } }, NOW).settings.size, 30);
    assert.deepEqual(normalizeState(migrated, NOW), migrated);
});

test('activity history remains bounded', () => {
    let state = createState(NOW);
    for (let count = 0; count < 20; count += 1) state = performAction(state, 'pet', NOW + count).state;
    assert.equal(state.activity.length, 12);
    assert.equal(state.activity[0].at, NOW + 19);
    assert.equal(state.interactions, 20);
});

test('preferences reject unknown keys and invalid values atomically', () => {
    const initial = createState(NOW);
    const updated = updateSettings(initial, { coat: 'cloud', roaming: false, size: 120 });
    assert.equal(updated.settings.coat, 'cloud');
    assert.equal(updated.settings.roaming, false);
    assert.equal(updated.settings.size, 120);
    assert.equal(initial.settings.size, 30);
    assert.equal(initial.settings.coat, 'apricot');
    for (const patch of [{ unknown: true }, { roaming: 'false' }, { size: 'huge' }, { size: 'medium' }, { size: 19 }, { size: 151 }, { size: 30.5 }, null, [], { coat: 'cocoa', extra: true }]) {
        assert.throws(() => updateSettings(initial, patch), /Invalid preference/);
    }
});

test('cats have their own defaults and accept only their own appearance settings', () => {
    const cat = createState(NOW, 'cat');
    assert.equal(cat.settings.species, 'cat');
    assert.equal(cat.settings.catPose, 'sitting');
    assert.equal(cat.settings.coat, undefined);
    assert.equal(cat.settings.accessory, undefined);
    assert.equal(cat.settings.roaming, false);
    assert.equal(cat.settings.size, 30);
    assert.equal(cat.name, 'My cat');
    assert.deepEqual(cat.playStats, { pounce: 0, bubbles: 0, teaser: 0 });
    assert.deepEqual(normalizeState(cat, NOW), cat);
    const loaf = updateSettings(cat, { catPose: 'loaf', size: 43 });
    assert.equal(loaf.settings.catPose, 'loaf');
    assert.equal(loaf.settings.size, 43);
    assert.equal(cat.settings.catPose, 'sitting');
    for (const patch of [{ coat: 'cocoa' }, { accessory: 'collar' }, { species: 'dog' }, { catPose: 'unknown' }]) {
        assert.throws(() => updateSettings(cat, patch), /Invalid preference/);
    }
    assert.throws(() => updateSettings(createState(NOW), { species: 'cat' }), /Invalid preference/);
    const cleaned = normalizeState({ ...cat, settings: { ...cat.settings, coat: 'cloud', accessory: 'collar' }, playStats: { fetch: 8, ball: 7, pounce: 2, bubbles: 3 } }, NOW);
    assert.equal(cleaned.settings.coat, undefined);
    assert.equal(cleaned.settings.accessory, undefined);
    assert.deepEqual(cleaned.playStats, { pounce: 2, bubbles: 3, teaser: 0 });
});

test('old saves stay dogs and invalid companion preferences are rejected', () => {
    const legacy = { settings: { coat: 'cloud', accessory: 'collar', size: 'medium' } };
    const restored = normalizeState(legacy, NOW);
    assert.equal(restored.settings.species, 'dog');
    assert.equal(restored.settings.catPose, undefined);
    assert.equal(restored.settings.accessory, 'collar');
    assert.equal(restored.settings.size, 30);
    assert.equal(normalizeState({ settings: { species: 'fox', catPose: true } }, NOW).settings.species, 'dog');
    assert.equal(normalizeState({ settings: { species: 'cat', catPose: 'unknown' } }, NOW).settings.catPose, 'sitting');
    for (const patch of [{ species: 'fox' }, { species: true }, { catPose: 'unknown' }, { species: 'cat', catPose: null }]) {
        assert.throws(() => updateSettings(restored, patch), /Invalid preference/);
        assert.equal(restored.settings.species, 'dog');
    }
});

test('cats receive chin scratches and cat snacks without dog-specific care', () => {
    const cat = createState(NOW, 'cat');
    const petted = performAction(cat, 'pet', NOW);
    assert.equal(petted.behavior, 'petting');
    assert.match(petted.message, /Prrr/);
    assert.match(petted.state.activity[0].text, /chin scratch/);
    assert.doesNotMatch(petted.state.activity[0].text, /belly|puppy|bone/);
    assert.equal(petted.state.happiness, 93);
    assert.equal(petted.state.affection, 1);
    const fed = performAction({ ...cat, fullness: 50 }, 'feed', NOW);
    assert.equal(fed.behavior, 'eating');
    assert.equal(fed.state.fullness, 68);
    assert.equal(fed.state.energy, 78);
    assert.equal(fed.state.affection, 1);
    assert.match(fed.state.activity[0].text, /cat snack.*bowl/);
    const sleeping = performAction(cat, 'sleep', NOW);
    assert.equal(sleeping.behavior, 'sleeping');
    assert.equal(performAction(sleeping.state, 'pet', NOW).behavior, 'sleeping');
    assert.doesNotThrow(() => ensureCanPlay(sleeping.state));
    assert.throws(() => performAction(sleeping.state, 'feed', NOW), /wake up/);
});

test('cat play has independent rewards and allowed modes without an energy gate', () => {
    const cat = { ...createState(NOW, 'cat'), happiness: 50 };
    assert.doesNotThrow(() => ensureCanPlay({ ...cat, energy: 8 }, 'pounce'));
    assert.doesNotThrow(() => ensureCanPlay({ ...cat, energy: 0 }, 'pounce'));
    for (const mode of ['fetch', 'ball', 'unknown']) {
        assert.throws(() => ensureCanPlay(cat, mode), /not available for your cat/);
        assert.throws(() => rewardPlay(cat, mode, NOW), /not available for your cat/);
    }
    for (const mode of ['pounce', 'bubbles', 'teaser']) {
        const played = rewardPlay(cat, mode, NOW);
        assert.equal(played.state.settings.species, 'cat');
        assert.equal(played.state.playStats[mode], 1);
        assert.equal(played.state.energy, mode === 'pounce' ? 73 : 74);
        assert.equal(played.state.happiness, { pounce: 57, bubbles: 55, teaser: 56 }[mode]);
        assert.equal(played.state.affection, 1);
        assert.doesNotMatch(played.state.activity[0].text, /puppy|bone|fetch|return/);
    }
    assert.deepEqual(cat.playStats, { pounce: 0, bubbles: 0, teaser: 0 });
    assert.throws(() => rewardPlay(createState(NOW), 'pounce', NOW), /not available for your dog/);
});

test('cats have independent awake and sleeping needs', () => {
    const cat = createState(NOW, 'cat');
    const awake = advanceState(cat, NOW + HOUR);
    assert.equal(awake.fullness, 79);
    assert.equal(awake.happiness, 86);
    assert.equal(awake.energy, 73);
    const sleeping = advanceState({ ...cat, sleeping: true }, NOW + HOUR);
    assert.equal(sleeping.fullness, 80.5);
    assert.equal(sleeping.happiness, 87.5);
    assert.equal(sleeping.energy, 94);
    const absent = advanceState(cat, NOW + 24 * HOUR);
    assert.equal(absent.fullness, 58);
    assert.equal(absent.happiness, 72);
    assert.equal(absent.energy, 52);
});

test('renaming trims whitespace, limits Unicode code points, and stores plain text', () => {
    const initial = createState(NOW);
    assert.equal(renamePet(initial, '  豆豆  ', NOW).name, '豆豆');
    assert.equal(Array.from(renamePet(initial, '🐶'.repeat(22), NOW).name).length, 18);
    assert.equal(renamePet(initial, '<img src=x>', NOW).name, '<img src=x>');
    assert.equal(renamePet(initial, 'Mochi', NOW), initial);
    assert.throws(() => renamePet(initial, '  ', NOW), /name first/);
});

test('moods and friendship levels follow care state', () => {
    const initial = createState(NOW);
    assert.equal(getMood(initial).key, 'happy');
    assert.equal(getMood({ ...initial, energy: 5 }).key, 'sleepy');
    assert.equal(getMood({ ...initial, fullness: 5 }).key, 'hungry');
    assert.equal(getMood({ ...initial, happiness: 5 }).key, 'lonely');
    assert.equal(getFriendship(initial).label, 'New friends');
    assert.equal(getFriendship({ ...initial, affection: 30 }).label, 'Good pals');
    assert.equal(getFriendship({ ...initial, affection: 100 }).progress, 100);
});
