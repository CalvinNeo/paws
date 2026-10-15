const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { CatPlaySession } = require('../src/play/cat.cjs');
const { PlaySession } = require('../src/play.cjs');
const { homeBounds, petSize } = require('../src/geometry.cjs');
const { catTransform, catPhaseTime, sampleCatClip } = require('../src/renderer/cat-animation.mjs');

const AREA = { x: 0, y: 25, width: 1440, height: 815 };
const STEP = 1 / 120;
const ACTIONS = ['idle', 'watch', 'crouch', 'run', 'pounce', 'bat', 'settle'];

function separation(first, second) {
    return Math.hypot(first.x - second.x, first.y - second.y);
}

function releaseToy(game, target = { x: 420, y: 350 }) {
    assert.equal(game.beginDrag(game.toy, 1000), true);
    game.moveDrag(target, 1100);
    assert.equal(game.endDrag(target, 1140), true);
}

function advanceUntil(game, condition, maximumSeconds = 30) {
    for (let frame = 0; frame < maximumSeconds / STEP && !condition(); frame += 1) game.step(STEP);
    assert.ok(condition(), `Timed out at ${game.phase}/${game.snapshot().catMotion.action}`);
}

function assertMotion(game) {
    const motion = game.snapshot().catMotion;
    assert.ok(ACTIONS.includes(motion.action));
    for (const field of ['progress', 'speed', 'stride', 'lift']) {
        assert.equal(typeof motion[field], 'number');
        assert.ok(Number.isFinite(motion[field]), `${field} must be finite`);
        assert.ok(motion[field] >= 0, `${field} must be nonnegative`);
    }
    for (const field of ['progress', 'stride', 'lift']) assert.ok(motion[field] <= 1, `${field} must be normalized`);
    assert.equal(game.snapshot().carrying, null);
    assert.equal(motion.speed, Math.hypot(game.petVelocity.x, game.petVelocity.y));
    assert.ok([-1, 1].includes(motion.facing));
    assert.equal(motion.facing, game.direction);
    assert.ok(motion.impactProgress > 0 && motion.impactProgress < 1);
    assert.ok([0, 1].includes(motion.impacted));
    assert.deepEqual(game.snapshot().catMotion, motion);
}

function stageLayout() {
    const css = fs.readFileSync(path.join(__dirname, '../src/renderer/pet.css'), 'utf8');
    const stage = css.match(/(?:^|\n)pet-avatar\s*\{([^}]+)\}/)?.[1];
    assert.ok(stage, 'the desktop pet must have a stage layout');
    const layout = {};
    for (const property of ['width', 'height', 'bottom', 'left']) {
        const declaration = stage.match(new RegExp(`(?:^|;)\\s*${property}:\\s*([\\d.]+)%`));
        assert.ok(declaration, `the stage ${property} must be a percentage`);
        layout[property] = Number(declaration[1]) / 100;
    }
    return layout;
}

