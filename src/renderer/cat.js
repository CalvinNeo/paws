import profile from '../../assets/cat/poses.mjs';
import { photoPoint, alphaHit } from './photo-hit.mjs';
import { selectCatAnimation, sampleCatClip, catAtlasFrame, catPhaseTime, canMirrorCat, catPlaybackRate, advanceCatTime, catTransform } from './cat-animation.mjs';
import { sampleStandingMotion, drawStandingPhoto } from './cat-standing.mjs';

const images = new Map();
const CACHE_LIMIT = 3;
const WIDTH = profile.width || 1280;
const HEIGHT = profile.height || 1120;
const CROSSFADE_MS = 100;
const TRACKED_ACTIONS = { groom: 'grooming', eat: 'eating' };

function loadImage(file, prefetch = false) {
    const cached = images.get(file);
    if (cached) {
        if (!prefetch) cached.prefetch = false;
        images.delete(file);
        images.set(file, cached);
        return cached.promise;
    }
    if (images.size >= CACHE_LIMIT) {
        const disposable = [...images].find(([, entry]) => entry.prefetch || entry.loaded);
        if (prefetch && !disposable) return Promise.resolve(null);
        const [key, entry] = disposable || images.entries().next().value;
        images.delete(key);
        if (!entry.loaded) entry.cancel();
    }
    const image = new Image();
    const entry = { image, loaded: false, prefetch };
    entry.promise = new Promise((resolve, reject) => {
        entry.cancel = () => {
            image.onload = null;
            image.onerror = null;
            image.src = '';
            resolve(null);
        };
        image.onload = () => {
            entry.loaded = true;
            image.onload = null;
            image.onerror = null;
            resolve(image);
        };
        image.onerror = () => {
            if (images.get(file) === entry) images.delete(file);
            reject(new Error(`The cat asset ${file} is unavailable.`));
        };
        image.decoding = 'async';
        image.src = new URL(`../../assets/cat/${file}`, import.meta.url).href;
    });
    images.set(file, entry);
    return entry.promise;
}

