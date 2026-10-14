const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_PET_SIZE, validPetSize, petSize, clampBounds, homeBounds, walkStep } = require('../src/geometry.cjs');

const PRIMARY = { x: 0, y: 25, width: 1440, height: 815 };
const LEFT_MONITOR = { x: -1920, y: -300, width: 1920, height: 1080 };

test('all puppy sizes have deterministic dimensions', () => {
    assert.equal(DEFAULT_PET_SIZE, 30);
    assert.deepEqual(petSize(), { width: 90, height: 80 });
    assert.deepEqual(petSize(20), { width: 60, height: 53 });
    assert.deepEqual(petSize(30), { width: 90, height: 80 });
    assert.deepEqual(petSize(50), { width: 150, height: 133 });
    assert.deepEqual(petSize(80), { width: 240, height: 213 });
    assert.deepEqual(petSize(100), { width: 300, height: 266 });
    assert.deepEqual(petSize(120), { width: 360, height: 319 });
    assert.deepEqual(petSize(150), { width: 450, height: 399 });
    assert.deepEqual(petSize('unknown'), petSize(30));
});

test('size validation rejects out-of-range, fractional and incorrectly typed percentages', () => {
    for (const size of [20, 30, 43, 100, 150]) assert.equal(validPetSize(size), true);
    for (const size of [0, 19, 151, -30, 30.5, '30', null, undefined, NaN, Infinity, {}]) {
        assert.equal(validPetSize(size), false);
        assert.deepEqual(petSize(size), petSize(30));
    }
});

test('saved off-screen bounds recover into the usable display area', () => {
    assert.deepEqual(clampBounds({ x: 4000, y: -500, width: 300, height: 266 }, PRIMARY), {
        x: 1140, y: 25, width: 300, height: 266,
    });
    assert.deepEqual(clampBounds({ x: -3000, y: 2000, width: 300, height: 266 }, LEFT_MONITOR), {
        x: -1920, y: 514, width: 300, height: 266,
    });
});

test('a display smaller than the puppy still keeps the whole window inside', () => {
    assert.deepEqual(clampBounds({ x: 10, y: 10, width: 360, height: 319 }, { x: 0, y: 0, width: 200, height: 150 }), {
        x: 0, y: 0, width: 200, height: 150,
    });
});

test('home placement leaves room above the dock or taskbar, including negative-origin displays', () => {
    for (const area of [PRIMARY, LEFT_MONITOR]) {
        const bounds = homeBounds(150, area);
        assert.ok(bounds.x >= area.x);
        assert.ok(bounds.y >= area.y);
        assert.ok(bounds.x + bounds.width <= area.x + area.width);
        assert.equal(bounds.y + bounds.height, area.y + area.height - 8);
    }
});

test('walking reverses at both edges and clamps long frame delays', () => {
    const bounds = { ...petSize(100), x: 1139, y: 300 };
    assert.deepEqual(walkStep(bounds, 1, 1, PRIMARY), { x: 1140, direction: -1 });
    assert.deepEqual(walkStep({ ...bounds, x: 1 }, -1, 1, PRIMARY), { x: 0, direction: 1 });
    assert.deepEqual(walkStep({ ...bounds, x: 500 }, 1, 20, PRIMARY), { x: 506.75, direction: 1 });
    assert.deepEqual(walkStep({ ...bounds, x: 500 }, 1, -1, PRIMARY), { x: 500, direction: 1 });
});

test('walking works across displays with negative coordinates', () => {
    const bounds = { ...petSize(), x: -1919, y: 300 };
    assert.deepEqual(walkStep(bounds, -1, 0.1, LEFT_MONITOR), { x: -1920, direction: 1 });
    const tiny = { x: -400, y: -200, width: 300, height: 266 };
    assert.deepEqual(walkStep({ ...tiny }, -1, 1, tiny), { x: -400, direction: 1 });
});
