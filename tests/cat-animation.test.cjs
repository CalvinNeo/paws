const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectCatAnimation, sampleCatClip, catAtlasFrame, catPhaseTime, canMirrorCat, catPlaybackRate, advanceCatTime, catTransform } = require('../src/renderer/cat-animation.mjs');
const { sampleStandingMotion, standingPoint, STAND_DURATION_MS } = require('../src/renderer/cat-standing.mjs');

const CLIP = {
    fps: 18, frames: 48, loop: true, pingPong: false,
    frameWidth: 768, frameHeight: 672, columns: 4, rows: 4,
    files: ['motion/idle-0.webp', 'motion/idle-1.webp', 'motion/idle-2.webp'],
};
const PROFILE = {
    width: 1280, height: 1120, playPose: 'reaching',
    poses: Object.fromEntries(['sitting', 'loaf', 'relaxed', 'sleeping', 'reaching'].map((pose) => [pose, { file: `${pose}.png` }])),
    animations: Object.fromEntries(['idle', 'watch', 'run', 'bat', 'pet'].map((name) => [name, CLIP])),
};

function snapshot(behavior = 'idle', catPose = 'sitting', action) {
    return {
        pet: { settings: { catPose } }, runtime: { behavior, direction: 1 },
        game: action ? { catMotion: { action } } : null,
    };
}

test('standing uses its own photo temporarily and games and naps keep precedence', () => {
    const profile = { ...PROFILE, poses: { ...PROFILE.poses, standing: { file: 'standing.png', optional: true } } };
    for (const catPose of ['sitting', 'loaf', 'relaxed', 'standing']) {
        assert.deepEqual(selectCatAnimation(profile, snapshot('standing', catPose)), { action: 'stand', pose: 'standing', animation: null, clip: null });
        assert.equal(selectCatAnimation(profile, snapshot('idle', catPose)).pose, catPose);
        assert.equal(selectCatAnimation(profile, snapshot('sleeping', catPose)).pose, 'sleeping');
        assert.equal(selectCatAnimation(profile, snapshot('standing', catPose, 'bat')).animation, 'bat');
    }
    assert.equal(selectCatAnimation(profile, snapshot('idle', 'standing')).animation, null);
    assert.equal(selectCatAnimation(profile, snapshot('standing', 'loaf'), new Set(), new Set(['standing'])).pose, 'loaf');
    assert.equal(selectCatAnimation(profile, snapshot('standing', 'standing'), new Set(), new Set(['standing'])).pose, 'sitting');
    assert.equal(selectCatAnimation(PROFILE, snapshot('standing', 'loaf')).pose, 'loaf');
});

test('the photographic standing rig keeps the base planted and the head proportions intact', () => {
    const width = 1280;
    const height = 1120;
    let maximumSway = 0;
    for (let elapsed = 0; elapsed <= STAND_DURATION_MS; elapsed += 50) {
        const motion = sampleStandingMotion(elapsed);
        const base = standingPoint(height * .925, width, height, motion);
        assert.ok(Math.abs(base.x) < 1e-8 && Math.abs(base.y - height * .925) < 1e-8);
        const top = standingPoint(height * .1, width, height, motion);
        const chin = standingPoint(height * .35, width, height, motion);
        assert.ok(Math.abs(chin.y - top.y - height * .25) < 1e-8, 'the face is translated without stretching');
        let previous = -Infinity;
        for (let vertical = 0; vertical <= height; vertical += 4) {
            const point = standingPoint(vertical, width, height, motion);
            assert.ok(point.y > previous, 'torso mapping never folds or inverts');
            previous = point.y;
        }
        assert.ok(top.y >= 0 && chin.y < height * .925);
        maximumSway = Math.max(maximumSway, Math.abs(top.x));
    }
    assert.ok(maximumSway > 1 && maximumSway <= width * .004);
    assert.ok(sampleStandingMotion(0).compression > sampleStandingMotion(1050).compression);
});

test('standing finishes once and reduced motion shows the unwarped photo', () => {
    assert.equal(sampleStandingMotion(STAND_DURATION_MS - 1).done, false);
    assert.equal(sampleStandingMotion(STAND_DURATION_MS).done, true);
    assert.deepEqual(sampleStandingMotion(60000), sampleStandingMotion(STAND_DURATION_MS));
    for (const elapsed of [0, 180, 1000, 2400, 4200, NaN, Infinity, -10]) {
        assert.deepEqual(sampleStandingMotion(elapsed, true), { compression: 0, sway: 0, phase: 'hold', done: true });
    }
});

