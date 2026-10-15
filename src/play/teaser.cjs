const { CatPlaySession } = require('./cat.cjs');
const { clamp, distance } = require('./shared.cjs');
const { CAT_PAW_CONTACT } = require('../renderer/cat-animation.mjs');
const catProfile = require('../../assets/cat/poses.mjs').default;

const WATCH_DURATION = .45;
const PREPARE_DURATION = .4;
const JUMP_DURATION = .72;
const IMPACT_PROGRESS = .5;
const BAT_DURATION = .15;
const SETTLE_DURATION = .35;
const COOLDOWN = .3;

function ease(progress) {
    const amount = clamp(progress, 0, 1);
    return amount * amount * amount * (amount * (amount * 6 - 15) + 10);
}

function clipDuration(clip, fallback) {
    return Number.isFinite(clip?.fps) && clip.fps > 0 && Number.isInteger(clip.frames) && clip.frames > 1
        ? clamp((clip.frames - 1) / clip.fps, .2, 3) : fallback;
}

function pawContact(clip) {
    const contact = clip?.contact;
    if (!contact || !Number.isInteger(clip.frames) || clip.frames < 2
        || !Number.isInteger(contact.frame) || contact.frame <= 0 || contact.frame >= clip.frames - 1
        || ![contact.x, contact.y].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) return null;
    return { x: contact.x, y: contact.y, progress: contact.frame / (clip.frames - 1), window: 1 / (clip.frames - 1) };
}

class TeaserPlaySession extends CatPlaySession {
    constructor(petBounds, workArea, profile = catProfile) {
        super('teaser', petBounds, workArea);
        const clip = profile.animations?.['teaser-jump'];
        this.prototype = !clip;
        this.contact = clip ? pawContact(clip) : { x: CAT_PAW_CONTACT.x, y: CAT_PAW_CONTACT.y, progress: IMPACT_PROGRESS, window: 1 / 18 };
        this.containsJump = clip?.containsJump === true;
        this.canvasSize = { width: profile.width || 1280, height: profile.height || 1120 };
        this.watchDuration = clipDuration(profile.animations?.['teaser-watch'], WATCH_DURATION);
        this.prepareDuration = clipDuration(profile.animations?.['teaser-ready'], PREPARE_DURATION);
        this.jumpDuration = clipDuration(clip, JUMP_DURATION);
        this.movementThreshold = Math.max(4, this.petSize.width * .04);
        this.jumpRange = this.petSize.width * 1.15;
        this.jumpHeight = this.petSize.height * .32;
        this.lureRevision = 0;
        this.attemptRevision = 0;
        this.lurePosition = { ...this.toy };
        this.cooldown = 0;
        this.jump = null;
        this.cancelledAttempt = false;
        this.setMotion('watch', this.watchDuration);
    }

    constrainToy(point) {
        const inset = this.toySize / 2 + 4;
        return {
            x: clamp(point.x, this.workArea.x + inset, this.workArea.x + this.workArea.width - inset),
            y: clamp(point.y, this.workArea.y + inset, this.workArea.y + this.workArea.height - inset),
        };
    }

    pawOffset() {
        if (!this.contact) return { x: 0, y: 0 };
        const scale = Math.min(this.petSize.width * .88 / this.canvasSize.width, this.petSize.height * .86 / this.canvasSize.height);
        return {
            x: (this.contact.x - .5) * this.canvasSize.width * scale * this.direction,
            y: (this.contact.y - .925) * this.canvasSize.height * scale,
        };
    }

    pawPoint(point = this.pet) {
        if (!this.contact) return null;
        const offset = this.pawOffset();
        return { x: point.x + offset.x, y: point.y + offset.y };
    }

    beginDrag(cursor, now) {
        if (this.drag || !Number.isFinite(cursor?.x) || !Number.isFinite(cursor?.y)) return false;
        this.drag = {
            origin: { ...this.toy },
            offset: { x: cursor.x - this.toy.x, y: cursor.y - this.toy.y },
        };
        if (this.lureRevision === 0) this.lureRevision = 1;
        if (this.phase === 'ready' && this.cooldown === 0 && this.lureRevision > this.attemptRevision) this.startHunt();
        return true;
    }

    moveDrag(cursor, now) {
        if (!this.drag || !Number.isFinite(cursor?.x) || !Number.isFinite(cursor?.y)) return;
        this.toy = this.constrainToy({ x: cursor.x - this.drag.offset.x, y: cursor.y - this.drag.offset.y });
        if (distance(this.toy, this.lurePosition) >= this.movementThreshold) {
            this.lureRevision += 1;
            this.lurePosition = { ...this.toy };
        }
    }

    endDrag(cursor, now, cancelled = false) {
        if (!this.drag) return false;
        if (!cancelled) this.moveDrag(cursor, now);
        else {
            this.toy = { ...this.drag.origin };
            this.lurePosition = { ...this.toy };
            this.cancelledAttempt = true;
        }
        this.drag = null;
        this.attemptRevision = this.lureRevision;
        if (cancelled && this.phase === 'watching') this.waitForLure();
        return !cancelled;
    }

