const PET_SCALES = Object.freeze({ small: 0.8, medium: 1, large: 1.2 });

function petSize(size = 'medium') {
    const scale = PET_SCALES[size] ?? PET_SCALES.medium;
    return { width: Math.round(300 * scale), height: Math.round(266 * scale) };
}

function clampBounds(bounds, workArea) {
    const width = Math.min(Math.max(1, Math.round(bounds.width)), workArea.width);
    const height = Math.min(Math.max(1, Math.round(bounds.height)), workArea.height);
    return {
        x: Math.round(Math.min(Math.max(bounds.x, workArea.x), workArea.x + workArea.width - width)),
        y: Math.round(Math.min(Math.max(bounds.y, workArea.y), workArea.y + workArea.height - height)),
        width,
        height,
    };
}

function homeBounds(size, workArea) {
    const dimensions = petSize(size);
    return clampBounds({
        ...dimensions,
        x: workArea.x + workArea.width - dimensions.width - 36,
        y: workArea.y + workArea.height - dimensions.height - 8,
    }, workArea);
}

function walkStep(bounds, direction, elapsedSeconds, workArea, speed = 27) {
    const maximum = workArea.x + workArea.width - bounds.width;
    if (maximum <= workArea.x) return { x: workArea.x, direction: 1 };
    const distance = speed * Math.max(0, Math.min(elapsedSeconds, 0.25));
    const proposed = bounds.x + direction * distance;
    return {
        x: Math.max(workArea.x, Math.min(maximum, proposed)),
        direction: proposed <= workArea.x ? 1 : proposed >= maximum ? -1 : direction,
    };
}

module.exports = { PET_SCALES, petSize, clampBounds, homeBounds, walkStep };
