export function photoPoint(bounds, width, height, clientX, clientY) {
    if (![bounds.left, bounds.top, bounds.width, bounds.height, width, height, clientX, clientY].every(Number.isFinite)
        || bounds.width <= 0 || bounds.height <= 0 || width <= 0 || height <= 0) return null;
    const scale = Math.min(bounds.width / width, bounds.height / height);
    const left = bounds.left + (bounds.width - width * scale) / 2;
    const top = bounds.top + (bounds.height - height * scale) / 2;
    const horizontal = (clientX - left) / scale;
    const vertical = (clientY - top) / scale;
    if (horizontal < 0 || vertical < 0 || horizontal >= width || vertical >= height) return null;
    return { x: Math.floor(horizontal), y: Math.floor(vertical) };
}

export function alphaHit(pixels, width, height, horizontal, vertical) {
    if (!pixels || !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0
        || !Number.isFinite(horizontal) || !Number.isFinite(vertical)) return false;
    if (horizontal < 0 || vertical < 0 || horizontal >= width || vertical >= height) return false;
    const offset = (Math.floor(vertical) * width + Math.floor(horizontal)) * 4 + 3;
    return offset < pixels.length && pixels[offset] >= 24;
}
