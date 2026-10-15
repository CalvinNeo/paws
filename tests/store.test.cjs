const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createState } = require('../src/model.cjs');
const { createProfiles, rememberProfile } = require('../src/profiles.cjs');
const { loadState, saveState } = require('../src/store.cjs');

function temporarySave(context) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pawpal-store-'));
    context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    return { directory, filename: path.join(directory, 'companion.json') };
}

test('a first launch creates a fresh puppy without an error', (context) => {
    const { filename } = temporarySave(context);
    assert.deepEqual(loadState(filename, 1000), { state: createState(1000), profiles: createProfiles(1000), warning: null });
});

test('saves round-trip and do not leave a temporary file', (context) => {
    const { filename } = temporarySave(context);
    const state = { ...createState(1000), name: '豆豆', position: { x: -1500, y: 500 } };
    saveState(filename, rememberProfile(createProfiles(1000), state));
    assert.deepEqual(loadState(filename, 2000).state, state);
    assert.equal(fs.existsSync(`${filename}.tmp`), false);
    state.settings.coat = 'cocoa';
    saveState(filename, rememberProfile(createProfiles(1000), state));
    assert.equal(loadState(filename, 2000).state.settings.coat, 'cocoa');
});

test('malformed saves are backed up before returning a fresh state', (context) => {
    const { filename } = temporarySave(context);
    fs.writeFileSync(filename, '{broken save');
    const result = loadState(filename, 3000);
    assert.match(result.warning, /backed up/);
    assert.equal(result.state.name, 'Mochi');
    assert.equal(fs.readFileSync(`${filename}.corrupt-3000`, 'utf8'), '{broken save');
    assert.equal(fs.readFileSync(filename, 'utf8'), '{broken save');
});

test('non-parse failures are not mistaken for damaged JSON', (context) => {
    const { directory } = temporarySave(context);
    assert.throws(() => loadState(directory), { code: 'EISDIR' });
});

test('save creates its own data directory', (context) => {
    const { directory } = temporarySave(context);
    const filename = path.join(directory, 'nested', 'companion.json');
    saveState(filename, createProfiles(1000));
    assert.equal(loadState(filename, 2000).state.name, 'Mochi');
});

test('both profiles and the selected companion survive an atomic save', (context) => {
    const { directory, filename } = temporarySave(context);
    const profiles = createProfiles(1000);
    profiles.activeSpecies = 'cat';
    profiles.pets.cat.name = '小猫';
    profiles.pets.cat.playStats.pounce = 3;
    profiles.pets.cat.settings.catPose = 'loaf';
    profiles.pets.dog.name = '小狗';
    profiles.pets.dog.playStats.fetch = 7;
    saveState(filename, profiles);
    const loaded = loadState(filename, 2000);
    assert.deepEqual(loaded.profiles, profiles);
    assert.deepEqual(loaded.state, profiles.pets.cat);
    assert.equal(loaded.warning, null);
    assert.deepEqual(fs.readdirSync(directory), ['companion.json']);
});

test('legacy progress is migrated only after making an untouched backup', (context) => {
    const { filename } = temporarySave(context);
    const legacy = { ...createState(1000), name: '豆豆', affection: 42, playStats: { fetch: 9, ball: 2, bubbles: 3 } };
    legacy.settings.species = 'cat';
    legacy.settings.catPose = 'loaf';
    const contents = `${JSON.stringify(legacy, null, 4)}\n`;
    fs.writeFileSync(filename, contents);
    const first = loadState(filename, 2000);
    assert.equal(first.profiles.version, 3);
    assert.equal(first.profiles.activeSpecies, 'cat');
    assert.deepEqual(first.profiles.pets.dog.playStats, legacy.playStats);
    assert.deepEqual(first.profiles.pets.cat.playStats, { pounce: 0, bubbles: 3, teaser: 0 });
    assert.equal(first.state.name, '豆豆');
    assert.equal(first.state.affection, 42);
    assert.equal(first.state.settings.catPose, 'loaf');
    assert.equal(fs.readFileSync(`${filename}.before-profiles-2000`, 'utf8'), contents);
    assert.equal(fs.readFileSync(filename, 'utf8'), contents);
    assert.deepEqual(loadState(filename, 2000), first);
    saveState(filename, first.profiles);
    const restored = loadState(filename, 3000);
    assert.deepEqual(restored.profiles, first.profiles);
    assert.equal(fs.existsSync(`${filename}.before-profiles-3000`), false);
    assert.equal(fs.readFileSync(`${filename}.before-profiles-2000`, 'utf8'), contents);
});
