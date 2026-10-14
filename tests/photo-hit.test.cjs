const { test } = require('node:test');
const assert = require('node:assert/strict');
const { photoPoint, alphaHit } = require('../src/renderer/photo-hit.mjs');

test('photo hit coordinates account for scaling and letterboxing', () => {
    const portraitBounds = { left: 5, top: 10, width: 90, height: 100 };
    assert.deepEqual(photoPoint(portraitBounds, 640, 560, 50, 60), { x: 320, y: 280 });
    assert.equal(photoPoint(portraitBounds, 640, 560, 50, 10), null);
    assert.equal(photoPoint(portraitBounds, 640, 560, 50, 109), null);
    const landscapeBounds = { left: -100, top: 20, width: 200, height: 100 };
    assert.deepEqual(photoPoint(landscapeBounds, 640, 560, 0, 70), { x: 320, y: 280 });
    assert.equal(photoPoint(landscapeBounds, 640, 560, -99, 70), null);
    assert.equal(photoPoint(landscapeBounds, 640, 560, 99, 70), null);
    assert.equal(photoPoint(landscapeBounds, 640, 560, 0, 120), null);
    assert.equal(photoPoint(landscapeBounds, 640, 560, NaN, 70), null);
    assert.equal(photoPoint({ ...portraitBounds, width: 0 }, 640, 560, 50, 60), null);
});

test('only visible photo pixels intercept clicks, not transparent padding or faint fur halos', () => {
    const pixels = new Uint8ClampedArray(4 * 3 * 4);
    pixels[(1 * 4 + 2) * 4 + 3] = 255;
    pixels[(2 * 4 + 1) * 4 + 3] = 24;
    pixels[(1 * 4 + 3) * 4 + 3] = 23;
    assert.equal(alphaHit(pixels, 4, 3, 2, 1), true);
    assert.equal(alphaHit(pixels, 4, 3, 2.9, 1.1), true);
    assert.equal(alphaHit(pixels, 4, 3, 1, 2), true);
    assert.equal(alphaHit(pixels, 4, 3, 3, 1), false);
    assert.equal(alphaHit(pixels, 4, 3, 0, 0), false);
    assert.equal(alphaHit(pixels, 4, 3, -1, 1), false);
    assert.equal(alphaHit(pixels, 4, 3, 4, 1), false);
    assert.equal(alphaHit(pixels, 4, 3, 2, 3), false);
    assert.equal(alphaHit(pixels, 4, 3, Infinity, 1), false);
    assert.equal(alphaHit(pixels, 4, 3, 2, NaN), false);
    assert.equal(alphaHit(null, 4, 3, 2, 1), false);
    assert.equal(alphaHit(new Uint8ClampedArray(1), 4, 3, 2, 1), false);
});

test('alpha masks support tiny and large desktop sizes without widening the input region', () => {
    const width = 640;
    const height = 560;
    const pixels = new Uint8ClampedArray(width * height * 4);
    pixels[(280 * width + 320) * 4 + 3] = 255;
    for (const size of [20, 30, 43, 100, 150]) {
        const scale = size / 100;
        const bounds = { left: 11, top: 17, width: width * scale, height: height * scale };
        const point = photoPoint(bounds, width, height, 11 + 320.5 * scale, 17 + 280.5 * scale);
        assert.equal(alphaHit(pixels, width, height, point.x, point.y), true);
        const blank = photoPoint(bounds, width, height, 11 + 319.5 * scale, 17 + 280.5 * scale);
        assert.equal(alphaHit(pixels, width, height, blank.x, blank.y), false);
    }
});