test('clip timing advances at the recorded fps and loops without skipping the last frame', () => {
    assert.deepEqual(sampleCatClip(CLIP, 0), { frame: 0, done: false });
    assert.equal(sampleCatClip(CLIP, 54).frame, 0);
    assert.equal(sampleCatClip(CLIP, 1000 / 18).frame, 1);
    assert.equal(sampleCatClip(CLIP, 47 * 1000 / 18).frame, 47);
    assert.equal(sampleCatClip(CLIP, 48 * 1000 / 18).frame, 0);
    assert.equal(sampleCatClip(CLIP, 1000).frame, 18);
    assert.equal(sampleCatClip(CLIP, -100).frame, 0);
    assert.equal(sampleCatClip(CLIP, NaN).frame, 0);
});

test('bat and pet actions finish once even when the fallback asset is marked looping', () => {
    for (const action of ['bat', 'pet', 'pounce', 'settle', 'eat']) {
        assert.deepEqual(sampleCatClip(CLIP, 46 * 1000 / 18, action), { frame: 46, done: false });
        assert.deepEqual(sampleCatClip(CLIP, 47 * 1000 / 18, action), { frame: 47, done: true });
        assert.deepEqual(sampleCatClip(CLIP, 60000, action), { frame: 47, done: true });
    }
    assert.deepEqual(sampleCatClip({ ...CLIP, loop: false }, 60000), { frame: 47, done: true });
});

test('ping-pong loops reverse naturally and one-shot clips return to their first frame', () => {
    const clip = { ...CLIP, frames: 4, fps: 10, pingPong: true };
    assert.deepEqual(Array.from({ length: 10 }, (_, index) => sampleCatClip(clip, index * 100).frame), [0, 1, 2, 3, 2, 1, 0, 1, 2, 3]);
    assert.deepEqual(sampleCatClip(clip, 500, 'bat'), { frame: 1, done: false });
    assert.deepEqual(sampleCatClip(clip, 600, 'bat'), { frame: 0, done: true });
    assert.deepEqual(sampleCatClip(clip, 10000, 'bat'), { frame: 0, done: true });
    assert.deepEqual(sampleCatClip({ ...clip, frames: 1 }, 10000), { frame: 0, done: false });
    assert.deepEqual(sampleCatClip({ ...clip, frames: 1, loop: false }, 0), { frame: 0, done: true });
});

test('atlas frame addressing crosses files and supports a partial final page', () => {
    assert.deepEqual(catAtlasFrame(CLIP, 15), { file: CLIP.files[0], page: 0, frame: 15, x: 2304, y: 2016, width: 768, height: 672 });
    assert.deepEqual(catAtlasFrame(CLIP, 16), { file: CLIP.files[1], page: 1, frame: 16, x: 0, y: 0, width: 768, height: 672 });
    assert.equal(catAtlasFrame(CLIP, 32).file, CLIP.files[2]);
    assert.equal(catAtlasFrame({ ...CLIP, frames: 35 }, 100).frame, 34);
    assert.equal(catAtlasFrame(CLIP, -1).frame, 0);
    assert.equal(catAtlasFrame({ ...CLIP, files: ['only-one.webp'] }, 0), null);
});

test('short idle and watch ping-pong clips rest on frame zero between complete cycles', () => {
    for (const [action, loopPauseMs] of [['idle', 1800], ['watch', 600]]) {
        const clip = { ...CLIP, frames: 12, pingPong: true, loopPauseMs };
        const duration = 22 * 1000 / 18;
        const cycle = duration + loopPauseMs;
        assert.equal(sampleCatClip(clip, 11 * 1000 / 18, action).frame, 11);
        assert.equal(sampleCatClip(clip, 21 * 1000 / 18, action).frame, 1);
        for (const elapsed of [duration, duration + loopPauseMs / 2, cycle - 1]) {
            assert.deepEqual(sampleCatClip(clip, elapsed, action), { frame: 0, done: false });
        }
        assert.deepEqual(sampleCatClip(clip, cycle, action), { frame: 0, done: false });
        assert.equal(sampleCatClip(clip, cycle + 1000 / 18, action).frame, 1);
        assert.equal(sampleCatClip(clip, cycle + 11 * 1000 / 18, action).frame, 11);
        assert.equal(sampleCatClip(clip, cycle * 5 + duration + 100, action).frame, 0);
    }
});

