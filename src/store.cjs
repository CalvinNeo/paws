const fs = require('node:fs');
const path = require('node:path');
const { normalizeProfiles } = require('./profiles.cjs');

function loadedProfiles(input, now, warning = null) {
    const profiles = normalizeProfiles(input, now);
    return { state: profiles.pets[profiles.activeSpecies], profiles, warning };
}

function loadState(filename, now = Date.now()) {
    let contents;
    try {
        contents = fs.readFileSync(filename, 'utf8');
    } catch (error) {
        if (error.code === 'ENOENT') return loadedProfiles(null, now);
        throw error;
    }
    try {
        const input = JSON.parse(contents);
        if (input && typeof input === 'object' && input.version !== 3) {
            const backup = `${filename}.before-profiles-${now}`;
            if (!fs.existsSync(backup)) fs.copyFileSync(filename, backup, fs.constants.COPYFILE_EXCL);
        }
        return loadedProfiles(input, now);
    } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        const backup = `${filename}.corrupt-${now}`;
        fs.copyFileSync(filename, backup, fs.constants.COPYFILE_EXCL);
        return loadedProfiles(null, now, 'A damaged save was backed up. Your companions are starting fresh.');
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
