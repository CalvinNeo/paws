const TOY_SIZE = 96;
const PLAY_MODES = Object.freeze({
    fetch: { label: 'Fetch a bone', toy: 'bone', instruction: 'Drag the bone and let go, or flick to throw. I’ll bring it back!' },
    ball: { label: 'Ball rally', toy: 'ball', instruction: 'Flick the ball. I’ll chase it and nudge it back to you!' },
    bubbles: { label: 'Bubble chase', toy: 'bubble', instruction: 'Tap a bubble to send it floating, or drag it somewhere new.' },
});

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function distance(first, second) {
    return Math.hypot(first.x - second.x, first.y - second.y);
}

function mouthPoint(bounds) {
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height * 0.61 };
}

function toyHitTest(kind, point, size = TOY_SIZE) {
    const horizontal = point.x / size * 100;
    const vertical = point.y / size * 100;
    if (!Number.isFinite(horizontal) || !Number.isFinite(vertical)) return false;
    if (kind === 'ball' || kind === 'bubble') {
        return Math.hypot(horizontal - 50, vertical - 50) <= (kind === 'ball' ? 28 : 32);
    }
    if (kind !== 'bone') return false;
    if (horizontal >= 22 && horizontal <= 78 && vertical >= 44 && vertical <= 56) return true;
    return [22, 78].some((centerX) => [34, 66].some((centerY) => Math.hypot(horizontal - centerX, vertical - centerY) <= 14));
}

class PlaySession {
    constructor(mode, petBounds, workArea) {
        if (!Object.hasOwn(PLAY_MODES, mode)) throw new Error('Choose one of the available pet games.');
        this.mode = mode;
        this.workArea = { ...workArea };
        this.petSize = { width: petBounds.width, height: petBounds.height };
        const insetX = Math.max(petBounds.width / 2, TOY_SIZE / 2) + 4;
        const insetTop = Math.max(petBounds.height * 0.61, TOY_SIZE / 2) + 4;
        const insetBottom = Math.max(petBounds.height * 0.39, TOY_SIZE / 2) + 4;
        this.arena = {
            left: workArea.x + Math.min(insetX, workArea.width / 2),
            right: workArea.x + Math.max(workArea.width - insetX, workArea.width / 2),
            top: workArea.y + Math.min(insetTop, workArea.height / 2),
            bottom: workArea.y + Math.max(workArea.height - insetBottom, workArea.height / 2),
        };
        this.pet = this.constrain(mouthPoint(petBounds));
        this.toy = this.nearby(this.pet);
        this.home = { ...this.toy };
        this.velocity = { x: 0, y: 0 };
        this.phase = 'ready';
        this.phaseTime = 0;
        this.completed = 0;
        this.throws = 0;
        this.direction = -1;
        this.drag = null;
    }

    constrain(point) {
        return {
            x: clamp(point.x, this.arena.left, this.arena.right),
            y: clamp(point.y, this.arena.top, this.arena.bottom),
        };
    }

    nearby(point) {
        const midpoint = (this.arena.left + this.arena.right) / 2;
        const offset = Math.max(120, this.petSize.width * 0.65);
        return this.constrain({ x: point.x + (point.x > midpoint ? -offset : offset), y: point.y - 24 });
    }

    setPhase(phase) {
        this.phase = phase;
        this.phaseTime = 0;
    }

    beginDrag(cursor, now) {
        if (this.phase !== 'ready') return false;
        if (!Number.isFinite(cursor?.x) || !Number.isFinite(cursor?.y)) return false;
        this.home = { ...this.toy };
        this.drag = {
            origin: { ...this.toy },
            offset: { x: cursor.x - this.toy.x, y: cursor.y - this.toy.y },
            samples: [{ ...this.toy, at: now }],
        };
        this.setPhase('held');
        return true;
    }

    moveDrag(cursor, now) {
        if (!this.drag || !Number.isFinite(cursor?.x) || !Number.isFinite(cursor?.y)) return;
        this.toy = this.constrain({ x: cursor.x - this.drag.offset.x, y: cursor.y - this.drag.offset.y });
        this.drag.samples.push({ ...this.toy, at: now });
        this.drag.samples = this.drag.samples.filter((sample) => now - sample.at <= 140).slice(-16);
    }

