const { BasePlaySession, clamp, distance } = require('./shared.cjs');
const { CAT_PAW_CONTACT, catPawOffset } = require('../renderer/cat-animation.mjs');

const BAT_DURATION = .65;
const LAST_FRAME_HOLD = .05;
const SETTLE_DURATION = .35;

class CatPlaySession extends BasePlaySession {
    constructor(mode, petBounds, workArea) {
        super('cat', mode, petBounds, workArea);
        const scale = Math.pow(petBounds.width / 300, .65);
        this.runSpeed = 330 * scale;
        this.acceleration = this.runSpeed * 4;
        this.pounceRange = Math.max(18, petBounds.width * .26);
        this.contactRadius = clamp(petBounds.width * .045, 4, 14);
        this.petVelocity = { x: 0, y: 0 };
        this.motionAction = 'idle';
        this.motionTime = 0;
        this.motionDuration = 1;
        this.stride = 0;
        this.landingLift = 0;
        this.contacted = false;
    }

    setMotion(action, duration) {
        this.motionAction = action;
        this.motionTime = 0;
        this.motionDuration = duration;
    }

    faceToy() {
        const horizontal = this.toy.x - this.pet.x;
        if (Math.abs(horizontal) > Math.max(2, this.petSize.width * .025)) this.direction = Math.sign(horizontal);
    }

    pawPoint(point = this.pet, direction = this.direction) {
        const offset = catPawOffset(this.petSize, direction);
        return { x: point.x + offset.x, y: point.y + offset.y };
    }

    approachPoint(lead = 0) {
        const offset = catPawOffset(this.petSize, this.direction);
        return this.constrain({ x: this.toy.x + this.velocity.x * lead - offset.x, y: this.toy.y + this.velocity.y * lead - offset.y });
    }

    releaseToy(origin, speed) {
        if (this.mode === 'pounce' && speed < 120) {
            const length = Math.max(1, distance(this.toy, origin));
            this.velocity = { x: (this.toy.x - origin.x) / length * 250, y: (this.toy.y - origin.y) / length * 250 };
        } else if (this.mode === 'bubbles') {
            this.velocity = { x: this.throws % 2 ? -30 : 30, y: -18 };
        }
        this.contacted = false;
        this.landingLift = 0;
        this.setPhase('watching');
        this.setMotion('watch', .24);
    }

    moveCat(seconds, target = null, maximumSpeed = this.runSpeed) {
        const speed = Math.hypot(this.petVelocity.x, this.petVelocity.y);
        let desired = { x: 0, y: 0 };
        if (target) {
            const length = distance(this.pet, target);
            const arrivalSpeed = Math.min(maximumSpeed, Math.sqrt(2 * this.acceleration * Math.max(0, length - this.contactRadius * .2)));
            if (length > .001) desired = { x: (target.x - this.pet.x) / length * arrivalSpeed, y: (target.y - this.pet.y) / length * arrivalSpeed };
        }
        if (speed > 0) {
            const horizontalRoom = this.petVelocity.x > 0 ? this.arena.right - this.pet.x : this.pet.x - this.arena.left;
            const verticalRoom = this.petVelocity.y > 0 ? this.arena.bottom - this.pet.y : this.pet.y - this.arena.top;
            const distanceToWall = Math.min(
                Math.abs(this.petVelocity.x) > .001 ? horizontalRoom * speed / Math.abs(this.petVelocity.x) : Infinity,
                Math.abs(this.petVelocity.y) > .001 ? verticalRoom * speed / Math.abs(this.petVelocity.y) : Infinity,
            );
            if (distanceToWall <= speed * speed / (2 * this.acceleration) + speed * seconds) desired = { x: 0, y: 0 };
        }
        const change = { x: desired.x - this.petVelocity.x, y: desired.y - this.petVelocity.y };
        const length = Math.hypot(change.x, change.y);
        const fraction = length > 0 ? Math.min(1, this.acceleration * seconds / length) : 0;
        const nextVelocity = { x: this.petVelocity.x + change.x * fraction, y: this.petVelocity.y + change.y * fraction };
        const proposed = {
            x: this.pet.x + (this.petVelocity.x + nextVelocity.x) * .5 * seconds,
            y: this.pet.y + (this.petVelocity.y + nextVelocity.y) * .5 * seconds,
        };
        const next = this.constrain(proposed);
        if (next.x !== proposed.x) nextVelocity.x = 0;
        if (next.y !== proposed.y) nextVelocity.y = 0;
        this.stride = (this.stride + distance(this.pet, next) / (this.petSize.width * .55)) % 1;
        this.pet = next;
        this.petVelocity = nextVelocity;
    }

    touchesToy(previousPaw, previousToy) {
        const paw = this.pawPoint();
        const start = { x: previousPaw.x - previousToy.x, y: previousPaw.y - previousToy.y };
        const change = { x: paw.x - this.toy.x - start.x, y: paw.y - this.toy.y - start.y };
        const lengthSquared = change.x * change.x + change.y * change.y;
        const progress = lengthSquared > 0 ? clamp(-(start.x * change.x + start.y * change.y) / lengthSquared, 0, 1) : 0;
        return Math.hypot(start.x + change.x * progress, start.y + change.y * progress) <= this.contactRadius;
    }

