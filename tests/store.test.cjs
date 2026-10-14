const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createState } = require('../src/model.cjs');
const { loadState, saveState } = require('../src/store.cjs');

function temporarySave(context) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pawpal-store-'));
    context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    return { directory, filename: path.join(directory, 'companion.json') };
}

test('a first launch creates a fresh puppy without an error', (context) => {
    const { filename } = temporarySave(context);
    assert.deepEqual(loadState(filename, 1000), { state: createState(1000), warning: null });
});

test('saves round-trip and do not leave a temporary file', (context) => {
    const { filename } = temporarySave(context);
    const state = { ...createState(1000), name: '豆豆', position: { x: -1500, y: 500 } };
    saveState(filename, state);
    assert.deepEqual(loadState(filename, 2000).state, state);
    assert.equal(fs.existsSync(`${filename}.tmp`), false);
    state.settings.coat = 'cocoa';
    saveState(filename, state);
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
    saveState(filename, createState(1000));
    assert.equal(loadState(filename, 2000).state.name, 'Mochi');
});