    endDrag(cursor, now, cancelled = false) {
        if (!this.drag) return false;
        this.moveDrag(cursor, now);
        const { origin, samples } = this.drag;
        this.drag = null;
        if (cancelled) {
            this.toy = origin;
            this.setPhase('ready');
            return false;
        }
        const first = samples[0];
        const seconds = Math.max(0.016, (now - first.at) / 1000);
        this.velocity = { x: (this.toy.x - first.x) / seconds, y: (this.toy.y - first.y) / seconds };
        const speed = Math.hypot(this.velocity.x, this.velocity.y);
        if (speed > 1500) {
            this.velocity.x *= 1500 / speed;
            this.velocity.y *= 1500 / speed;
        }
        if (distance(this.toy, origin) < 28 && this.mode !== 'bubbles') {
            this.toy = origin;
            this.setPhase('ready');
            return false;
        }
        this.throws += 1;
        if (this.mode === 'fetch') {
            this.flightStart = { ...this.toy };
            this.flightEnd = this.constrain({ x: this.toy.x + this.velocity.x * 0.22, y: this.toy.y + this.velocity.y * 0.22 });
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
        return true;
    }

    movePet(target, seconds, speed = 350) {
        const length = distance(this.pet, target);
        const step = Math.min(length, seconds * speed);
        if (length > 0.1) {
            if (Math.abs(target.x - this.pet.x) > 2) this.direction = target.x < this.pet.x ? -1 : 1;
            this.pet.x += (target.x - this.pet.x) / length * step;
            this.pet.y += (target.y - this.pet.y) / length * step;
        }
        return length <= step + 2;
    }

    bounceToy(seconds, friction) {
        const proposed = { x: this.toy.x + this.velocity.x * seconds, y: this.toy.y + this.velocity.y * seconds };
        if (proposed.x < this.arena.left || proposed.x > this.arena.right) this.velocity.x *= -0.8;
        if (proposed.y < this.arena.top || proposed.y > this.arena.bottom) this.velocity.y *= -0.8;
        this.toy = this.constrain(proposed);
        this.velocity.x *= Math.exp(-friction * seconds);
        this.velocity.y *= Math.exp(-friction * seconds);
    }

    completeRound() {
        this.completed += 1;
        this.toy = this.mode === 'bubbles' ? this.nearby(this.pet) : { ...this.home };
        this.setPhase('celebrating');
    }

    step(elapsed) {
        const seconds = clamp(Number.isFinite(elapsed) ? elapsed : 0, 0, 0.05);
        this.phaseTime += seconds;
        const previousCompleted = this.completed;
        if (this.phase === 'flying') {
            const progress = Math.min(1, this.phaseTime / 0.65);
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
            if (this.phaseTime >= 0.32) this.setPhase('returning');
        } else if (this.phase === 'returning') {
            if (this.movePet(this.home, seconds, 370)) this.completeRound();
        } else if (this.phase === 'rolling') {
            this.bounceToy(seconds, 1.35);
            this.movePet(this.toy, seconds, 390);
            if (this.phaseTime > 0.4 && distance(this.pet, this.toy) < 12) this.setPhase('nudging');
        } else if (this.phase === 'nudging') {
            const length = distance(this.toy, this.home);
            const step = Math.min(length, seconds * 440);
            if (length > 0.1) {
                this.toy.x += (this.home.x - this.toy.x) / length * step;
                this.toy.y += (this.home.y - this.toy.y) / length * step;
            }
            const arrived = this.movePet(this.toy, seconds, 360);
            if (length < 3 && arrived) this.completeRound();
        } else if (this.phase === 'floating') {
            this.bounceToy(seconds, 0);
            this.movePet(this.toy, seconds, 310);
            if (this.phaseTime > 0.45 && distance(this.pet, this.toy) < 14) this.completeRound();
        } else if (this.phase === 'celebrating' && this.phaseTime >= 1.15) {
            this.setPhase('ready');
        }
        return this.completed > previousCompleted;
    }

    getPetBounds() {
        return {
            x: Math.round(this.pet.x - this.petSize.width / 2),
            y: Math.round(this.pet.y - this.petSize.height * 0.61),
            ...this.petSize,
        };
    }

    snapshot() {
        const moving = ['chasing', 'returning', 'rolling', 'nudging', 'floating'].includes(this.phase);
        return {
            mode: this.mode,
            toy: PLAY_MODES[this.mode].toy,
            phase: this.phase,
            completed: this.completed,
            throws: this.throws,
            direction: this.direction,
            behavior: moving ? 'walking' : this.phase === 'celebrating' ? 'petting' : this.phase === 'picking-up' ? 'eating' : 'idle',
            carrying: this.phase === 'returning' ? 'bone' : null,
            interactive: this.phase === 'ready' || this.phase === 'held',
            toyVisible: !['returning', 'picking-up', 'celebrating'].includes(this.phase),
        };
    }
}

module.exports = { TOY_SIZE, PLAY_MODES, PlaySession, toyHitTest, mouthPoint };
