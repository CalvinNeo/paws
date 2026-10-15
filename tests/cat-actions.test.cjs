const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createState, normalizeState, advanceState, performAction, updateSettings } = require('../src/model.cjs');

const NOW = 1800000000000;

test('an awake cat can stand without changing their chosen pose or receiving care rewards', () => {
    for (const catPose of ['sitting', 'loaf', 'relaxed', 'standing']) {
        const cat = updateSettings(createState(NOW, 'cat'), { catPose });
        const before = structuredClone(cat);
        const result = performAction(cat, 'stand', NOW);
        assert.equal(result.behavior, 'standing');
        assert.equal(typeof result.message, 'string');
        assert.ok(result.message.length > 0);
        assert.deepEqual(result.state, before);
        assert.deepEqual(cat, before);
    }
});

test('standing only applies normal elapsed care time, including at zero energy', () => {
    const cat = { ...createState(NOW, 'cat'), energy: 0, affection: 12, interactions: 7 };
    const later = NOW + 60000;
    const result = performAction(cat, 'stand', later);
    assert.equal(result.behavior, 'standing');
    assert.deepEqual(result.state, advanceState(cat, later));
    assert.equal(result.state.affection, 12);
    assert.equal(result.state.interactions, 7);
    assert.deepEqual(result.state.playStats, cat.playStats);
});

test('a sleeping cat must wake before standing and a rejected action leaves state intact', () => {
    const cat = { ...createState(NOW, 'cat'), sleeping: true };
    const before = structuredClone(cat);
    assert.throws(() => performAction(cat, 'stand', NOW), { message: 'Wake up first.' });
    assert.deepEqual(cat, before);
    const awake = performAction(cat, 'wake', NOW).state;
    assert.equal(performAction(awake, 'stand', NOW).behavior, 'standing');
});

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
