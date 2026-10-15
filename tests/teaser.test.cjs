const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TeaserPlaySession } = require('../src/play/teaser.cjs');
const { PlaySession } = require('../src/play.cjs');
const { petSize, homeBounds } = require('../src/geometry.cjs');
const { createState, normalizeState, ensureCanPlay, rewardPlay } = require('../src/model.cjs');
const { getCompanion } = require('../src/companions/index.cjs');

const AREA = { x: 0, y: 25, width: 1440, height: 815 };
const STEP = 1 / 120;
const PROFILE = {
    width: 1280, height: 1120,
    animations: {
        'teaser-watch': { frames: 10, fps: 20 },
        'teaser-ready': { frames: 9, fps: 20 },
        'teaser-jump': { frames: 25, fps: 30, containsJump: true, contact: { x: .64, y: .38, frame: 12 } },
    },
};

function distance(first, second) {
    return Math.hypot(first.x - second.x, first.y - second.y);
}

function session(size = 30, area = AREA, profile = PROFILE) {
    const dimensions = petSize(size);
    return new TeaserPlaySession({
        x: area.x + area.width / 2 - dimensions.width / 2,
        y: area.y + area.height / 2 - dimensions.height * .8955,
        ...dimensions,
    }, area, profile);
}

function advanceUntil(game, condition, timeout = 5) {
    for (let frame = 0; frame < timeout / STEP && !condition(); frame += 1) game.step(STEP);
    assert.ok(condition(), `Timed out at ${game.phase}/${game.motionAction}`);
}

function lureNear(game, direction = 1) {
    game.direction = direction;
    const offset = game.pawOffset();
    return game.constrainToy({ x: game.pet.x + direction * game.petSize.width * .5, y: game.pet.y + offset.y });
}

function start(game, direction = 1) {
    assert.equal(game.beginDrag(game.toy, 1000), true);
    game.moveDrag(lureNear(game, direction), 1016);
}

test('teaser registration, factory and cat save counters work at zero energy', () => {
    const game = new PlaySession('teaser', homeBounds(30, AREA), AREA, 'cat');
    assert.ok(game instanceof TeaserPlaySession);
    assert.equal(game.snapshot().toy, 'feather');
    assert.equal(game.snapshot().mode, 'teaser');
    assert.deepEqual(Object.keys(getCompanion('cat').games), ['pounce', 'bubbles', 'teaser']);
    const now = 1800000000000;
    const cat = { ...createState(now, 'cat'), energy: 0, happiness: 50 };
    assert.doesNotThrow(() => ensureCanPlay(cat, 'teaser'));
    assert.equal(cat.playStats.teaser, 0);
    const played = rewardPlay(cat, 'teaser', now).state;
    assert.equal(played.energy, 0);
    assert.equal(played.happiness, 56);
    assert.equal(played.playStats.teaser, 1);
    assert.equal(played.playStats.pounce, 0);
    assert.equal(normalizeState({ ...cat, playStats: { pounce: 2, bubbles: 3 } }, now).playStats.teaser, 0);
    assert.equal(normalizeState(played, now).playStats.teaser, 1);
});

test('opening or leaving a stationary feather never moves the cat or creates free catches', () => {
    const game = session();
    const pet = { ...game.pet };
    const toy = { ...game.toy };
    for (let frame = 0; frame < 20 / STEP; frame += 1) assert.equal(game.step(STEP), false);
    assert.deepEqual(game.pet, pet);
    assert.deepEqual(game.toy, toy);
    assert.equal(game.completed, 0);
    assert.equal(game.throws, 0);
    assert.equal(game.snapshot().interactive, true);
    assert.equal(game.snapshot().dragging, false);
    assert.equal(game.snapshot().teaserStage, 'waiting');
});