    touchToy() {
        this.landingLift = this.motionLift();
        this.velocity = { x: 0, y: 0 };
        this.setPhase('batting');
        this.setMotion('bat', BAT_DURATION);
    }

    strikeToy() {
        if (this.contacted) return;
        this.contacted = true;
        if (this.mode === 'pounce') {
            const batSpeed = 260 * Math.pow(this.petSize.width / 300, .5);
            this.velocity = { x: this.direction * batSpeed, y: -batSpeed * .25 };
        } else {
            this.velocity = { x: 0, y: 0 };
        }
        this.completed += 1;
    }

    step(elapsed) {
        const seconds = clamp(Number.isFinite(elapsed) ? elapsed : 0, 0, .05);
        const previousCompleted = this.completed;
        const frames = Math.ceil(seconds / (1 / 120));
        for (let frame = 0; frame < frames; frame += 1) this.advance(seconds / frames);
        return this.completed > previousCompleted;
    }

    advance(seconds) {
        this.phaseTime += seconds;
        this.motionTime += seconds;
        if (this.phase === 'ready' || this.phase === 'held') {
            this.faceToy();
        } else if (this.phase === 'watching') {
            this.bounceToy(seconds, this.mode === 'pounce' ? 1.7 : 0);
            if (this.phaseTime >= .1) this.faceToy();
            if (this.phaseTime >= .24 && this.motionAction === 'watch') this.setMotion('crouch', .18);
            if (this.phaseTime >= .42) {
                this.setPhase('pouncing');
                this.setMotion('run', Math.max(.2, distance(this.pet, this.toy) / this.runSpeed));
            }
        } else if (this.phase === 'pouncing') {
            const previousToy = { ...this.toy };
            this.bounceToy(seconds, this.mode === 'pounce' ? 1.7 : 0);
            this.faceToy();
            const previousPaw = this.pawPoint();
            const reach = distance(previousPaw, this.toy);
            if (this.motionAction === 'run' && reach <= this.pounceRange) {
                const speed = Math.max(this.runSpeed * .7, Math.hypot(this.petVelocity.x, this.petVelocity.y));
                this.setMotion('pounce', clamp((reach - this.contactRadius) / speed, .14, .32));
            }
            this.moveCat(seconds, this.approachPoint(.06), this.runSpeed * (this.motionAction === 'pounce' ? 1.15 : 1));
            if (this.motionAction === 'pounce' && this.motionTime >= .04 && this.touchesToy(previousPaw, previousToy)) {
                this.touchToy();
            } else if (this.motionAction === 'pounce' && this.motionTime >= .4) {
                this.setMotion('run', Math.max(.2, distance(this.pet, this.toy) / this.runSpeed));
            }
        } else if (this.phase === 'batting') {
            if (this.contacted) {
                this.bounceToy(seconds, 2.8);
                this.moveCat(seconds);
            } else {
                this.moveCat(seconds, this.approachPoint(), this.runSpeed * .2);
                if (this.motionTime >= BAT_DURATION * CAT_PAW_CONTACT.impactProgress && distance(this.pawPoint(), this.toy) <= this.contactRadius) this.strikeToy();
            }
            if (this.phaseTime >= BAT_DURATION + LAST_FRAME_HOLD) {
                this.velocity = { x: 0, y: 0 };
                this.landingLift = 0;
                if (this.contacted) {
                    this.setPhase('celebrating');
                    this.setMotion('settle', SETTLE_DURATION);
                } else {
                    this.setPhase('pouncing');
                    this.setMotion('run', Math.max(.2, distance(this.pet, this.toy) / this.runSpeed));
                }
            }
        } else if (this.phase === 'celebrating') {
            this.moveCat(seconds);
            if (this.phaseTime >= SETTLE_DURATION && Math.hypot(this.petVelocity.x, this.petVelocity.y) < .001) {
                if (this.mode === 'bubbles') this.toy = this.nearby(this.pet);
                this.setPhase('ready');
                this.landingLift = 0;
                this.setMotion('idle', 1);
            }
        }
    }

    motionLift() {
        if (this.motionAction === 'pounce') return Math.sin(Math.PI * clamp(this.motionTime / this.motionDuration, 0, 1));
        if (this.motionAction === 'bat' || this.motionAction === 'settle') return this.landingLift * Math.pow(Math.max(0, 1 - this.motionTime / .12), 2);
        return 0;
    }

    snapshot() {
        return {
            ...super.snapshot(),
            behavior: this.motionAction === 'run' ? 'walking' : ['pounce', 'bat'].includes(this.motionAction) ? 'playing' : 'idle',
            carrying: null,
            toyVisible: this.mode !== 'bubbles' || !this.contacted || !['batting', 'celebrating'].includes(this.phase),
            catMotion: {
                action: this.motionAction,
                progress: this.motionAction === 'idle' ? 0 : clamp(this.motionTime / this.motionDuration, 0, 1),
                speed: Math.hypot(this.petVelocity.x, this.petVelocity.y),
                stride: this.stride,
                lift: this.motionLift(),
                facing: this.direction,
                impactProgress: CAT_PAW_CONTACT.impactProgress,
                impacted: this.contacted ? 1 : 0,
            },
        };
    }
}

module.exports = { CatPlaySession };