test('cat contact aligns with the rendered paw baseline across sizes, atlas resolutions and screen edges', () => {
    const layout = stageLayout();
    const resolutions = [{ width: 1280, height: 1120 }, { width: 768, height: 672 }];
    for (const area of [AREA, { x: -1920, y: -400, width: 1920, height: 1080 }]) {
        for (let size = 20; size <= 150; size += 1) {
            for (const mode of ['pounce', 'bubbles']) {
                const game = new CatPlaySession(mode, homeBounds(size, area), area);
                const positions = [
                    { ...game.pet },
                    { x: area.x - 1000, y: area.y - 1000 },
                    { x: area.x + area.width + 1000, y: area.y - 1000 },
                    { x: area.x - 1000, y: area.y + area.height + 1000 },
                    { x: area.x + area.width + 1000, y: area.y + area.height + 1000 },
                ];
                for (const position of positions) {
                    game.pet = game.constrain(position);
                    const bounds = game.getPetBounds();
                    assert.ok(bounds.x >= area.x && bounds.y >= area.y);
                    assert.ok(bounds.x + bounds.width <= area.x + area.width);
                    assert.ok(bounds.y + bounds.height <= area.y + area.height);
                    assert.ok(game.pet.x - game.toySize / 2 >= area.x && game.pet.y - game.toySize / 2 >= area.y);
                    assert.ok(game.pet.x + game.toySize / 2 <= area.x + area.width);
                    assert.ok(game.pet.y + game.toySize / 2 <= area.y + area.height);
                    const stageWidth = bounds.width * layout.width;
                    const stageHeight = bounds.height * layout.height;
                    for (const resolution of resolutions) {
                        const scale = Math.min(stageWidth / resolution.width, stageHeight / resolution.height);
                        const paw = {
                            x: bounds.x + bounds.width * layout.left + (stageWidth - resolution.width * scale) / 2 + resolution.width * .5 * scale,
                            y: bounds.y + bounds.height * (1 - layout.bottom - layout.height) + (stageHeight - resolution.height * scale) / 2 + resolution.height * .925 * scale,
                        };
                        const context = `${mode}, ${size}%, ${resolution.width}×${resolution.height}, screen origin ${area.x},${area.y}`;
                        assert.ok(Math.abs(paw.x - game.pet.x) <= .5 + 1e-8, `paw/contact horizontal alignment: ${context}`);
                        assert.ok(Math.abs(paw.y - game.pet.y) <= .5 + 1e-8, `paw/contact vertical alignment: ${context}`);
                    }
                }
            }
        }
    }
});

test('a cat observes and turns, then crouches without sliding before accelerating', () => {
    const game = new CatPlaySession('pounce', { x: 200, y: 400, ...petSize(30) }, AREA);
    const start = { ...game.pet };
    releaseToy(game, { x: 1000, y: 400 });
    assert.equal(game.snapshot().catMotion.action, 'watch');
    let crouchFrames = 0;
    while (game.phase === 'watching') {
        assert.deepEqual(game.pet, start);
        assert.equal(game.snapshot().catMotion.speed, 0);
        assert.equal(game.completed, 0);
        if (game.snapshot().catMotion.action === 'crouch') crouchFrames += 1;
        assert.equal(game.step(STEP), false);
    }
    assert.equal(game.direction, 1);
    assert.ok(crouchFrames >= 18);
    assert.deepEqual(game.pet, start);
    assert.equal(game.snapshot().catMotion.action, 'run');
    game.step(STEP);
    assert.ok(game.snapshot().catMotion.speed > 0);
    assert.ok(game.snapshot().catMotion.speed <= game.acceleration * STEP + 1e-8);
    assert.ok(separation(game.pet, start) < .1);
});

test('a pursuing cat faces a reversing target before its momentum can reverse', () => {
    for (const direction of [-1, 1]) {
        const game = new CatPlaySession('pounce', { x: 650, y: 400, ...petSize(30) }, AREA);
        releaseToy(game, { x: game.pet.x + direction * 350, y: game.pet.y });
        game.velocity = { x: 0, y: 0 };
        advanceUntil(game, () => game.snapshot().catMotion.speed > game.runSpeed * .6);
        assert.equal(game.snapshot().catMotion.facing, direction);
        assert.equal(Math.sign(game.petVelocity.x), direction);
        game.toy = { x: game.pet.x - direction * 300, y: game.pet.y };
        const previousVelocity = { ...game.petVelocity };
        game.step(STEP);
        assert.equal(game.snapshot().catMotion.facing, -direction);
        assert.equal(Math.sign(game.petVelocity.x), direction);
        assert.ok(separation(previousVelocity, game.petVelocity) <= game.acceleration * STEP + 1e-7);
        advanceUntil(game, () => game.phase === 'batting');
        const facing = game.snapshot().catMotion.facing;
        for (let frame = 0; frame < 240 && game.phase !== 'ready'; frame += 1) {
            game.step(STEP);
            assert.equal(game.snapshot().catMotion.facing, facing);
        }
        assert.equal(game.phase, 'ready');
        assert.equal(game.completed, 1);
    }
});

