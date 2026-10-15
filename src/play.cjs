const { getCompanion } = require('./companions/index.cjs');
const { DogPlaySession } = require('./play/dog.cjs');
const { CatPlaySession } = require('./play/cat.cjs');
const { TeaserPlaySession } = require('./play/teaser.cjs');
const { TOY_SIZE, toyHitTest, mouthPoint, toySizeForPet } = require('./play/shared.cjs');

class PlaySession {
    constructor(mode, petBounds, workArea, species = 'dog') {
        getCompanion(species);
        if (species === 'cat' && mode === 'teaser') return new TeaserPlaySession(petBounds, workArea);
        return species === 'cat' ? new CatPlaySession(mode, petBounds, workArea) : new DogPlaySession(mode, petBounds, workArea);
    }
}

module.exports = { TOY_SIZE, PlaySession, toyHitTest, mouthPoint, toySizeForPet };