test('forward loops hold their last frame during the pause and restart from frame zero', () => {
    const clip = { ...CLIP, frames: 4, fps: 10, loopPauseMs: 250 };
    assert.equal(sampleCatClip(clip, 299).frame, 2);
    for (const elapsed of [300, 400, 500, 649]) {
        assert.deepEqual(sampleCatClip(clip, elapsed), { frame: 3, done: false });
    }
    assert.deepEqual(sampleCatClip(clip, 650), { frame: 0, done: false });
    assert.equal(sampleCatClip(clip, 750).frame, 1);
    assert.equal(sampleCatClip(clip, 650 * 8 + 500).frame, 3);
    assert.deepEqual(sampleCatClip({ ...clip, frames: 1 }, 10000), { frame: 0, done: false });
});

test('loop pauses never delay or restart a single paw action', () => {
    const clip = { ...CLIP, frames: 19, fps: 24, loop: false, loopPauseMs: 1800 };
    assert.deepEqual(sampleCatClip(clip, 17 * 1000 / 24, 'bat'), { frame: 17, done: false });
    assert.deepEqual(sampleCatClip(clip, 750, 'bat'), { frame: 18, done: true });
    assert.deepEqual(sampleCatClip(clip, 10000, 'bat'), { frame: 18, done: true });
    assert.deepEqual(sampleCatClip({ ...clip, loop: true }, 10000, 'bat'), { frame: 18, done: true });
    assert.deepEqual(sampleCatClip({ ...clip, pingPong: true }, 1500, 'bat'), { frame: 0, done: true });
    assert.deepEqual(sampleCatClip(clip, 10000, 'idle'), { frame: 18, done: true });
});

test('missing, negative or non-finite loop pauses retain the original cadence', () => {
    for (const loopPauseMs of [undefined, 0, -100, NaN, Infinity, '1800']) {
        for (const elapsed of [0, 1000, 48 * 1000 / 18, 60000]) {
            assert.deepEqual(sampleCatClip({ ...CLIP, loopPauseMs }, elapsed), sampleCatClip(CLIP, elapsed));
        }
    }
});

test('resting poses and sleep keep their own photos while sitting can play a real idle clip', () => {
    assert.equal(selectCatAnimation(PROFILE, snapshot()).animation, 'idle');
    for (const pose of ['loaf', 'relaxed']) {
        assert.deepEqual(selectCatAnimation(PROFILE, snapshot('idle', pose)), { action: 'idle', pose, animation: null, clip: null });
    }
    assert.deepEqual(selectCatAnimation(PROFILE, snapshot('sleeping', 'loaf', 'run')), { action: 'sleep', pose: 'sleeping', animation: null, clip: null });
    assert.equal(selectCatAnimation(PROFILE, snapshot('petting')).animation, 'pet');
    assert.equal(selectCatAnimation(PROFILE, snapshot('walking')).animation, 'run');
});

test('game actions prefer their own clips and missing or broken clips fall back without dog behavior', () => {
    assert.equal(selectCatAnimation(PROFILE, snapshot('idle', 'loaf', 'bat')).animation, 'bat');
    assert.equal(selectCatAnimation(PROFILE, snapshot('walking', 'sitting', 'crouch')).animation, 'watch');
    const profile = { ...PROFILE, animations: { ...PROFILE.animations, run: null, pounce: CLIP } };
    assert.equal(selectCatAnimation(profile, snapshot('walking')).animation, 'pounce');
    assert.equal(selectCatAnimation(profile, snapshot('walking'), new Set(['pounce'])).animation, 'watch');
    const shortFootage = { ...PROFILE, animations: { idle: CLIP, watch: CLIP, bat: { ...CLIP, loop: false } } };
    assert.equal(selectCatAnimation(shortFootage, snapshot('walking')).animation, 'watch');
    assert.equal(selectCatAnimation(shortFootage, snapshot('walking', 'sitting', 'run')).animation, 'watch');
    const noClips = selectCatAnimation({ ...PROFILE, animations: {} }, snapshot('walking'));
    assert.equal(noClips.animation, null);
    assert.equal(noClips.pose, 'reaching');
    const invalid = { ...PROFILE, animations: { run: { ...CLIP, frames: 500 }, watch: CLIP } };
    assert.equal(selectCatAnimation(invalid, snapshot('walking')).animation, 'watch');
    const legacy = { ...snapshot(), game: { phase: 'batting' } };
    assert.equal(selectCatAnimation(PROFILE, legacy).action, 'bat');
});