test('a held wand goes through planted observation, planted preparation and a bounded jump before catching', () => {
    const game = session();
    start(game);
    const pet = { ...game.pet };
    const observed = [];
    const stages = new Set();
    let rewards = 0;
    let duration = 0;
    while (duration < 5) {
        const snapshot = game.snapshot();
        const action = snapshot.catMotion.action;
        if (observed.at(-1) !== action) observed.push(action);
        stages.add(snapshot.teaserStage);
        assert.equal(snapshot.interactive, true);
        assert.equal(snapshot.dragging, true);
        assert.equal(snapshot.toyVisible, true);
        if (['watch', 'crouch'].includes(action)) {
            assert.deepEqual(game.pet, pet);
            assert.equal(snapshot.catMotion.speed, 0);
            assert.equal(game.completed, 0);
        }
        if (game.step(STEP)) {
            rewards += 1;
            assert.equal(game.phase, 'pouncing');
            assert.ok(game.snapshot().catMotion.progress >= game.contact.progress);
            assert.ok(distance(game.pawPoint(), game.toy) <= game.contactRadius);
        }
        duration += STEP;
        if (game.phase === 'ready') break;
    }
    assert.equal(game.phase, 'ready');
    assert.deepEqual(observed, ['watch', 'crouch', 'pounce', 'bat', 'settle']);
    assert.deepEqual(stages, new Set(['observing', 'preparing', 'jumping', 'contact', 'recovering']));
    assert.equal(rewards, 1);
    assert.equal(game.completed, 1);
    assert.ok(duration < 3);
    assert.equal(game.drag !== null, true);
});

test('airborne paw coordinates and strike timing follow calibrated clip metadata in either direction', () => {
    for (const size of [20, 30, 100, 150]) {
        for (const direction of [-1, 1]) {
            const game = session(size);
            start(game, direction);
            advanceUntil(game, () => game.phase === 'pouncing');
            const toy = { ...game.toy };
            const facing = game.direction;
            const trigger = game.jumpDuration * game.contact.progress;
            while (game.motionTime + STEP < trigger - 1e-9) {
                assert.equal(game.step(STEP), false);
                assert.equal(game.completed, 0);
                assert.equal(game.direction, facing);
            }
            advanceUntil(game, () => game.completed === 1, .1);
            const scale = Math.min(game.petSize.width * .88 / 1280, game.petSize.height * .86 / 1120);
            const paw = {
                x: game.pet.x + (.64 - .5) * 1280 * scale * direction,
                y: game.pet.y + (.38 - .925) * 1120 * scale,
            };
            assert.ok(distance(paw, toy) <= game.contactRadius);
            assert.ok(distance(game.pet, toy) > game.petSize.height * .3, 'the actual strike must be high above the feet');
            assert.equal(game.snapshot().catMotion.contactReady, 1);
            assert.equal(game.jump.height, 0, 'recorded jumping must not gain another window hop');
            advanceUntil(game, () => game.phase === 'batting');
            assert.equal(game.snapshot().catMotion.clip, 'teaser-jump');
            assert.equal(game.snapshot().catMotion.progress, 1);
            assert.equal(game.snapshot().catMotion.clipProgress, 1);
        }
    }
});

test('changing the recorded strike frame retimes both the physical apex and catch window', () => {
    for (const containsJump of [false, true]) {
        for (const frame of [8, 18]) {
            const profile = structuredClone(PROFILE);
            Object.assign(profile.animations['teaser-jump'], { fps: 20, containsJump, contact: { x: .69, y: .3, frame } });
            const game = session(30, AREA, profile);
            start(game);
            advanceUntil(game, () => game.phase === 'pouncing');
            const impact = frame / 24;
            assert.equal(game.jumpDuration, 1.2);
            assert.equal(game.snapshot().catMotion.impactProgress, impact);
            assert.equal(game.jumpLift(impact), 1);
            while (game.motionTime + STEP < impact * 1.2 - 1e-9) assert.equal(game.step(STEP), false);
            assert.equal(game.completed, 0);
            advanceUntil(game, () => game.completed === 1, .1);
            assert.ok(distance(game.pawPoint(), game.toy) <= game.contactRadius);
            assert.ok(game.motionTime / game.jumpDuration < impact + 1 / 24);
            assert.equal(game.jump.height === 0, containsJump);
        }
    }
});

