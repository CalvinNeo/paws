const shapes = {
    paw: '<ellipse cx="5.5" cy="8.8" rx="2" ry="2.6" transform="rotate(-25 5.5 8.8)"/><ellipse cx="10" cy="5.5" rx="2" ry="2.6"/><ellipse cx="15.5" cy="6" rx="2" ry="2.6" transform="rotate(12 15.5 6)"/><ellipse cx="19" cy="10" rx="2" ry="2.6" transform="rotate(30 19 10)"/><path d="M6.8 15.2c2.5-3.7 3-4.7 5.4-4.7 2.3 0 3 1.6 5.3 4.7 3.5 4.8-1.5 6.4-5.2 4.2-4.2 2.2-8.9.7-5.5-4.2Z"/>',
    home: '<path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-7h6v7"/>',
    wardrobe: '<path d="m8 4-5 4 3 5 2-1v9h8v-9l2 1 3-5-5-4c0 4-8 4-8 0Z"/>',
    settings: '<path d="m9 3-.8 3-2.8.7L3 9l2 3-2 3 2.4 2.3 2.8.7.8 3h6l.8-3 2.8-.7L21 15l-2-3 2-3-2.4-2.3-2.8-.7L15 3Z"/><circle cx="12" cy="12" r="3"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-1 .5-1 1.2-1 2.2M12 17h.01"/>',
    explain: '<path d="m4 3 5 17 4-7 7-4Z"/><path d="m15 15 5 5"/>',
    arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    minus: '<path d="M5 12h14"/>',
    heart: '<path d="M12 20S2 14 2 7.8C2 2 9 1 12 6c3-5 10-4 10 1.8C22 14 12 20 12 20Z"/>',
    edit: '<path d="m15 4 5 5M4 20l1-5L17 3l4 4L9 19Z"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    pin: '<path d="m8 3 8 0-1 6 4 4H5l4-4-1-6ZM12 13v8"/>',
    leaf: '<path d="M20 3C9 2 1 9 6 16c7 5 14-2 14-13Z"/><path d="m4 21 11-11"/>',
    monitor: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
    moon: '<path d="M20 14A9 9 0 0 1 10 3a9 9 0 1 0 10 11Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
    location: '<path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',
    spark: '<path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5Z"/>',
};

export function icon(name) {
    const filled = name === 'paw';
    return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="${filled ? 'currentColor' : 'none'}" stroke="${filled ? 'none' : 'currentColor'}" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${shapes[name] ?? shapes.paw}</svg>`;
}

export function renderIcons(root = document) {
    root.querySelectorAll('[data-icon]').forEach((element) => { element.innerHTML = icon(element.dataset.icon); });
}
