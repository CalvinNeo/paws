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
    assert.equal(restored.settings.size, 'large');
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
    assert.throws(() => ensureCanPlay(rested), /napping/);
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

test('games require enough energy and old one-click play cannot grant free rewards', () => {
    const initial = { ...createState(NOW), happiness: 50 };
    assert.doesNotThrow(() => ensureCanPlay(initial));
    assert.throws(() => ensureCanPlay({ ...initial, energy: 11 }), /nap first/);
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
    assert.throws(() => rewardPlay(initial, 'unknown', NOW), /Unknown puppy game/);
    assert.throws(() => rewardPlay({ ...initial, sleeping: true }, 'fetch', NOW), /napping/);
});

test('old saves gain game counters and invalid saved counters are sanitized', () => {
    assert.deepEqual(normalizeState({}, NOW).playStats, { fetch: 0, ball: 0, bubbles: 0 });
    const restored = normalizeState({ playStats: { fetch: -10, ball: 3.7, bubbles: Infinity, extra: 5 } }, NOW);
    assert.deepEqual(restored.playStats, { fetch: 0, ball: 3, bubbles: 0 });
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
    const updated = updateSettings(initial, { coat: 'cloud', roaming: false, size: 'large' });
    assert.equal(updated.settings.coat, 'cloud');
    assert.equal(updated.settings.roaming, false);
    assert.equal(initial.settings.coat, 'apricot');
    for (const patch of [{ unknown: true }, { roaming: 'false' }, { size: 'huge' }, null, [], { coat: 'cocoa', extra: true }]) {
        assert.throws(() => updateSettings(initial, patch), /Invalid preference/);
    }
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