test('moving the feather away during a committed leap evades it without late timer rewards', () => {
    const game = session();
    start(game);
    advanceUntil(game, () => game.phase === 'pouncing');
    const destination = { ...game.jump.destination };
    game.moveDrag({ x: AREA.x + 40, y: AREA.y + 40 }, 1300);
    while (game.motionAction === 'pounce' && game.motionTime / game.jumpDuration < .7) {
        assert.equal(game.step(STEP), false);
        assert.deepEqual(game.jump.destination, destination);
    }
    game.moveDrag(game.pawPoint(), 1400);
    assert.equal(game.endDrag(game.toy, 1416), true);
    advanceUntil(game, () => game.phase === 'ready');
    assert.equal(game.completed, 0);
    for (let frame = 0; frame < 10 / STEP; frame += 1) assert.equal(game.step(STEP), false);
    assert.equal(game.throws, 1);
});

test('release finishes the current attempt then waits; new movement rearms after cooldown', () => {
    const game = session();
    start(game);
    advanceUntil(game, () => game.motionAction === 'crouch');
    assert.equal(game.endDrag(game.toy, 1200), true);
    assert.equal(game.snapshot().dragging, false);
    advanceUntil(game, () => game.phase === 'ready');
    assert.equal(game.completed, 1);
    assert.equal(game.beginDrag(game.toy, 2000), true);
    for (let frame = 0; frame < 2 / STEP; frame += 1) assert.equal(game.step(STEP), false);
    assert.equal(game.throws, 1);
    game.moveDrag(lureNear(game, -1), 2100);
    advanceUntil(game, () => game.throws === 2);
    advanceUntil(game, () => game.phase === 'ready');
    assert.equal(game.completed, 2);
    for (let frame = 0; frame < 5 / STEP; frame += 1) assert.equal(game.step(STEP), false);
    assert.equal(game.throws, 2);
    game.moveDrag(lureNear(game, 1), 3000);
    advanceUntil(game, () => game.phase === 'ready' && game.throws === 3);
    assert.equal(game.completed, 3);
});

test('movement during a jump queues at most one new attempt and respects recovery and cooldown', () => {
    const game = session();
    start(game);
    advanceUntil(game, () => game.phase === 'pouncing');
    game.moveDrag({ x: game.toy.x + 30, y: game.toy.y }, 1200);
    advanceUntil(game, () => game.phase === 'ready');
    const attempts = game.throws;
    for (let frame = 0; frame < .25 / STEP; frame += 1) {
        game.step(STEP);
        assert.equal(game.phase, 'ready');
        assert.equal(game.throws, attempts);
    }
    advanceUntil(game, () => game.throws === attempts + 1, .1);
    advanceUntil(game, () => game.phase === 'ready');
    for (let frame = 0; frame < 5 / STEP; frame += 1) game.step(STEP);
    assert.equal(game.throws, attempts + 1);
});

test('cancelling before contact cannot earn a catch and airborne cancellation lands safely', () => {
    for (const action of ['watch', 'crouch', 'pounce']) {
        const game = session();
        start(game);
        advanceUntil(game, () => game.motionAction === action);
        assert.equal(game.endDrag(game.toy, 1500, true), false);
        assert.equal(game.snapshot().dragging, false);
        for (let frame = 0; frame < 5 / STEP; frame += 1) assert.equal(game.step(STEP), false);
        assert.equal(game.phase, 'ready');
        assert.equal(game.completed, 0);
        assert.equal(game.snapshot().catMotion.speed, 0);
    }
});