    startHunt() {
        this.attemptRevision = this.lureRevision;
        this.cancelledAttempt = false;
        this.contacted = false;
        this.throws += 1;
        this.faceToy();
        this.setPhase('watching');
        this.setMotion('watch', this.watchDuration);
    }

    launch() {
        this.attemptRevision = this.lureRevision;
        this.faceToy();
        const offset = this.pawOffset();
        const height = this.containsJump ? 0 : Math.max(0, Math.min(this.jumpHeight, this.arena.bottom - (this.toy.y - offset.y)));
        const desired = this.constrain({ x: this.toy.x - offset.x, y: this.toy.y - offset.y + height });
        const length = distance(this.pet, desired);
        const fraction = length > 0 ? Math.min(1, this.jumpRange / length) : 0;
        this.jump = {
            origin: { ...this.pet },
            destination: {
                x: this.pet.x + (desired.x - this.pet.x) * fraction,
                y: this.pet.y + (desired.y - this.pet.y) * fraction,
            },
            height,
        };
        this.setPhase('pouncing');
        this.setMotion('pounce', this.jumpDuration);
    }

    moveJump(seconds) {
        const progress = clamp(this.motionTime / this.jumpDuration, 0, 1);
        const impact = this.contact?.progress ?? IMPACT_PROGRESS;
        const travel = ease(progress / impact);
        const previous = this.pet;
        this.pet = this.constrain({
            x: this.jump.origin.x + (this.jump.destination.x - this.jump.origin.x) * travel,
            y: this.jump.origin.y + (this.jump.destination.y - this.jump.origin.y) * travel - this.jump.height * this.jumpLift(progress),
        });
        this.petVelocity = { x: (this.pet.x - previous.x) / seconds, y: (this.pet.y - previous.y) / seconds };
        if (progress === 1) this.petVelocity = { x: 0, y: 0 };
        if (this.contact && !this.cancelledAttempt && !this.contacted && progress >= impact && progress < impact + this.contact.window
            && distance(this.pawPoint(), this.toy) <= this.contactRadius) {
            this.contacted = true;
            this.completed += 1;
        }
    }

    waitForLure() {
        this.petVelocity = { x: 0, y: 0 };
        this.jump = null;
        this.cooldown = COOLDOWN;
        if (!this.drag) this.attemptRevision = this.lureRevision;
        this.setPhase('ready');
        this.setMotion('watch', this.watchDuration);
    }

    advance(seconds) {
        this.phaseTime += seconds;
        this.motionTime += seconds;
        this.cooldown = Math.max(0, this.cooldown - seconds);
        if (this.phase === 'ready') {
            this.faceToy();
            if (this.drag && this.cooldown === 0 && this.lureRevision > this.attemptRevision) this.startHunt();
        } else if (this.phase === 'watching') {
            this.faceToy();
            if (this.motionAction === 'watch' && this.motionTime >= this.watchDuration) this.setMotion('crouch', this.prepareDuration);
            else if (this.motionAction === 'crouch' && this.motionTime >= this.prepareDuration) this.launch();
        } else if (this.phase === 'pouncing') {
            this.moveJump(seconds);
            if (this.motionTime >= this.jumpDuration) {
                if (this.contacted) {
                    this.setPhase('batting');
                    this.setMotion('bat', BAT_DURATION);
                } else {
                    this.setPhase('celebrating');
                    this.setMotion('settle', SETTLE_DURATION);
                }
            }
        } else if (this.phase === 'batting' && this.motionTime >= BAT_DURATION) {
            this.setPhase('celebrating');
            this.setMotion('settle', SETTLE_DURATION);
        } else if (this.phase === 'celebrating' && this.motionTime >= SETTLE_DURATION) this.waitForLure();
    }

    jumpLift(progress) {
        const impact = this.contact?.progress ?? IMPACT_PROGRESS;
        const heightProgress = progress <= impact ? progress / impact : (1 - progress) / (1 - impact);
        return Math.sin(Math.PI / 2 * clamp(heightProgress, 0, 1)) ** 2;
    }

    motionLift() {
        return this.motionAction === 'pounce' ? this.jumpLift(clamp(this.motionTime / this.jumpDuration, 0, 1)) : 0;
    }

    snapshot() {
        const snapshot = super.snapshot();
        const action = this.motionAction;
        const progress = this.phase === 'ready' ? 0 : action === 'bat' ? 1 : snapshot.catMotion.progress;
        return {
            ...snapshot,
            interactive: true,
            dragging: Boolean(this.drag),
            teaserStage: this.phase === 'ready' ? 'waiting'
                : ({ watch: 'observing', crouch: 'preparing', pounce: 'jumping', bat: 'contact', settle: 'recovering' })[action],
            catMotion: {
                ...snapshot.catMotion,
                progress,
                impactProgress: this.contact?.progress ?? IMPACT_PROGRESS,
                contactReady: this.contact && !this.prototype ? 1 : 0,
                prototype: this.prototype ? 1 : 0,
                clip: action === 'crouch' ? 'teaser-ready' : ['pounce', 'bat'].includes(action) ? 'teaser-jump' : 'teaser-watch',
                clipProgress: action === 'bat' ? 1 : progress,
                jumpHeight: this.jump?.height ?? 0,
            },
        };
    }
}

module.exports = { TeaserPlaySession };
