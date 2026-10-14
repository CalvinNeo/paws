const bridge = window.pawpal;
const toy = document.getElementById('toy');
let currentState;
let pointerId = null;
let inside = false;

function hitTest(horizontal, vertical) {
    return Boolean(document.elementFromPoint(horizontal, vertical)?.closest('[data-hit]'));
}

function pointer(value) {
    if (value === inside) return;
    inside = value;
    bridge.toyPointer(value);
}

function renderState(state) {
    if (!state) return;
    currentState = state;
    document.body.classList.toggle('busy', !state.interactive);
    document.body.classList.toggle('held', state.phase === 'held');
    document.body.dataset.phase = state.phase;
    document.body.dataset.completed = String(state.completed);
    document.body.dataset.mode = state.mode;
    for (const shape of document.querySelectorAll('[data-kind]')) shape.toggleAttribute('hidden', shape.dataset.kind !== state.toy);
    toy.setAttribute('aria-label', `${state.label}. ${state.instruction} Right-click to put toys away.`);
}

function release(phase) {
    if (pointerId === null) return;
    const previous = pointerId;
    pointerId = null;
    if (toy.hasPointerCapture(previous)) toy.releasePointerCapture(previous);
    bridge.toyDrag(phase);
    pointer(false);
}

document.addEventListener('mousemove', (event) => {
    if (pointerId === null) pointer(Boolean(currentState?.interactive) && hitTest(event.clientX, event.clientY));
});
document.addEventListener('mouseleave', () => { if (pointerId === null) pointer(false); });
document.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || pointerId !== null || !currentState?.interactive || !hitTest(event.clientX, event.clientY)) return;
    event.preventDefault();
    pointerId = event.pointerId;
    toy.setPointerCapture(pointerId);
    pointer(true);
    bridge.toyDrag('start', { x: event.clientX, y: event.clientY });
});
document.addEventListener('pointerup', (event) => { if (event.pointerId === pointerId) release('end'); });
document.addEventListener('pointercancel', (event) => { if (event.pointerId === pointerId) release('cancel'); });
toy.addEventListener('lostpointercapture', () => release('cancel'));
document.addEventListener('contextmenu', (event) => {
    if (!hitTest(event.clientX, event.clientY)) return;
    event.preventDefault();
    release('cancel');
    bridge.toyMenu();
});
window.addEventListener('pagehide', () => release('cancel'));
bridge.onToyState(renderState);
const response = await bridge.toyState();
if (response.ok) renderState(response.data);