test('the rendered leading paw reaches the toy at the strike frame in both directions and every size', () => {
    const layout = stageLayout();
    const clip = { frames: 19, fps: 24, loop: false };
    for (const area of [AREA, { x: -1920, y: -400, width: 1920, height: 1080 }]) {
        for (const size of [20, 30, 100, 150]) {
            for (const direction of [-1, 1]) {
                for (const mode of ['pounce', 'bubbles']) {
                    const dimensions = petSize(size);
                    const game = new CatPlaySession(mode, {
                        x: area.x + area.width / 2 - dimensions.width / 2,
                        y: area.y + area.height / 2 - dimensions.height * .8955,
                        ...dimensions,
                    }, area);
                    releaseToy(game, { x: game.pet.x + direction * 180, y: game.pet.y - 50 });
                    game.velocity = { x: 0, y: 0 };
                    advanceUntil(game, () => game.phase === 'batting', 15);
                    const toy = { ...game.toy };
                    let windupTime = 0;
                    while (!game.completed && windupTime < .8) {
                        assert.equal(game.snapshot().toyVisible, true);
                        assert.deepEqual(game.velocity, { x: 0, y: 0 });
                        game.step(STEP);
                        windupTime += STEP;
                        assert.deepEqual(game.toy, toy, 'the toy must wait for the paw, without teleporting');
                    }
                    assert.equal(game.completed, 1);
                    assert.ok(Math.abs(windupTime - .65 * 2 / 3) <= STEP + 1e-8);
                    const motion = game.snapshot().catMotion;
                    assert.equal(motion.facing, direction);
                    assert.equal(sampleCatClip(clip, catPhaseTime(clip, 'bat', motion), 'bat').frame, 12);
                    const bounds = game.getPetBounds();
                    assert.ok(bounds.x >= area.x && bounds.y >= area.y);
                    assert.ok(bounds.x + bounds.width <= area.x + area.width);
                    assert.ok(bounds.y + bounds.height <= area.y + area.height);
                    for (const resolution of [{ width: 1280, height: 1120 }, { width: 768, height: 672 }]) {
                        const transform = catTransform({ ...resolution, direction, action: 'bat', animated: true, gameMotion: motion });
                        const stageWidth = bounds.width * layout.width;
                        const stageHeight = bounds.height * layout.height;
                        const scale = Math.min(stageWidth / resolution.width, stageHeight / resolution.height);
                        const paw = {
                            x: bounds.x + bounds.width * layout.left + (stageWidth - resolution.width * scale) / 2
                                + (resolution.width * .66 * transform.scaleX + transform.translateX) * scale,
                            y: bounds.y + bounds.height * (1 - layout.bottom - layout.height) + (stageHeight - resolution.height * scale) / 2
                                + (resolution.height * .9 * transform.scaleY + transform.translateY) * scale,
                        };
                        assert.ok(Math.abs(paw.x - game.pawPoint().x) <= .5 + 1e-8);
                        assert.ok(Math.abs(paw.y - game.pawPoint().y) <= .5 + 1e-8);
                        assert.ok((paw.x - game.pet.x) * direction > 0, 'the striking paw must lead the body');
                        assert.ok(separation(paw, game.toy) <= game.contactRadius + Math.SQRT1_2 + 1e-8);
                    }
                    assert.equal(game.snapshot().toyVisible, mode === 'pounce');
                    if (mode === 'pounce') {
                        assert.equal(Math.sign(game.velocity.x), direction);
                        assert.equal(game.step(STEP), false);
                        assert.ok((game.toy.x - toy.x) * direction > 0, 'the ball leaves the paw in the facing direction');
                    }
                    advanceUntil(game, () => game.phase === 'ready', 2);
                    assert.equal(game.completed, 1);
                }
            }
        }
    }
});