test('the playback clock accumulates elapsed time without resets and safely adjusts running cadence', () => {
    let elapsed = 0;
    for (let tick = 0; tick < 60; tick += 1) elapsed = advanceCatTime(elapsed, 1000 / 60);
    assert.ok(Math.abs(elapsed - 1000) < .001);
    assert.equal(advanceCatTime(elapsed, 0), elapsed);
    assert.equal(advanceCatTime(elapsed, -500), elapsed);
    assert.equal(advanceCatTime(elapsed, NaN), elapsed);
    assert.equal(advanceCatTime(500, 200, 1.5), 800);
    assert.equal(catPlaybackRate('idle', { speed: 500 }), 1);
    assert.equal(catPlaybackRate('run', { speed: 320 }), 1);
    assert.equal(catPlaybackRate('run', { speed: 1000 }), 1.5);
    assert.equal(catPlaybackRate('run', { speed: 10 }), .75);
});

test('contact actions follow game phase progress instead of restarting on broadcasts', () => {
    const clip = { ...CLIP, frames: 9 };
    assert.equal(catPhaseTime(clip, 'run', { progress: .5 }), null);
    assert.equal(catPhaseTime(clip, 'watch', { progress: 1 }), null);
    assert.equal(catPhaseTime(clip, 'bat', {}), null);
    for (const action of ['crouch', 'pounce', 'bat', 'settle']) {
        assert.equal(sampleCatClip(clip, catPhaseTime(clip, action, { progress: .5 }), action).frame, 4);
        assert.equal(sampleCatClip(clip, catPhaseTime(clip, action, { progress: 1 }), action).frame, 8);
        assert.equal(catPhaseTime(clip, action, { progress: -1 }), 0);
        assert.equal(catPhaseTime(clip, action, { progress: 10 }), 8000 / 18);
    }
});

test('front-facing footage preserves facial position regardless of travel direction', () => {
    for (const descriptor of [{ mirror: false }, { mirrored: false }, { facing: 'front' }]) {
        assert.equal(canMirrorCat(descriptor), false);
        const options = { width: 1280, height: 1120, shadow: [704, 1038, 274, 26], animated: true, mirror: canMirrorCat(descriptor) };
        assert.deepEqual(catTransform({ ...options, direction: -1 }), catTransform({ ...options, direction: 1 }));
    }
    assert.equal(canMirrorCat({ facing: 'right' }), true);
});

test('explicit game facing turns front-view footage around the body baseline, including reduced motion', () => {
    for (const descriptor of [{ mirror: false }, { mirrored: false }, { facing: 'front' }]) {
        for (const facing of [-1, 1]) {
            const motion = { action: 'bat', facing };
            assert.equal(canMirrorCat(descriptor, motion), true);
            for (const reducedMotion of [false, true]) {
                const transform = catTransform({
                    width: 1280, height: 1120, shadow: [704, 1038, 274, 26],
                    direction: facing, mirror: canMirrorCat(descriptor, motion),
                    action: 'bat', animated: true, reducedMotion, gameMotion: motion,
                });
                assert.equal(transform.scaleX, facing);
                assert.equal(640 * transform.scaleX + transform.translateX, 640);
                assert.equal(1036 * transform.scaleY + transform.translateY, 1036);
                assert.equal(Math.sign(1280 * .66 * transform.scaleX + transform.translateX - 640), facing);
            }
        }
        for (const facing of [undefined, null, 0, 'left', '1', NaN]) {
            assert.equal(canMirrorCat(descriptor, { facing }), false);
        }
    }
});

test('the nineteen-frame paw clip reaches its strike frame before finishing its recovery', () => {
    const clip = { ...CLIP, frames: 19, fps: 24, loop: false };
    for (const [progress, frame] of [[0, 0], [.5, 9], [2 / 3 - .001, 11], [2 / 3, 12], [1, 18]]) {
        const time = catPhaseTime(clip, 'bat', { progress });
        assert.equal(sampleCatClip(clip, time, 'bat').frame, frame);
    }
});

test('turns and breathing preserve the same foot anchor instead of reflecting around the canvas edge', () => {
    const options = { width: 1280, height: 1120, shadow: [704, 1038, 274, 26], elapsedMs: 2400 };
    for (const direction of [-1, 1]) {
        const transform = catTransform({ ...options, direction });
        assert.equal(704 * transform.scaleX + transform.translateX, 704);
        assert.equal(1038 * transform.scaleY + transform.translateY, 1038);
        assert.ok(transform.scaleY > 1 && transform.scaleY <= 1.0025);
    }
    assert.equal(catTransform({ ...options, animated: true }).scaleY, 1);
    assert.equal(catTransform({ ...options, reducedMotion: true }).scaleY, 1);
    assert.equal(catTransform({ ...options, action: 'bat' }).scaleY, 1);
    assert.equal(catTransform({ ...options, action: 'pounce', lift: 1 }).translateY, -28);
    assert.equal(catTransform({ ...options, action: 'pounce', lift: 1, reducedMotion: true }).translateY, 0);
});
