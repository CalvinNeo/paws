const fs = require('node:fs');
const path = require('node:path');
const { normalizeState, createState } = require('./model.cjs');

function loadState(filename, now = Date.now()) {
    let contents;
    try {
        contents = fs.readFileSync(filename, 'utf8');
    } catch (error) {
        if (error.code === 'ENOENT') return { state: createState(now), warning: null };
        throw error;
    }
    try {
        return { state: normalizeState(JSON.parse(contents), now), warning: null };
    } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        const backup = `${filename}.corrupt-${now}`;
        fs.copyFileSync(filename, backup, fs.constants.COPYFILE_EXCL);
        return {
            state: createState(now),
            warning: 'A damaged save was backed up. Your puppy is starting fresh.',
        };
    }
}

function saveState(filename, state) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    const temporary = `${filename}.tmp`;
    const descriptor = fs.openSync(temporary, 'w', 0o600);
    try {
        fs.writeFileSync(descriptor, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
        fs.fsyncSync(descriptor);
    } finally {
        fs.closeSync(descriptor);
    }
    fs.renameSync(temporary, filename);
}

module.exports = { loadState, saveState };