test('cat movement accelerates, makes a short pounce, bats, and settles continuously', () => {
    const game = new CatPlaySession('pounce', homeBounds(30, AREA), AREA);
    releaseToy(game);
    const actions = new Set();
    const phases = new Set();
    const settlingSpeeds = [];
    let rewards = 0;
    let lifted = false;
    let strideChanged = false;
    let previousStride = 0;
    let peakSpeed = 0;
    let pounceFrames = 0;
    for (let frame = 0; frame < 3600; frame += 1) {
        const previousVelocity = { ...game.petVelocity };
        const previousPet = { ...game.pet };
        if (game.step(STEP)) rewards += 1;
        const motion = game.snapshot().catMotion;
        actions.add(motion.action);
        phases.add(game.phase);
        assertMotion(game);
        assert.ok(separation(previousVelocity, game.petVelocity) <= game.acceleration * STEP + 1e-7);
        assert.ok(separation(previousPet, game.pet) <= game.runSpeed * 1.15 * STEP + 1e-7);
        peakSpeed = Math.max(peakSpeed, motion.speed);
        if (motion.action === 'pounce') pounceFrames += 1;
        if (motion.lift > .1) lifted = true;
        if (motion.stride !== previousStride) strideChanged = true;
        if (game.phase === 'batting' || game.phase === 'celebrating') settlingSpeeds.push(motion.speed);
        previousStride = motion.stride;
        if (game.phase === 'ready') break;
    }
    assert.equal(game.phase, 'ready');
    assert.equal(game.completed, 1);
    assert.equal(rewards, 1);
    for (const action of ACTIONS) assert.ok(actions.has(action), `Missing ${action}`);
    assert.deepEqual(phases, new Set(['watching', 'pouncing', 'batting', 'celebrating', 'ready']));
    assert.ok(peakSpeed > game.runSpeed * .9);
    assert.ok(pounceFrames * STEP <= .4);
    assert.ok(lifted);
    assert.ok(strideChanged);
    assert.ok(settlingSpeeds.some((speed) => speed > 0));
    for (let index = 1; index < settlingSpeeds.length; index += 1) assert.ok(settlingSpeeds[index] <= settlingSpeeds[index - 1] + 1e-8);
    assert.equal(game.snapshot().catMotion.speed, 0);
    assert.equal(game.snapshot().catMotion.lift, 0);
});

test('a paw must physically reach the toy before a bat or bubble catch can earn a reward', () => {
    for (const mode of ['pounce', 'bubbles']) {
        const game = new CatPlaySession(mode, homeBounds(30, AREA), AREA);
        releaseToy(game);
        let windingUp = false;
        let rewards = 0;
        for (let frame = 0; frame < 3600; frame += 1) {
            const previousPaw = game.pawPoint();
            const previousToy = { ...game.toy };
            const previousPhase = game.phase;
            const toySpeed = Math.hypot(game.velocity.x, game.velocity.y);
            const rewarded = game.step(STEP);
            if (!windingUp && game.phase === 'batting') {
                assert.equal(previousPhase, 'pouncing');
                const sweptDistance = separation(previousPaw, game.pawPoint()) + toySpeed * STEP;
                assert.ok(separation(previousPaw, previousToy) <= game.contactRadius + sweptDistance + 1e-7);
                windingUp = true;
                assert.equal(game.completed, 0);
                assert.equal(rewarded, false);
            }
            if (!rewards && !rewarded) {
                assert.equal(rewarded, false);
                assert.equal(game.completed, 0);
            }
            if (rewarded) {
                rewards += 1;
                assert.ok(windingUp);
                assert.equal(previousPhase, 'batting');
                assert.equal(game.phase, 'batting');
                assert.ok(separation(game.pawPoint(), game.toy) <= game.contactRadius + 1e-7);
                assert.ok(game.snapshot().catMotion.progress >= game.snapshot().catMotion.impactProgress);
                assert.equal(game.snapshot().catMotion.impacted, 1);
            }
            if (game.phase === 'ready') break;
        }
        assert.ok(windingUp);
        assert.equal(rewards, 1);
        assert.equal(game.completed, 1);
        assert.equal(game.phase, 'ready');
        const restingPet = { ...game.pet };
        for (let frame = 0; frame < 120; frame += 1) assert.equal(game.step(STEP), false);
        assert.deepEqual(game.pet, restingPet);
    }
});

