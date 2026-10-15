export const STAND_DURATION_MS = 4200;

function ease(value) {
    const progress = Math.min(1, Math.max(0, value));
    return progress * progress * (3 - 2 * progress);
}

export function sampleStandingMotion(elapsedMs, reducedMotion = false) {
    const elapsed = Math.min(STAND_DURATION_MS, Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0));
    if (reducedMotion) return { compression: 0, sway: 0, phase: 'hold', done: true };
    const rise = ease((elapsed - 180) / 850);
    const settle = ease((elapsed - 3200) / 800);
    const anticipation = .01 * Math.sin(Math.PI * Math.min(elapsed / 180, 1));
    const balance = ease((elapsed - 1050) / 350) * (1 - ease((elapsed - 2800) / 400));
    return {
        compression: .13 * (1 - rise) + anticipation + .08 * settle,
        sway: .004 * Math.sin((elapsed - 1050) / 1500 * Math.PI * 2) * balance,
        phase: elapsed < 180 ? 'ready' : elapsed < 1030 ? 'rise' : elapsed < 3200 ? 'hold' : 'settle',
        done: elapsed >= STAND_DURATION_MS,
    };
}

export function standingPoint(vertical, width, height, motion) {
    const support = 1 - ease((vertical / height - .36) / (.925 - .36));
    return { x: motion.sway * width * support, y: vertical + motion.compression * height * support };
}

export function drawStandingPhoto(context, image, width, height, motion) {
    const rows = [0, height * .36];
    for (let index = 1; index <= 32; index += 1) rows.push(height * (.36 + (.925 - .36) * index / 32));
    rows.push(height);
    for (let index = 0; index < rows.length - 1; index += 1) {
        const sourceTop = rows[index];
        const sourceBottom = rows[index + 1];
        const top = standingPoint(sourceTop, width, height, motion);
        const bottom = standingPoint(sourceBottom, width, height, motion);
        const destinationTop = Math.round(top.y);
        const destinationHeight = Math.round(bottom.y) - destinationTop;
        context.drawImage(image, 0, sourceTop, width, sourceBottom - sourceTop,
            (top.x + bottom.x) / 2, destinationTop, width, destinationHeight);
    }
}
