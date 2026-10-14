const dog = require('./dog.cjs');
const cat = require('./cat.cjs');

const COMPANIONS = Object.freeze({ dog, cat });

function getCompanion(species = 'dog') {
    if (!Object.hasOwn(COMPANIONS, species)) throw new Error('Unknown companion.');
    return COMPANIONS[species];
}

function getGame(species, mode) {
    const companion = getCompanion(species);
    if (!Object.hasOwn(companion.games, mode)) throw new Error(`This game is not available for your ${species}.`);
    return companion.games[mode];
}

module.exports = { COMPANIONS, getCompanion, getGame };