test('the full paw swipe remains visible before a brief recovery, with one reward at contact', () => {
    for (const [mode, elapsed] of [['pounce', 1 / 60], ['pounce', .05], ['bubbles', 1 / 60], ['bubbles', .05]]) {
        const game = new CatPlaySession(mode, homeBounds(30, AREA), AREA);
        releaseToy(game);
        advanceUntil(game, () => game.phase === 'batting');
        assert.equal(game.completed, 0);
        let rewards = 0;
        let batTime = 0;
        let lastProgress = 0;
        while (game.phase === 'batting' && batTime < 1) {
            lastProgress = game.snapshot().catMotion.progress;
            assert.equal(game.snapshot().catMotion.action, 'bat');
            if (game.step(elapsed)) rewards += 1;
            batTime += elapsed;
        }
        assert.equal(game.phase, 'celebrating');
        assert.ok(batTime >= .55 && batTime <= .8);
        assert.equal(lastProgress, 1, 'the last animation frame must be displayed before recovery');
        let settleTime = 0;
        while (game.phase === 'celebrating' && settleTime < 1) {
            assert.equal(game.snapshot().catMotion.action, 'settle');
            assert.equal(game.step(elapsed), false);
            settleTime += elapsed;
        }
        assert.equal(game.phase, 'ready');
        assert.ok(settleTime >= .3 - 1e-8 && settleTime <= .4 + 1e-8);
        assert.equal(game.completed, 1);
        assert.equal(rewards, 1);
    }
});

test('a popped bubble stays hidden through the paw swipe and recovery, then reappears nearby for the next round', () => {
    const game = new CatPlaySession('bubbles', homeBounds(30, AREA), AREA);
    for (let round = 1; round <= 2; round += 1) {
        assert.equal(game.snapshot().toyVisible, true);
        assert.equal(game.snapshot().interactive, true);
        assert.equal(game.beginDrag(game.toy, round * 1000), true);
        assert.equal(game.endDrag(game.toy, round * 1000 + 100), true);
        let rewards = 0;
        let caughtBubble;
        const phases = new Set([game.phase]);
        for (let frame = 0; frame < 15 / STEP; frame += 1) {
            const previousPhase = game.phase;
            const rewarded = game.step(STEP);
            const snapshot = game.snapshot();
            phases.add(game.phase);
            if (rewarded) {
                rewards += 1;
                assert.equal(previousPhase, 'batting');
                assert.equal(game.phase, 'batting');
                assert.equal(snapshot.catMotion.action, 'bat');
                assert.equal(snapshot.behavior, 'playing');
                assert.equal(snapshot.toyVisible, false);
                assert.equal(game.completed, round);
                caughtBubble = { ...game.toy };
            }
            if (caughtBubble && ['batting', 'celebrating'].includes(game.phase)) {
                assert.equal(snapshot.toyVisible, false);
                assert.equal(snapshot.interactive, false);
                assert.deepEqual(game.toy, caughtBubble);
                assert.equal(game.completed, round);
                assert.equal(game.beginDrag(game.toy, round * 1000 + 200), false);
            } else {
                assert.equal(snapshot.toyVisible, true);
                if (game.phase === 'batting') {
                    assert.equal(game.completed, round - 1);
                    assert.equal(snapshot.interactive, false);
                }
            }
            if (game.phase === 'ready') break;
        }
        assert.deepEqual(phases, new Set(['watching', 'pouncing', 'batting', 'celebrating', 'ready']));
        assert.equal(rewards, 1);
        assert.equal(game.completed, round);
        assert.deepEqual(game.toy, game.nearby(game.pet));
        assert.ok(separation(game.toy, caughtBubble) > 30);
        assert.ok(separation(game.toy, game.pet) > 30);
        assert.equal(game.snapshot().toyVisible, true);
        assert.equal(game.snapshot().interactive, true);
        for (let frame = 0; frame < 120; frame += 1) assert.equal(game.step(STEP), false);
    }
});

