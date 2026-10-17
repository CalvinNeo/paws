const ACTION_CLIPS = {
    idle: ['idle'],
    watch: ['watch', 'idle'],
    crouch: ['crouch', 'watch', 'idle'],
    run: ['run', 'pounce', 'watch', 'idle'],
    pounce: ['pounce', 'run', 'watch', 'idle'],
    bat: ['bat', 'watch', 'idle'],
    settle: ['settle', 'watch', 'idle'],
    pet: ['pet', 'idle'],
    eat: ['eat'],
    sleep: ['sleep'],
    stand: [],
    groom: ['groom'],
};

const TEASER_CLIPS = {
    idle: ['teaser-watch'],
    watch: ['teaser-watch'],
    run: ['teaser-watch'],
    crouch: ['teaser-ready', 'teaser-watch'],
    pounce: ['teaser-jump', 'teaser-ready', 'teaser-watch'],
    bat: ['teaser-jump', 'teaser-ready', 'teaser-watch'],
    settle: ['teaser-watch'],
};

const SINGLE_ACTIONS = new Set(['bat', 'pounce', 'settle', 'pet', 'eat', 'groom']);
const PHASE_ACTIONS = new Set(['crouch', 'pounce', 'bat', 'settle']);

export const CAT_PAW_CONTACT = Object.freeze({ x: .66, y: .9, baseline: .925, impactProgress: 2 / 3 });

export function catPawOffset(size, direction) {
    const scale = Math.min(size.width * .88 / 1280, size.height * .86 / 1120);
    return {
        x: (CAT_PAW_CONTACT.x - .5) * 1280 * scale * (direction < 0 ? -1 : 1),
        y: (CAT_PAW_CONTACT.y - CAT_PAW_CONTACT.baseline) * 1120 * scale,
    };
}

function finite(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
}

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

function validClip(clip) {
    return clip && ['frames', 'frameWidth', 'frameHeight', 'columns', 'rows'].every((key) =>
        Number.isSafeInteger(clip[key]) && clip[key] > 0)
        && Number.isFinite(clip.fps) && clip.fps > 0
        && Array.isArray(clip.files) && clip.files.length > 0
        && clip.files.every((file) => typeof file === 'string' && file.length > 0)
        && clip.frames <= clip.columns * clip.rows * clip.files.length;
}

export function selectCatAnimation(profile, snapshot, unavailable = new Set(), unavailablePoses = new Set()) {
    const settings = snapshot.pet?.settings || {};
    const behavior = snapshot.runtime?.behavior || 'idle';
    const game = snapshot.game;
    const phaseActions = { watching: 'watch', pouncing: 'pounce', batting: 'bat', celebrating: 'settle' };
    const behaviorActions = { walking: 'run', petting: 'pet', eating: 'eat', playing: 'bat', standing: 'stand', grooming: 'groom' };
    const action = behavior === 'sleeping' ? 'sleep'
        : game ? (Object.hasOwn(ACTION_CLIPS, game.catMotion?.action) ? game.catMotion.action : phaseActions[game.phase] || 'watch')
            : behaviorActions[behavior] || 'idle';
    const restingPose = Object.hasOwn(profile.poses, settings.catPose) && !unavailablePoses.has(settings.catPose) ? settings.catPose : 'sitting';
    const requestedPose = action === 'sleep' ? 'sleeping'
        : action === 'stand' ? 'standing'
        : game || action === 'run' ? profile.playPose || 'reaching' : restingPose;
    const pose = Object.hasOwn(profile.poses, requestedPose) && !unavailablePoses.has(requestedPose) ? requestedPose : restingPose;
    const candidates = game?.mode === 'teaser'
        ? [...(TEASER_CLIPS[action] || []), ...ACTION_CLIPS[action]]
        : action === 'idle' && restingPose !== 'sitting' ? [] : ACTION_CLIPS[action];
    const animation = candidates.find((name) => !unavailable.has(name) && validClip(profile.animations?.[name])) || null;
    return { action, pose, animation, clip: animation ? profile.animations[animation] : null };
}

