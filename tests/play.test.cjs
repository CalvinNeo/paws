const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PlaySession, TOY_SIZE, toyHitTest, mouthPoint } = require('../src/play.cjs');
const { homeBounds, petSize } = require('../src/geometry.cjs');

const AREA = { x: 0, y: 25, width: 1440, height: 815 };
const PET = { x: 990, y: 550, width: 300, height: 266 };

function throwToy(game, target, now = 1000) {
    assert.equal(game.beginDrag(game.toy, now), true);
    game.moveDrag(target, now + 100);
    assert.equal(game.endDrag(target, now + 130), true);
}

function finishRound(game) {
    const phases = new Set([game.phase]);
    let completions = 0;
    for (let frame = 0; frame < 3000; frame += 1) {
        if (game.step(1 / 60)) completions += 1;
        phases.add(game.phase);
        if (game.phase === 'ready' && game.completed) break;
    }
    assert.equal(game.phase, 'ready');
    assert.equal(completions, 1);
    return phases;
}

test('only painted toy shapes hit; padding, gaps and invalid coordinates pass through', () => {
    const size = 100;
    for (const kind of ['bone', 'ball', 'yarn', 'bubble']) {
        assert.equal(toyHitTest(kind, { x: 50, y: 50 }, size), true);
        for (const point of [{ x: 0, y: 0 }, { x: 50, y: 5 }, { x: 99, y: 99 }, { x: -2, y: 50 }, { x: NaN, y: 50 }]) {
            assert.equal(toyHitTest(kind, point, size), false);
        }
    }
    assert.equal(toyHitTest('bone', { x: 50, y: 34 }, size), false);
    assert.equal(toyHitTest('bone', { x: 22, y: 34 }, size), true);
    assert.equal(toyHitTest('bone', { x: 78, y: 66 }, size), true);
    assert.equal(toyHitTest('ball', { x: 21, y: 50 }, size), false);
    assert.equal(toyHitTest('bubble', { x: 21, y: 50 }, size), true);
    assert.equal(toyHitTest('unknown', { x: 50, y: 50 }, size), false);
});

test('opening a game neither moves the toy automatically nor earns any reward', () => {
    const game = new PlaySession('fetch', PET, AREA);
    const original = { ...game.toy };
    for (let frame = 0; frame < 100; frame += 1) assert.equal(game.step(0.016), false);
    assert.equal(game.phase, 'ready');
    assert.equal(game.completed, 0);
    assert.deepEqual(game.toy, original);
    assert.equal(game.snapshot().interactive, true);
    assert.throws(() => new PlaySession('unknown', PET, AREA), /available/);
});

test('a bone travels, is picked up, is carried home, and is available for another throw', () => {
    const game = new PlaySession('fetch', PET, AREA);
    const home = { ...game.toy };
    throwToy(game, { x: 450, y: 320 });
    assert.equal(game.phase, 'flying');
    assert.equal(game.snapshot().interactive, false);
    assert.equal(game.beginDrag(game.toy, 2000), false);
    const phases = finishRound(game);
    for (const phase of ['flying', 'chasing', 'picking-up', 'returning', 'celebrating', 'ready']) assert.ok(phases.has(phase));
    assert.deepEqual(game.toy, home);
    assert.equal(game.completed, 1);
    assert.equal(game.throws, 1);
    assert.equal(game.snapshot().carrying, null);
    assert.equal(game.snapshot().toyVisible, true);
    assert.ok(Math.hypot(game.pet.x - home.x, game.pet.y - home.y) < 3);
    throwToy(game, { x: 680, y: 390 }, 3000);
    finishRound(game);
    assert.equal(game.completed, 2);
});

test('carrying is visible only on the puppy, not as a second clickable toy', () => {
    const game = new PlaySession('fetch', PET, AREA);
    throwToy(game, { x: 400, y: 390 });
    for (let frame = 0; frame < 2000 && game.phase !== 'returning'; frame += 1) game.step(0.016);
    assert.equal(game.phase, 'returning');
    assert.equal(game.snapshot().carrying, 'bone');
    assert.equal(game.snapshot().toyVisible, false);
    assert.equal(game.snapshot().interactive, false);
    assert.equal(game.snapshot().behavior, 'walking');
});

test('a fast flick travels farther than a held-and-dropped bone', () => {
    const fast = new PlaySession('fetch', PET, AREA);
    const slow = new PlaySession('fetch', PET, AREA);
    const target = { x: 650, y: 460 };
    throwToy(fast, target);
    slow.beginDrag(slow.toy, 1000);
    slow.moveDrag(target, 1400);
    slow.moveDrag(target, 1800);
    slow.endDrag(target, 1900);
    assert.deepEqual(slow.flightEnd, target);
    assert.ok(Math.hypot(fast.flightEnd.x - target.x, fast.flightEnd.y - target.y) > 50);
});

