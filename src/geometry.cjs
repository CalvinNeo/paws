const DEFAULT_PET_SIZE = 30;
const MIN_PET_SIZE = 20;
const MAX_PET_SIZE = 150;
const PET_SIZE_PRESETS = Object.freeze([20, 30, 50, 75, 100, 120, 150]);

function validPetSize(size) {
    return Number.isInteger(size) && size >= MIN_PET_SIZE && size <= MAX_PET_SIZE;
}

function petSize(size = DEFAULT_PET_SIZE) {
    const scale = (validPetSize(size) ? size : DEFAULT_PET_SIZE) / 100;
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

module.exports = {
    DEFAULT_PET_SIZE, MIN_PET_SIZE, MAX_PET_SIZE, PET_SIZE_PRESETS,
    validPetSize, petSize, clampBounds, homeBounds, walkStep,
};
