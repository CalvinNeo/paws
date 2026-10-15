const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectCatAnimation, catPhaseTime, sampleCatClip, catTransform } = require('../src/renderer/cat-animation.mjs');
const { toyHitTest } = require('../src/play/shared.cjs');

const clip = { frames: 12, fps: 24, frameWidth: 768, frameHeight: 672, columns: 4, rows: 4, files: ['example.webp'], loop: false };
const profile = {
    playPose: 'reaching', poses: { sitting: {}, loaf: {}, reaching: {} },
    animations: {
        watch: { ...clip, loop: true }, bat: clip,
        'teaser-watch': { ...clip, loop: true }, 'teaser-ready': clip, 'teaser-jump': { ...clip, containsJump: true },
    },
};

function snapshot(action) {
    return { pet: { settings: { catPose: 'loaf' } }, runtime: { behavior: 'idle' }, game: { mode: 'teaser', catMotion: { action, progress: .5, facing: 1 } } };
}

test('the teaser uses separate grounded, preparation and airborne footage even with Resting selected', () => {
    for (const [action, expected] of [['idle', 'teaser-watch'], ['watch', 'teaser-watch'], ['run', 'teaser-watch'], ['crouch', 'teaser-ready'], ['pounce', 'teaser-jump']]) {
        const selection = selectCatAnimation(profile, snapshot(action));
        assert.equal(selection.animation, expected);
        assert.equal(selection.pose, 'reaching');
    }
    const jump = selectCatAnimation(profile, snapshot('pounce'));
    for (const [progress, frame] of [[0, 0], [.5, 5], [1, 11]]) {
        assert.equal(sampleCatClip(jump.clip, catPhaseTime(jump.clip, 'pounce', { progress }), 'pounce').frame, frame);
    }
    const recovery = selectCatAnimation(profile, snapshot('bat'));
    assert.equal(recovery.animation, 'teaser-jump');
    assert.equal(sampleCatClip(recovery.clip, catPhaseTime(recovery.clip, 'bat', { progress: 0, clipProgress: 1 }), 'bat').frame, 11);
    assert.equal(selectCatAnimation(profile, snapshot('pounce'), new Set(['teaser-jump'])).animation, 'teaser-ready');
    assert.equal(selectCatAnimation(profile, snapshot('crouch'), new Set(['teaser-ready'])).animation, 'teaser-watch');
});

test('recorded jumps retain their source elevation without an additional synthetic hop', () => {
    for (const direction of [-1, 1]) {
        const options = { width: 1280, height: 1120, direction, action: 'pounce', animated: true, lift: 1, gameMotion: { facing: direction } };
        assert.equal(catTransform({ ...options, containsJump: true }).translateY, 0);
        assert.equal(catTransform(options).translateY, -28);
    }
});

test('feather, cord and handle are clickable at every cat size while their gaps pass through', () => {
    for (const size of [24, 29, 48, 96, 144]) {
        for (const point of [{ x: 50, y: 50 }, { x: 39, y: 54 }, { x: 82.5, y: 17.5 }, { x: 67.5, y: 36.5 }]) {
            assert.equal(toyHitTest('feather', { x: point.x / 100 * size, y: point.y / 100 * size }, size), true);
        }
        for (const point of [{ x: 1, y: 1 }, { x: 50, y: 20 }, { x: 80, y: 60 }, { x: 50, y: 95 }]) {
            assert.equal(toyHitTest('feather', { x: point.x / 100 * size, y: point.y / 100 * size }, size), false);
        }
    }
});