test('cancelling a drag and tiny accidental clicks never start a round', () => {
    for (const mode of ['fetch', 'ball', 'bubbles']) {
        const game = new PlaySession(mode, PET, AREA);
        const original = { ...game.toy };
        game.beginDrag(original, 1000);
        game.moveDrag({ x: 600, y: 350 }, 1100);
        assert.equal(game.endDrag({ x: 600, y: 350 }, 1200, true), false);
        assert.deepEqual(game.toy, original);
        assert.equal(game.phase, 'ready');
        assert.equal(game.throws, 0);
        if (mode !== 'bubbles') {
            game.beginDrag(original, 1300);
            assert.equal(game.endDrag(original, 1400), false);
            assert.equal(game.throws, 0);
        }
        assert.equal(game.beginDrag({ x: Infinity, y: 4 }, 1600), false);
    }
});

test('a ball bounces inside the display and is nudged back to the launch point', () => {
    const game = new PlaySession('ball', PET, AREA);
    const home = { ...game.toy };
    throwToy(game, { x: game.arena.left, y: game.arena.top });
    assert.equal(game.phase, 'rolling');
    assert.ok(game.velocity.x < 0);
    game.step(0.05);
    assert.ok(game.velocity.x > 0);
    const phases = finishRound(game);
    assert.ok(phases.has('nudging'));
    assert.deepEqual(game.toy, home);
    assert.equal(game.completed, 1);
});

test('clicking a bubble releases it and the puppy must catch it before earning a round', () => {
    const game = new PlaySession('bubbles', PET, AREA);
    game.beginDrag(game.toy, 1000);
    assert.equal(game.endDrag(game.toy, 1080), true);
    assert.equal(game.completed, 0);
    assert.equal(game.phase, 'floating');
    const original = { ...game.toy };
    game.step(0.05);
    assert.notDeepEqual(game.toy, original);
    finishRound(game);
    assert.equal(game.completed, 1);
    assert.ok(Math.hypot(game.toy.x - game.pet.x, game.toy.y - game.pet.y) > 30);
});

test('every frame keeps pet and toy inside monitors with negative and positive origins', () => {
    for (const area of [AREA, { x: -1920, y: -400, width: 1920, height: 1080 }]) {
        for (const mode of ['fetch', 'ball', 'bubbles']) {
            const game = new PlaySession(mode, { ...PET, x: area.x + 300, y: area.y + 300 }, area);
            throwToy(game, { x: area.x - 10000, y: area.y - 10000 });
            for (let frame = 0; frame < 2000; frame += 1) {
                game.step(0.016);
                const bounds = game.getPetBounds();
                assert.ok(bounds.x >= area.x && bounds.y >= area.y);
                assert.ok(bounds.x + bounds.width <= area.x + area.width);
                assert.ok(bounds.y + bounds.height <= area.y + area.height);
                assert.ok(game.toy.x - TOY_SIZE / 2 >= area.x);
                assert.ok(game.toy.y - TOY_SIZE / 2 >= area.y);
                assert.ok(game.toy.x + TOY_SIZE / 2 <= area.x + area.width);
                assert.ok(game.toy.y + TOY_SIZE / 2 <= area.y + area.height);
                if (game.phase === 'ready') break;
            }
        }
    }
});

test('a delayed or backwards frame does not teleport the puppy', () => {
    const game = new PlaySession('fetch', PET, AREA);
    throwToy(game, { x: 450, y: 400 });
    for (let frame = 0; frame < 60 && game.phase !== 'chasing'; frame += 1) game.step(0.016);
    const before = { ...game.pet };
    game.step(-5);
    assert.deepEqual(game.pet, before);
    game.step(1000);
    assert.ok(Math.hypot(game.pet.x - before.x, game.pet.y - before.y) <= 21.01);
});

test('all games complete with a 30-percent puppy and larger custom sizes', () => {
    for (const size of [20, 30, 75, 150]) {
        for (const mode of ['fetch', 'ball', 'bubbles']) {
            const game = new PlaySession(mode, homeBounds(size, AREA), AREA);
            throwToy(game, { x: 500, y: 380 });
            finishRound(game);
            const bounds = game.getPetBounds();
            assert.equal(bounds.width, petSize(size).width);
            assert.equal(bounds.height, petSize(size).height);
            assert.equal(game.completed, 1);
        }
    }
});