class SilverCat extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' }).innerHTML = `
            <style>
                :host { display: block; width: 100%; height: 100%; }
                canvas { display: block; width: 100%; height: 100%; object-fit: contain; pointer-events: auto; }
                .unavailable { display: none; color: #65705d; font: 12px system-ui, sans-serif; text-align: center; }
                :host([asset-error]) canvas { display: none; }
                :host([asset-error]) .unavailable { display: block; }
            </style>
            <canvas width="${WIDTH}" height="${HEIGHT}" aria-hidden="true"></canvas>
            <span class="unavailable">Cat photos unavailable.<br>Switch to Puppy in the pet menu.</span>`;
        this.canvas = this.shadowRoot.querySelector('canvas');
        this.context = this.canvas.getContext('2d');
        this.maskWidth = Math.min(WIDTH, 384);
        this.maskHeight = Math.round(this.maskWidth * HEIGHT / WIDTH);
        this.maskCanvas = document.createElement('canvas');
        this.maskCanvas.width = this.maskWidth;
        this.maskCanvas.height = this.maskHeight;
        this.maskContext = this.maskCanvas.getContext('2d', { willReadFrequently: true });
        this.foreground = document.createElement('canvas');
        this.foreground.width = WIDTH;
        this.foreground.height = HEIGHT;
        this.foregroundContext = this.foreground.getContext('2d');
        this.mask = null;
        this.ready = Promise.resolve();
        this.frameVersion = 0;
        this.elapsedMs = 0;
        this.animationFrame = null;
        this.lastTick = null;
        this.lastPaint = -Infinity;
        this.inView = false;
        this.failedAnimations = new Set();
        this.failedPoses = new Set();
        this.media = matchMedia('(prefers-reduced-motion: reduce)');
        this.onVisibilityChange = () => this.refreshPlayback();
        this.onMotionChange = () => { if (this.snapshot) this.update(this.snapshot); };
    }

    connectedCallback() {
        document.addEventListener('visibilitychange', this.onVisibilityChange);
        this.media.addEventListener('change', this.onMotionChange);
        this.observer = new IntersectionObserver((entries) => {
            this.inView = entries.some((entry) => entry.isIntersecting && entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0);
            this.refreshPlayback();
        });
        this.observer.observe(this);
    }

    disconnectedCallback() {
        this.stopPlayback();
        this.observer?.disconnect();
        document.removeEventListener('visibilitychange', this.onVisibilityChange);
        this.media.removeEventListener('change', this.onMotionChange);
        this.frameVersion += 1;
        this.loading = false;
        this.source = null;
        this.transition = null;
        this.inView = false;
        this.resolveReady?.();
    }

    get visible() {
        return this.isConnected && this.inView && !document.hidden;
    }

    notifyShapeChanged() {
        this.dispatchEvent(new CustomEvent('pet-shape-changed', { bubbles: true, composed: true }));
    }

    notifyActionPlayback(phase) {
        if (!Object.hasOwn(TRACKED_ACTIONS, this.selection?.action)
            || this.snapshot.runtime.behavior !== TRACKED_ACTIONS[this.selection.action]) return;
        const startedAt = this.snapshot.runtime.catActionStartedAt;
        if (!Number.isFinite(startedAt)) return;
        if (this.reducedMotion && phase !== 'failed') phase = 'static';
        const clip = this.selection.clip;
        const elapsedMs = clip ? Math.min(this.elapsedMs, clip.frames / clip.fps * 1000) : 0;
        const signature = `${startedAt}:${phase}:${elapsedMs}`;
        if (signature === this.playbackSignature) return;
        this.playbackSignature = signature;
        this.dispatchEvent(new CustomEvent('cat-action-playback', {
            bubbles: true, composed: true, detail: { startedAt, phase, elapsedMs },
        }));
    }

    hitTest(clientX, clientY) {
        if (!this.isConnected || this.hasAttribute('asset-error')) return false;
        const point = photoPoint(this.canvas.getBoundingClientRect(), this.maskWidth, this.maskHeight, clientX, clientY);
        return point !== null && alphaHit(this.mask, this.maskWidth, this.maskHeight, point.x, point.y);
    }

    stopPlayback() {
        if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
        this.animationFrame = null;
        this.lastTick = null;
    }

    refreshPlayback() {
        if (!this.visible || !this.selection) {
            this.stopPlayback();
            if (this.selection?.clip) this.notifyActionPlayback('loading');
            return;
        }
        if (!this.source || this.dirty) this.renderFrame(performance.now());
        this.scheduleFrame();
    }

    scheduleFrame() {
        if (!this.visible || this.reducedMotion || this.loading || this.animationFrame !== null || !this.source) return;
        const selection = this.selection;
        const phaseTime = selection.clip && catPhaseTime(selection.clip, selection.action, this.snapshot.game?.catMotion);
        const moving = selection.action === 'stand' && selection.pose === 'standing' ? !sampleStandingMotion(this.elapsedMs).done
            : selection.clip ? phaseTime === null && selection.clip.frames > 1 && !sampleCatClip(selection.clip, this.elapsedMs, selection.action).done
            : selection.action === 'idle' || selection.action === 'sleep';
        if (!moving && !this.transition) return;
        this.animationFrame = requestAnimationFrame((now) => {
            this.animationFrame = null;
            const delta = this.lastTick === null ? 0 : now - this.lastTick;
            this.lastTick = now;
            const rate = this.selection.animation === 'run' ? catPlaybackRate(this.selection.action, this.snapshot.game?.catMotion) : 1;
            this.elapsedMs = advanceCatTime(this.elapsedMs, delta, rate);
            if (this.transition) this.transition.elapsedMs += delta;
            const finished = this.selection.clip && sampleCatClip(this.selection.clip, this.elapsedMs, this.selection.action).done;
            if (finished || now - this.lastPaint >= (this.transition ? 1000 / 60 : 1000 / 30)) this.renderFrame(now);
            this.scheduleFrame();
        });
    }

    beginTransition(durationMs = CROSSFADE_MS) {
        if (!this.mask || this.reducedMotion) {
            this.transition = null;
            return;
        }
        const previous = document.createElement('canvas');
        previous.width = WIDTH;
        previous.height = HEIGHT;
        previous.getContext('2d').drawImage(this.foreground, 0, 0);
        this.transition = { canvas: previous, elapsedMs: 0, durationMs };
    }

    renderFrame(now) {
        if (!this.visible || !this.selection || this.loading) return;
        const { clip, action, pose } = this.selection;
        const phaseTime = clip && catPhaseTime(clip, action, this.snapshot.game?.catMotion);
        const sample = clip ? sampleCatClip(clip, phaseTime ?? this.elapsedMs, action) : { frame: 0 };
        const frame = clip ? catAtlasFrame(clip, sample.frame) : { file: profile.poses[pose].file, frame: 0 };
        if (!this.source || this.source.file !== frame.file) {
            this.loading = true;
            this.stopPlayback();
            this.notifyActionPlayback('loading');
            const version = this.frameVersion;
            loadImage(frame.file).then((image) => {
                if (version !== this.frameVersion || !this.isConnected) return;
                this.loading = false;
                if (image) this.source = { file: frame.file, image };
                this.dirty = true;
                this.refreshPlayback();
            }).catch(() => {
                if (version !== this.frameVersion) return;
                this.loading = false;
                if (this.selection.animation) {
                    this.failedAnimations.add(this.selection.animation);
                    this.update(this.snapshot);
                } else if (profile.poses[this.selection.pose]?.optional) {
                    this.failedPoses.add(this.selection.pose);
                    this.update(this.snapshot);
                } else {
                    this.mask = null;
                    this.setAttribute('asset-error', '');
                    this.resolveReady?.();
                    this.notifyShapeChanged();
                }
            });
            return;
        }
        const transform = catTransform({
            width: WIDTH, height: HEIGHT, shadow: profile.poses[pose].shadow,
            direction: this.direction, elapsedMs: this.elapsedMs, action, animated: Boolean(clip),
            mirror: this.mirror,
            reducedMotion: this.reducedMotion, lift: this.snapshot.game?.catMotion?.lift,
            gameMotion: this.snapshot.game?.catMotion,
            containsJump: clip?.containsJump === true,
        });
        const standing = action === 'stand' && pose === 'standing' ? sampleStandingMotion(this.elapsedMs, this.reducedMotion) : null;
        const signature = [frame.file, frame.frame, ...Object.values(transform), standing?.compression, standing?.sway, standing?.phase].join(':');
        if (signature === this.paintedSignature && !this.transition && this.hasAttribute('ready')) {
            this.dirty = false;
            this.notifyActionPlayback('playing');
            return;
        }
        this.paintedSignature = signature;
        this.lastPaint = now;
        this.dirty = false;
        const context = this.foregroundContext;
        context.clearRect(0, 0, WIDTH, HEIGHT);
        context.save();
        if (this.transition) {
            const blend = Math.min(1, this.transition.elapsedMs / this.transition.durationMs);
            context.globalAlpha = 1 - blend;
            context.drawImage(this.transition.canvas, 0, 0);
            context.globalCompositeOperation = 'lighter';
            context.globalAlpha = blend;
            if (blend >= 1) this.transition = null;
        }
        context.setTransform(transform.scaleX, 0, 0, transform.scaleY, transform.translateX, transform.translateY);
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        const image = this.source.image;
        if (clip) context.drawImage(image, frame.x, frame.y, frame.width, frame.height, 0, 0, WIDTH, HEIGHT);
        else if (standing) drawStandingPhoto(context, image, WIDTH, HEIGHT, standing);
        else context.drawImage(image, 0, 0, WIDTH, HEIGHT);
        context.restore();
        this.maskContext.clearRect(0, 0, this.maskWidth, this.maskHeight);
        this.maskContext.drawImage(this.foreground, 0, 0, this.maskWidth, this.maskHeight);
        this.mask = this.maskContext.getImageData(0, 0, this.maskWidth, this.maskHeight).data;
        this.context.clearRect(0, 0, WIDTH, HEIGHT);
        this.context.drawImage(this.foreground, 0, 0);
        this.drawShadow(pose);
        this.dataset.pose = pose;
        this.dataset.animation = this.selection.animation || (standing ? 'photo-stand' : 'static');
        this.dataset.motionSource = standing ? 'photo-rig' : clip ? 'video' : 'photo';
        this.dataset.standPhase = standing?.phase || '';
        this.dataset.frame = String(frame.frame);
        this.setAttribute('ready', '');
        this.removeAttribute('asset-error');
        this.resolveReady?.();
        this.notifyShapeChanged();
        this.notifyActionPlayback('playing');
        if (clip && !this.reducedMotion && !sample.done) {
            const upcoming = sampleCatClip(clip, (phaseTime ?? this.elapsedMs) + 400, action);
            const next = catAtlasFrame(clip, upcoming.frame);
            if (next.file !== frame.file) loadImage(next.file, true).catch(() => {});
        }
    }

    drawShadow(pose) {
        const [horizontal, vertical, radiusX, radiusY] = this.selection.clip?.shadow || profile.poses[pose].shadow || [WIDTH / 2, HEIGHT * .925, WIDTH * .2, HEIGHT * .02];
        const context = this.context;
        context.save();
        context.globalCompositeOperation = 'destination-over';
        context.translate(horizontal, vertical);
        context.scale(radiusX, radiusY);
        const shadow = context.createRadialGradient(0, 0, .05, 0, 0, 1);
        shadow.addColorStop(0, '#29382c26');
        shadow.addColorStop(1, '#29382c00');
        context.fillStyle = shadow;
        context.fillRect(-1, -1, 2, 2);
        context.restore();
    }

    update(snapshot) {
        this.snapshot = snapshot;
        const selection = selectCatAnimation(profile, snapshot, this.failedAnimations, this.failedPoses);
        const reducedMotion = Boolean(snapshot.pet.settings.reducedMotion || this.media.matches);
        const direction = (snapshot.game?.catMotion?.facing ?? snapshot.runtime.direction) < 0 ? -1 : 1;
        const mirror = canMirrorCat(selection.clip || profile.poses[selection.pose], snapshot.game?.catMotion);
        const tracked = Object.hasOwn(TRACKED_ACTIONS, selection.action);
        const restarted = (selection.action === 'stand' || tracked) && snapshot.runtime.catActionStartedAt !== this.actionStartedAt;
        this.actionStartedAt = snapshot.runtime.catActionStartedAt;
        const poseChanged = selection.pose !== this.selection?.pose;
        const changed = restarted || !this.selection || ['action', 'animation'].some((key) => selection[key] !== this.selection[key])
            || (poseChanged && !tracked);
        const turned = (this.direction !== direction && mirror) || this.mirror !== mirror;
        const motionChanged = this.reducedMotion !== reducedMotion;
        const motionSignature = `${snapshot.game?.catMotion?.lift}:${snapshot.game?.catMotion?.progress}`;
        const phaseChanged = motionSignature !== this.motionSignature;
        this.motionSignature = motionSignature;
        this.reducedMotion = reducedMotion;
        this.setAttribute('coat', 'silver-tabby');
        this.setAttribute('accessory', 'none');
        this.setAttribute('behavior', snapshot.runtime.behavior);
        this.setAttribute('direction', direction < 0 ? 'left' : 'right');
        this.setAttribute('carrying', '');
        this.toggleAttribute('reduced-motion', reducedMotion);
        this.dataset.action = selection.action;
        if (changed) {
            this.stopPlayback();
            this.beginTransition(['stand', 'groom', 'eat'].includes(selection.action) || ['stand', 'groom', 'eat'].includes(this.selection?.action) ? 240 : CROSSFADE_MS);
            this.frameVersion += 1;
            this.elapsedMs = 0;
            this.loading = false;
            this.source = null;
            this.removeAttribute('ready');
            this.resolveReady?.();
            this.ready = new Promise((resolve) => { this.resolveReady = resolve; });
        } else if (turned) this.beginTransition();
        if (reducedMotion) {
            this.stopPlayback();
            this.transition = null;
        }
        this.selection = selection;
        this.direction = direction;
        this.mirror = mirror;
        if (tracked && !selection.clip) this.notifyActionPlayback('failed');
        else if (reducedMotion) this.notifyActionPlayback('static');
        if (snapshot.game?.mode !== 'teaser' && ['crouch', 'run', 'pounce'].includes(selection.action) && profile.animations?.bat?.files?.[0]) {
            loadImage(profile.animations.bat.files[0], true).catch(() => {});
        }
        if (snapshot.game?.mode === 'teaser') {
            const upcoming = selection.action === 'crouch' ? 'teaser-jump' : ['idle', 'watch', 'run'].includes(selection.action) ? 'teaser-ready' : null;
            const file = upcoming && profile.animations?.[upcoming]?.files?.[0];
            if (file) loadImage(file, true).catch(() => {});
        }
        this.dirty ||= changed || poseChanged || turned || motionChanged || (!reducedMotion && phaseChanged);
        this.refreshPlayback();
    }
}

customElements.define('silver-cat', SilverCat);
