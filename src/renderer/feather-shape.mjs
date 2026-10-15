export const featherShapes = [
    { tag: 'line', attributes: { x1: 75, y1: 25, x2: 90, y2: 10, stroke: '#78886a', 'stroke-width': 6, 'stroke-linecap': 'round' } },
    { tag: 'polyline', attributes: { points: '75,25 73,35 62,38 56,43', fill: 'none', stroke: '#b9ac91', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } },
    { tag: 'ellipse', attributes: { cx: 39, cy: 54, rx: 10, ry: 22, transform: 'rotate(35 39 54)', fill: '#a2b98a' }, angle: 35 },
    { tag: 'ellipse', attributes: { cx: 62, cy: 54, rx: 7, ry: 19, transform: 'rotate(-38 62 54)', fill: '#bc9dae' }, angle: -38 },
    { tag: 'ellipse', attributes: { cx: 53, cy: 55, rx: 9, ry: 24, transform: 'rotate(-12 53 55)', fill: '#d6bac6' }, angle: -12 },
];

function segmentDistance(point, start, end) {
    const horizontal = end.x - start.x;
    const vertical = end.y - start.y;
    const length = horizontal * horizontal + vertical * vertical;
    const along = length ? Math.max(0, Math.min(1, ((point.x - start.x) * horizontal + (point.y - start.y) * vertical) / length)) : 0;
    return Math.hypot(point.x - start.x - along * horizontal, point.y - start.y - along * vertical);
}

export function featherHit(point) {
    return featherShapes.some(({ tag, attributes, angle }) => {
        if (tag === 'ellipse') {
            const radians = angle * Math.PI / 180;
            const horizontal = point.x - attributes.cx;
            const vertical = point.y - attributes.cy;
            const localX = horizontal * Math.cos(radians) + vertical * Math.sin(radians);
            const localY = -horizontal * Math.sin(radians) + vertical * Math.cos(radians);
            return (localX / attributes.rx) ** 2 + (localY / attributes.ry) ** 2 <= 1;
        }
        const points = tag === 'line'
            ? [{ x: attributes.x1, y: attributes.y1 }, { x: attributes.x2, y: attributes.y2 }]
            : attributes.points.split(' ').map((pair) => { const [horizontal, vertical] = pair.split(',').map(Number); return { x: horizontal, y: vertical }; });
        return points.slice(1).some((end, index) => segmentDistance(point, points[index], end) <= attributes['stroke-width'] / 2);
    });
}