test('both cat games finish a desktop smoke-test throw within fifteen seconds', () => {
    for (const size of [20, 30, 100, 150]) {
        for (const mode of ['pounce', 'bubbles']) {
            const game = new CatPlaySession(mode, homeBounds(size, AREA), AREA);
            const origin = { ...game.toy };
            assert.equal(game.beginDrag(origin, 1000), true);
            for (let step = 1; step <= 10; step += 1) {
                game.moveDrag(mode === 'bubbles' ? origin : { x: origin.x - step * 29, y: origin.y - step * 13 }, 1000 + step * 20);
            }
            assert.equal(game.endDrag(game.toy, 1220), true);
            let duration = 0;
            while (game.phase !== 'ready' && duration < 15) {
                game.step(1 / 60);
                duration += 1 / 60;
            }
            assert.equal(game.phase, 'ready', `${mode} at ${size}% must finish within the smoke timeout`);
            assert.equal(game.completed, 1);
            assert.ok(duration < 15);
        }
    }
});

test('a missed pounce resumes tracking without a timer awarding a remote catch', () => {
    for (const mode of ['pounce', 'bubbles']) {
        const game = new CatPlaySession(mode, homeBounds(30, AREA), AREA);
        releaseToy(game);
        advanceUntil(game, () => game.snapshot().catMotion.action === 'pounce');
        game.toy = {
            x: game.pet.x < AREA.width / 2 ? game.arena.right : game.arena.left,
            y: game.arena.top,
        };
        game.velocity = { x: 0, y: 0 };
        for (let frame = 0; frame < 60; frame += 1) {
            assert.equal(game.step(STEP), false);
            assert.equal(game.completed, 0);
            assert.equal(game.phase, 'pouncing');
        }
        assert.equal(game.snapshot().catMotion.action, 'run');
        advanceUntil(game, () => game.phase === 'ready');
        assert.equal(game.completed, 1);
    }
});

test('a toy that escapes a winding-up paw cannot be rewarded by the strike timer', () => {
    for (const mode of ['pounce', 'bubbles']) {
        const game = new CatPlaySession(mode, homeBounds(30, AREA), AREA);
        releaseToy(game);
        advanceUntil(game, () => game.phase === 'batting');
        game.toy = { x: game.pet.x < AREA.width / 2 ? game.arena.right : game.arena.left, y: game.arena.top };
        for (let frame = 0; frame < 100 && game.phase === 'batting'; frame += 1) {
            assert.equal(game.step(STEP), false);
            assert.equal(game.completed, 0);
            assert.equal(game.snapshot().catMotion.impacted, 0);
            assert.equal(game.snapshot().toyVisible, true);
        }
        assert.equal(game.phase, 'pouncing');
        assert.equal(game.snapshot().catMotion.action, 'run');
        advanceUntil(game, () => game.phase === 'ready');
        assert.equal(game.completed, 1);
    }
});

test('small cats take shorter steps and reach distant toys without prolonged games', () => {
    const peaks = new Map();
    for (const size of [20, 30, 100, 150]) {
        const game = new CatPlaySession('pounce', homeBounds(size, AREA), AREA);
        releaseToy(game, { x: game.arena.left, y: game.arena.top });
        let peak = 0;
        let duration = 0;
        while (game.phase !== 'ready' && duration < 25) {
            game.step(STEP);
            duration += STEP;
            peak = Math.max(peak, game.snapshot().catMotion.speed);
        }
        assert.equal(game.phase, 'ready');
        assert.equal(game.completed, 1);
        assert.ok(duration < 25);
        assert.ok(peak <= game.petSize.width * 2.5);
        peaks.set(size, peak);
    }
    assert.ok(peaks.get(20) < peaks.get(30));
    assert.ok(peaks.get(30) < peaks.get(100) * .6);
    assert.ok(peaks.get(100) < peaks.get(150));
});

