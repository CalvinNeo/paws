const { BasePlaySession, TOY_SIZE, clamp, distance } = require('./shared.cjs');

class DogPlaySession extends BasePlaySession {
    constructor(mode, petBounds, workArea) {
        super('dog', mode, petBounds, workArea);
    }

    releaseToy(origin, speed) {
        if (this.mode === 'fetch') {
            this.flightStart = { ...this.toy };
            this.flightEnd = this.constrain({ x: this.toy.x + this.velocity.x * .22, y: this.toy.y + this.velocity.y * .22 });
            this.setPhase('flying');
        } else if (this.mode === 'ball') {
            if (speed < 120) {
                const length = Math.max(1, distance(this.toy, origin));
                this.velocity = { x: (this.toy.x - origin.x) / length * 330, y: (this.toy.y - origin.y) / length * 330 };
            }
            this.setPhase('rolling');
        } else {
            this.velocity = { x: this.throws % 2 ? -38 : 38, y: -24 };
            this.setPhase('floating');
        }
    }

    completeRound() {
        this.toy = this.mode === 'bubbles' ? this.nearby(this.pet) : { ...this.home };
        super.completeRound();
    }

    step(elapsed) {
        const seconds = clamp(Number.isFinite(elapsed) ? elapsed : 0, 0, .05);
        this.phaseTime += seconds;
        const previousCompleted = this.completed;
        if (this.phase === 'flying') {
            const progress = Math.min(1, this.phaseTime / .65);
            const eased = 1 - (1 - progress) ** 2;
            const height = Math.min(75, Math.min(this.flightStart.y, this.flightEnd.y) - this.workArea.y - TOY_SIZE / 2);
            this.toy = {
                x: this.flightStart.x + (this.flightEnd.x - this.flightStart.x) * eased,
                y: this.flightStart.y + (this.flightEnd.y - this.flightStart.y) * eased - Math.sin(progress * Math.PI) * height,
            };
            if (progress === 1) this.setPhase('chasing');
        } else if (this.phase === 'chasing') {
            if (this.movePet(this.toy, seconds, 420)) this.setPhase('picking-up');
        } else if (this.phase === 'picking-up') {
            if (this.phaseTime >= .32) this.setPhase('returning');
        } else if (this.phase === 'returning') {
            if (this.movePet(this.home, seconds, 370)) this.completeRound();
        } else if (this.phase === 'rolling') {
            this.bounceToy(seconds, 1.35);
            this.movePet(this.toy, seconds, 390);
            if (this.phaseTime > .4 && distance(this.pet, this.toy) < 12) this.setPhase('nudging');
        } else if (this.phase === 'nudging') {
            const length = distance(this.toy, this.home);
            const step = Math.min(length, seconds * 440);
            if (length > .1) {
                this.toy.x += (this.home.x - this.toy.x) / length * step;
                this.toy.y += (this.home.y - this.toy.y) / length * step;
            }
            const arrived = this.movePet(this.toy, seconds, 360);
            if (length < 3 && arrived) this.completeRound();
        } else if (this.phase === 'floating') {
            this.bounceToy(seconds, 0);
            this.movePet(this.toy, seconds, 310);
            if (this.phaseTime > .45 && distance(this.pet, this.toy) < 14) this.completeRound();
        } else if (this.phase === 'celebrating' && this.phaseTime >= 1.15) {
            this.setPhase('ready');
        }
        return this.completed > previousCompleted;
    }

    snapshot() {
        const moving = ['chasing', 'returning', 'rolling', 'nudging', 'floating'].includes(this.phase);
        return {
            ...super.snapshot(),
            behavior: moving ? 'walking' : this.phase === 'celebrating' ? 'petting' : this.phase === 'picking-up' ? 'eating' : 'idle',
            carrying: this.phase === 'returning' ? 'bone' : null,
            toyVisible: !['returning', 'picking-up', 'celebrating'].includes(this.phase),
        };
    }
}

module.exports = { DogPlaySession };
