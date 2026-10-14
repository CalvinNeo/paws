const { getCompanion, getGame } = require('../companions/index.cjs');

const TOY_SIZE = 96;

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function distance(first, second) {
    return Math.hypot(first.x - second.x, first.y - second.y);
}

function mouthPoint(bounds, species = 'dog') {
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height * getCompanion(species).playAnchor };
}

function toyHitTest(kind, point, size = TOY_SIZE) {
    const horizontal = point.x / size * 100;
    const vertical = point.y / size * 100;
    if (!Number.isFinite(horizontal) || !Number.isFinite(vertical)) return false;
    if (kind === 'ball' || kind === 'yarn' || kind === 'bubble') {
        return Math.hypot(horizontal - 50, vertical - 50) <= (kind === 'bubble' ? 32 : 28);
    }
    if (kind !== 'bone') return false;
    if (horizontal >= 22 && horizontal <= 78 && vertical >= 44 && vertical <= 56) return true;
    return [22, 78].some((centerX) => [34, 66].some((centerY) => Math.hypot(horizontal - centerX, vertical - centerY) <= 14));
}

class BasePlaySession {
    constructor(species, mode, petBounds, workArea) {
        this.game = getGame(species, mode);
        this.species = species;
        this.mode = mode;
        this.workArea = { ...workArea };
        this.petSize = { width: petBounds.width, height: petBounds.height };
        this.mouthRatio = getCompanion(species).playAnchor;
        const insetX = Math.max(petBounds.width / 2, TOY_SIZE / 2) + 4;
        const insetTop = Math.max(petBounds.height * this.mouthRatio, TOY_SIZE / 2) + 4;
        const insetBottom = Math.max(petBounds.height * (1 - this.mouthRatio), TOY_SIZE / 2) + 4;
        this.arena = {
            left: workArea.x + Math.min(insetX, workArea.width / 2),
            right: workArea.x + Math.max(workArea.width - insetX, workArea.width / 2),
            top: workArea.y + Math.min(insetTop, workArea.height / 2),
            bottom: workArea.y + Math.max(workArea.height - insetBottom, workArea.height / 2),
        };
        this.pet = this.constrain(mouthPoint(petBounds, species));
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
        return { x: clamp(point.x, this.arena.left, this.arena.right), y: clamp(point.y, this.arena.top, this.arena.bottom) };
    }

    nearby(point) {
        const midpoint = (this.arena.left + this.arena.right) / 2;
        const offset = Math.max(120, this.petSize.width * .65);
        return this.constrain({ x: point.x + (point.x > midpoint ? -offset : offset), y: point.y - 24 });
    }

    setPhase(phase) {
        this.phase = phase;
        this.phaseTime = 0;
    }

    beginDrag(cursor, now) {
        if (this.phase !== 'ready' || !Number.isFinite(cursor?.x) || !Number.isFinite(cursor?.y)) return false;
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
        const seconds = Math.max(.016, (now - first.at) / 1000);
        this.velocity = { x: (this.toy.x - first.x) / seconds, y: (this.toy.y - first.y) / seconds };
        const speed = Math.hypot(this.velocity.x, this.velocity.y);
        if (speed > 1500) {
            this.velocity.x *= 1500 / speed;
            this.velocity.y *= 1500 / speed;
        }
        if (distance(this.toy, origin) < 28 && this.game.toy !== 'bubble') {
            this.toy = origin;
            this.setPhase('ready');
            return false;
        }
        this.throws += 1;
        this.releaseToy(origin, speed);
        return true;
    }

    movePet(target, seconds, speed = 350) {
        const length = distance(this.pet, target);
        const step = Math.min(length, seconds * speed);
        if (length > .1) {
            if (Math.abs(target.x - this.pet.x) > 2) this.direction = target.x < this.pet.x ? -1 : 1;
            this.pet.x += (target.x - this.pet.x) / length * step;
            this.pet.y += (target.y - this.pet.y) / length * step;
        }
        return length <= step + 2;
    }

    bounceToy(seconds, friction) {
        const proposed = { x: this.toy.x + this.velocity.x * seconds, y: this.toy.y + this.velocity.y * seconds };
        if (proposed.x < this.arena.left || proposed.x > this.arena.right) this.velocity.x *= -.8;
        if (proposed.y < this.arena.top || proposed.y > this.arena.bottom) this.velocity.y *= -.8;
        this.toy = this.constrain(proposed);
        this.velocity.x *= Math.exp(-friction * seconds);
        this.velocity.y *= Math.exp(-friction * seconds);
    }

    completeRound() {
        this.completed += 1;
        this.setPhase('celebrating');
    }

    getPetBounds() {
        return { x: Math.round(this.pet.x - this.petSize.width / 2), y: Math.round(this.pet.y - this.petSize.height * this.mouthRatio), ...this.petSize };
    }

    snapshot() {
        return {
            mode: this.mode, species: this.species, toy: this.game.toy, label: this.game.label,
            instruction: this.game.instruction, phase: this.phase, completed: this.completed,
            throws: this.throws, direction: this.direction,
            interactive: this.phase === 'ready' || this.phase === 'held',
        };
    }
}

module.exports = { TOY_SIZE, BasePlaySession, clamp, distance, mouthPoint, toyHitTest };