test('cat tracking and braking stay bounded on negative-origin screens at every size', () => {
    for (const area of [AREA, { x: -1920, y: -400, width: 1920, height: 1080 }]) {
        for (const size of [20, 30, 75, 150]) {
            for (const mode of ['pounce', 'bubbles']) {
                const game = new CatPlaySession(mode, homeBounds(size, area), area);
                releaseToy(game, { x: area.x - 10000, y: area.y - 10000 });
                for (let frame = 0; frame < 3600; frame += 1) {
                    const elapsed = [1 / 120, 1 / 60, 1 / 30, .05][frame % 4];
                    const previousVelocity = { ...game.petVelocity };
                    game.step(elapsed);
                    const bounds = game.getPetBounds();
                    assertMotion(game);
                    assert.ok(separation(previousVelocity, game.petVelocity) <= game.acceleration * elapsed + 1e-6);
                    assert.ok(bounds.x >= area.x && bounds.y >= area.y);
                    assert.ok(bounds.x + bounds.width <= area.x + area.width);
                    assert.ok(bounds.y + bounds.height <= area.y + area.height);
                    assert.ok(game.toy.x - game.toySize / 2 >= area.x);
                    assert.ok(game.toy.y - game.toySize / 2 >= area.y);
                    assert.ok(game.toy.x + game.toySize / 2 <= area.x + area.width);
                    assert.ok(game.toy.y + game.toySize / 2 <= area.y + area.height);
                    if (game.phase === 'ready') break;
                }
                assert.equal(game.phase, 'ready');
                assert.equal(game.completed, 1);
            }
        }
    }
});

test('invalid frame times cannot move or advance a cat, and delayed frames remain bounded', () => {
    const game = new CatPlaySession('pounce', homeBounds(30, AREA), AREA);
    releaseToy(game);
    advanceUntil(game, () => game.snapshot().catMotion.speed > game.runSpeed * .8);
    const before = { pet: { ...game.pet }, toy: { ...game.toy }, snapshot: game.snapshot(), phaseTime: game.phaseTime };
    for (const elapsed of [-1, NaN, Infinity, -Infinity, 0, undefined]) assert.equal(game.step(elapsed), false);
    assert.deepEqual({ pet: game.pet, toy: game.toy, snapshot: game.snapshot(), phaseTime: game.phaseTime }, before);
    game.step(1000);
    assert.ok(separation(game.pet, before.pet) <= game.runSpeed * 1.15 * .05);
    assertMotion(game);
});

test('idle, held, and cancelled toys do not move the cat or award any progress', () => {
    for (const mode of ['pounce', 'bubbles']) {
        const game = new CatPlaySession(mode, homeBounds(30, AREA), AREA);
        const pet = { ...game.pet };
        const toy = { ...game.toy };
        for (let frame = 0; frame < 120; frame += 1) assert.equal(game.step(STEP), false);
        assert.equal(game.beginDrag(game.toy, 1000), true);
        game.moveDrag({ x: 200, y: 350 }, 1100);
        for (let frame = 0; frame < 120; frame += 1) assert.equal(game.step(STEP), false);
        assert.equal(game.completed, 0);
        assert.deepEqual(game.pet, pet);
        assert.equal(game.endDrag({ x: 200, y: 350 }, 1200, true), false);
        for (let frame = 0; frame < 1200; frame += 1) assert.equal(game.step(STEP), false);
        assert.equal(game.phase, 'ready');
        assert.equal(game.completed, 0);
        assert.equal(game.throws, 0);
        assert.deepEqual(game.pet, pet);
        assert.deepEqual(game.toy, toy);
        assert.equal(game.snapshot().catMotion.action, 'idle');
        assert.equal(game.snapshot().catMotion.speed, 0);
    }
});

test('cat motion remains cat-only, and dog games cannot enter a cat session', () => {
    for (const mode of ['fetch', 'ball', 'unknown']) assert.throws(() => new CatPlaySession(mode, homeBounds(30, AREA), AREA), /not available for your cat/);
    for (const mode of ['fetch', 'ball', 'bubbles']) {
        const game = new PlaySession(mode, homeBounds(30, AREA), AREA, 'dog');
        assert.equal('catMotion' in game.snapshot(), false);
        releaseToy(game);
        game.step(.05);
        assert.equal('catMotion' in game.snapshot(), false);
    }
});