test('photo-cat games align the interaction point and stay inside negative-origin displays at every size', () => {
    const area = { x: -1920, y: -400, width: 1920, height: 1080 };
    assert.equal(mouthPoint(PET, 'cat').y, PET.y + PET.height * .8955);
    assert.equal(mouthPoint(PET, 'dog').y, PET.y + PET.height * .61);
    for (const size of [20, 30, 43, 100, 150]) {
        for (const mode of ['pounce', 'bubbles']) {
            const game = new PlaySession(mode, homeBounds(size, area), area, 'cat');
            assert.equal(game.mouthRatio, .8955);
            throwToy(game, { x: area.x - 10000, y: area.y - 10000 });
            for (let frame = 0; frame < 3000; frame += 1) {
                game.step(1 / 60);
                const bounds = game.getPetBounds();
                assert.ok(bounds.x >= area.x && bounds.y >= area.y);
                assert.ok(bounds.x + bounds.width <= area.x + area.width);
                assert.ok(bounds.y + bounds.height <= area.y + area.height);
                assert.ok(Math.abs(mouthPoint(bounds, 'cat').x - game.pet.x) <= .5);
                assert.ok(Math.abs(mouthPoint(bounds, 'cat').y - game.pet.y) <= .5);
                assert.equal(game.snapshot().carrying, null);
                assert.ok(!['returning', 'nudging', 'picking-up'].includes(game.phase));
                if (game.phase === 'ready' && game.completed) break;
            }
            assert.equal(game.completed, 1);
            assert.equal(game.phase, 'ready');
        }
    }
});

test('cat pounces watch, catch and bat the ball without bringing it back', () => {
    const game = new PlaySession('pounce', PET, AREA, 'cat');
    const originalToy = { ...game.toy };
    const originalPet = { ...game.pet };
    assert.equal(game.snapshot().toy, 'yarn');
    for (let frame = 0; frame < 100; frame += 1) game.step(1 / 60);
    assert.deepEqual(game.toy, originalToy);
    assert.deepEqual(game.pet, originalPet);
    assert.equal(game.completed, 0);
    throwToy(game, { x: 480, y: 340 });
    assert.equal(game.phase, 'watching');
    for (let frame = 0; frame < 20; frame += 1) game.step(1 / 60);
    assert.deepEqual(game.pet, originalPet);
    assert.equal(game.completed, 0);
    assert.equal(game.snapshot().interactive, false);
    const phases = finishRound(game);
    for (const phase of ['watching', 'pouncing', 'batting', 'celebrating', 'ready']) assert.ok(phases.has(phase));
    for (const phase of ['returning', 'nudging', 'picking-up']) assert.equal(phases.has(phase), false);
    assert.ok(Math.hypot(game.toy.x - originalToy.x, game.toy.y - originalToy.y) > 50);
    assert.ok(Math.hypot(game.toy.x - game.pet.x, game.toy.y - game.pet.y) > 30);
    const battedToy = { ...game.toy };
    for (let frame = 0; frame < 100; frame += 1) assert.equal(game.step(1 / 60), false);
    assert.deepEqual(game.toy, battedToy);
    assert.equal(game.snapshot().carrying, null);
    throwToy(game, { x: 700, y: 440 }, 3000);
    finishRound(game);
    assert.equal(game.completed, 2);
});

test('cat bubble hunts watch before pouncing and award only completed catches', () => {
    const game = new PlaySession('bubbles', PET, AREA, 'cat');
    const initialPet = { ...game.pet };
    game.beginDrag(game.toy, 1000);
    assert.equal(game.endDrag(game.toy, 1100), true);
    assert.equal(game.phase, 'watching');
    game.step(.05);
    assert.deepEqual(game.pet, initialPet);
    assert.equal(game.completed, 0);
    const phases = finishRound(game);
    assert.ok(phases.has('pouncing'));
    assert.ok(phases.has('batting'));
    assert.ok(phases.has('celebrating'));
    assert.equal(phases.has('returning'), false);
    assert.equal(game.snapshot().toy, 'bubble');
    assert.equal(game.snapshot().carrying, null);
});

test('cat sessions reject dog games and cancelled drags never begin a hunt', () => {
    for (const mode of ['fetch', 'ball']) assert.throws(() => new PlaySession(mode, PET, AREA, 'cat'), /not available for your cat/);
    assert.throws(() => new PlaySession('pounce', PET, AREA, 'dog'), /not available for your dog/);
    for (const mode of ['pounce', 'bubbles']) {
        const game = new PlaySession(mode, PET, AREA, 'cat');
        const original = { ...game.toy };
        game.beginDrag(original, 1000);
        assert.equal(game.endDrag({ x: 400, y: 350 }, 1100, true), false);
        assert.deepEqual(game.toy, original);
        assert.equal(game.phase, 'ready');
        assert.equal(game.completed, 0);
        assert.equal(game.throws, 0);
    }
});
