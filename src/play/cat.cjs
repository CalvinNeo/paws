const { BasePlaySession, clamp, distance } = require('./shared.cjs');

class CatPlaySession extends BasePlaySession {
    constructor(mode, petBounds, workArea) {
        super('cat', mode, petBounds, workArea);
    }

    releaseToy(origin, speed) {
        if (this.mode === 'pounce' && speed < 120) {
            const length = Math.max(1, distance(this.toy, origin));
            this.velocity = { x: (this.toy.x - origin.x) / length * 250, y: (this.toy.y - origin.y) / length * 250 };
        } else if (this.mode === 'bubbles') {
            this.velocity = { x: this.throws % 2 ? -30 : 30, y: -18 };
        }
        this.setPhase('watching');
    }

    step(elapsed) {
        const seconds = clamp(Number.isFinite(elapsed) ? elapsed : 0, 0, .05);
        this.phaseTime += seconds;
        const previousCompleted = this.completed;
        if (this.phase === 'watching') {
            this.bounceToy(seconds, this.mode === 'pounce' ? 1.7 : 0);
            if (this.phaseTime >= .42) this.setPhase('pouncing');
        } else if (this.phase === 'pouncing') {
            this.bounceToy(seconds, this.mode === 'pounce' ? 1.7 : 0);
            this.movePet(this.toy, seconds, this.mode === 'pounce' ? 360 : 300);
            if (distance(this.pet, this.toy) < 12) {
                if (this.mode === 'pounce') {
                    this.velocity = { x: this.direction * 260, y: -65 };
                    this.setPhase('batting');
                } else {
                    this.toy = this.nearby(this.pet);
                    this.completeRound();
                }
            }
        } else if (this.phase === 'batting') {
            this.bounceToy(seconds, 2.8);
            if (this.phaseTime >= .65) {
                this.velocity = { x: 0, y: 0 };
                this.completeRound();
            }
        } else if (this.phase === 'celebrating' && this.phaseTime >= .8) {
            this.setPhase('ready');
        }
        return this.completed > previousCompleted;
    }

    snapshot() {
        return {
            ...super.snapshot(),
            behavior: this.phase === 'pouncing' ? 'walking' : this.phase === 'batting' ? 'playing' : 'idle',
            carrying: null,
            toyVisible: this.mode !== 'bubbles' || this.phase !== 'celebrating',
        };
    }
}

module.exports = { CatPlaySession };