test('held lure covers display edges while cat windows and jumps stay bounded at all supported sizes', () => {
    for (const area of [AREA, { x: -1920, y: -400, width: 1920, height: 1080 }]) {
        for (const size of [20, 30, 75, 100, 150]) {
            for (const target of [{ x: area.x - 1000, y: area.y - 1000 }, { x: area.x + area.width + 1000, y: area.y + area.height + 1000 }]) {
                const game = new TeaserPlaySession(homeBounds(size, area), area, PROFILE);
                assert.equal(game.beginDrag(game.toy, 1000), true);
                game.moveDrag(target, 1016);
                const toyBounds = game.getToyBounds();
                assert.ok(toyBounds.x >= area.x && toyBounds.y >= area.y);
                assert.ok(toyBounds.x + toyBounds.width <= area.x + area.width);
                assert.ok(toyBounds.y + toyBounds.height <= area.y + area.height);
                const origin = { ...game.pet };
                for (let frame = 0; frame < 5 / STEP; frame += 1) {
                    const rewarded = game.step([STEP, 1 / 60, .05][frame % 3]);
                    const bounds = game.getPetBounds();
                    assert.ok(bounds.x >= area.x && bounds.y >= area.y);
                    assert.ok(bounds.x + bounds.width <= area.x + area.width);
                    assert.ok(bounds.y + bounds.height <= area.y + area.height);
                    assert.ok(distance(origin, game.pet) <= game.jumpRange + game.jumpHeight + 1e-7);
                    assert.equal(game.snapshot().interactive, true);
                    if (rewarded) assert.ok(distance(game.pawPoint(), game.toy) <= game.contactRadius);
                    if (game.phase === 'ready') break;
                }
                assert.equal(game.phase, 'ready');
                assert.equal(game.completed, 0);
            }
        }
    }
});

test('invalid inputs and repeated begin/end events do not restart or teleport an active hunt', () => {
    const game = session();
    assert.equal(game.beginDrag({ x: NaN, y: 3 }, 0), false);
    start(game);
    assert.equal(game.beginDrag(game.toy, 1), false);
    advanceUntil(game, () => game.phase === 'pouncing');
    const before = { pet: { ...game.pet }, toy: { ...game.toy }, snapshot: game.snapshot() };
    for (const elapsed of [0, -1, NaN, Infinity, undefined]) assert.equal(game.step(elapsed), false);
    for (const point of [null, { x: Infinity, y: 0 }, { x: 0, y: NaN }]) game.moveDrag(point, 0);
    assert.deepEqual({ pet: game.pet, toy: game.toy, snapshot: game.snapshot() }, before);
    assert.equal(game.endDrag(game.toy, 1000), true);
    assert.equal(game.endDrag(game.toy, 1001), false);
    const time = game.motionTime;
    game.step(1000);
    assert.ok(game.motionTime <= time + .05 + 1e-8);
});

test('prototype gameplay is marked, while an uncalibrated recorded jump cannot award a foot-level catch', () => {
    const prototype = session(30, AREA, { width: 1280, height: 1120, animations: {} });
    start(prototype);
    advanceUntil(prototype, () => prototype.phase === 'ready');
    assert.equal(prototype.completed, 1);
    assert.equal(prototype.snapshot().catMotion.prototype, 1);
    assert.equal(prototype.snapshot().catMotion.contactReady, 0);
    for (const contact of [undefined, { x: .5, y: .3, frame: 99 }, { x: NaN, y: .3, frame: 12 }]) {
        const profile = structuredClone(PROFILE);
        profile.animations['teaser-jump'].contact = contact;
        const game = session(30, AREA, profile);
        start(game);
        advanceUntil(game, () => game.phase === 'ready');
        assert.equal(game.completed, 0);
        assert.equal(game.pawPoint(), null);
        assert.equal(game.snapshot().catMotion.contactReady, 0);
        assert.equal(game.snapshot().catMotion.prototype, 0);
    }
});
