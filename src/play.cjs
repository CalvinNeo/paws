const { getCompanion } = require('./companions/index.cjs');
const { DogPlaySession } = require('./play/dog.cjs');
const { CatPlaySession } = require('./play/cat.cjs');
const { TOY_SIZE, toyHitTest, mouthPoint } = require('./play/shared.cjs');

class PlaySession {
    constructor(mode, petBounds, workArea, species = 'dog') {
        getCompanion(species);
        return species === 'cat' ? new CatPlaySession(mode, petBounds, workArea) : new DogPlaySession(mode, petBounds, workArea);
    }
}

module.exports = { TOY_SIZE, PlaySession, toyHitTest, mouthPoint };