export function sampleCatClip(clip, elapsedMs, action = 'idle') {
    const frames = Math.max(1, Math.floor(finite(clip.frames, 1)));
    const fps = Math.max(0, finite(clip.fps, 0));
    let elapsed = Math.max(0, finite(elapsedMs, 0));
    const pingPong = Boolean(clip.pingPong) && frames > 1;
    const loop = clip.loop === true && !SINGLE_ACTIONS.has(action);
    const length = pingPong ? (frames - 1) * 2 : frames;
    const pauseMs = loop ? Math.max(0, finite(clip.loopPauseMs, 0)) : 0;
    if (pauseMs > 0 && fps > 0) {
        const duration = length * 1000 / fps;
        elapsed %= duration + pauseMs;
        if (elapsed >= duration) return { frame: pingPong ? 0 : frames - 1, done: false };
    }
    const step = Math.floor(elapsed * fps / 1000 + 1e-7);
    const position = loop ? step % length : Math.min(step, pingPong ? length : frames - 1);
    const frame = pingPong && position >= frames ? length - position : position;
    return { frame, done: !loop && step >= (pingPong ? length : frames - 1) };
}

export function catAtlasFrame(clip, frame) {
    if (!validClip(clip)) return null;
    const index = clamp(Math.floor(finite(frame, 0)), 0, clip.frames - 1);
    const capacity = clip.columns * clip.rows;
    const page = Math.floor(index / capacity);
    const cell = index % capacity;
    return {
        file: clip.files[page], page, frame: index,
        x: cell % clip.columns * clip.frameWidth,
        y: Math.floor(cell / clip.columns) * clip.frameHeight,
        width: clip.frameWidth, height: clip.frameHeight,
    };
}

export function catPhaseTime(clip, action, motion) {
    if (!PHASE_ACTIONS.has(action) || !Number.isFinite(motion?.progress)) return null;
    const steps = clip.pingPong ? (clip.frames - 1) * 2 : clip.frames - 1;
    const progress = clip.containsJump && Number.isFinite(motion.clipProgress) ? motion.clipProgress : motion.progress;
    return clamp(progress, 0, 1) * steps * 1000 / clip.fps;
}

export function canMirrorCat(descriptor, motion) {
    if (motion?.facing === -1 || motion?.facing === 1) return true;
    return descriptor?.mirror !== false && descriptor?.mirrored !== false && descriptor?.facing !== 'front';
}

export function catPlaybackRate(action, motion = {}) {
    if (action !== 'run' || !Number.isFinite(motion.speed) || motion.speed <= 0) return 1;
    return clamp(motion.speed / 320, .75, 1.5);
}

export function advanceCatTime(elapsedMs, deltaMs, rate = 1) {
    return Math.max(0, finite(elapsedMs, 0)) + Math.max(0, finite(deltaMs, 0)) * clamp(finite(rate, 1), 0, 2);
}

export function catTransform({ width, height, shadow, direction = 1, mirror = true, elapsedMs = 0, action = 'idle', animated = false, reducedMotion = false, lift = 0, gameMotion, containsJump = false }) {
    const playing = gameMotion?.facing === -1 || gameMotion?.facing === 1;
    const anchorX = playing ? width / 2 : finite(shadow?.[0], width / 2);
    const anchorY = playing ? height * CAT_PAW_CONTACT.baseline : finite(shadow?.[1], height * .925);
    const breathing = !animated && !reducedMotion && (action === 'idle' || action === 'sleep');
    const breath = breathing ? (1 - Math.cos(Math.max(0, finite(elapsedMs, 0)) / 1000 * Math.PI * 2 / 4.8)) / 2 : 0;
    const scaleX = mirror && direction < 0 ? -1 : 1;
    const scaleY = 1 + breath * .0025;
    const offsetY = !reducedMotion && !containsJump && action === 'pounce' ? -height * .025 * clamp(finite(lift, 0), 0, 1) : 0;
    return {
        scaleX, scaleY,
        translateX: anchorX * (1 - scaleX),
        translateY: anchorY * (1 - scaleY) + offsetY,
    };
}
