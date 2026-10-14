import './pet-avatar.js';

const bridge = window.pawpal;
const puppy = document.getElementById('desktop-puppy');
const stage = document.getElementById('pet-stage');
const speech = document.getElementById('speech');
let interactive = false;
let pointerId = null;
let speechTimer;

function setInteractive(value) {
    if (value === interactive) return;
    interactive = value;
    stage.classList.toggle('hovering', value);
    bridge.pointer(value);
}

function renderState(snapshot) {
    if (puppy.getAttribute('species') !== snapshot.pet.settings.species) {
        finishDrag('cancel');
        setInteractive(false);
    }
    puppy.update(snapshot);
    document.body.classList.toggle('reduced-motion', snapshot.pet.settings.reducedMotion);
    document.getElementById('desktop-name').textContent = snapshot.pet.name;
    puppy.setAttribute('aria-label', `${snapshot.pet.name}. Click for head scratches, drag to move, right-click for a menu.`);
    if (snapshot.message) {
        clearTimeout(speechTimer);
        speech.textContent = snapshot.message;
        speech.hidden = false;
        speechTimer = setTimeout(() => { speech.hidden = true; }, 3700);
    }
}

function finishDrag(phase = 'end') {
    if (pointerId === null) return;
    const previous = pointerId;
    pointerId = null;
    stage.classList.remove('dragging');
    if (puppy.hasPointerCapture(previous)) puppy.releasePointerCapture(previous);
    bridge.drag(phase);
}

document.addEventListener('mousemove', (event) => {
    if (pointerId === null) setInteractive(puppy.hitTest(event.clientX, event.clientY));
});
document.addEventListener('mouseleave', () => {
    if (pointerId === null) setInteractive(false);
});
document.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !puppy.hitTest(event.clientX, event.clientY)) return;
    event.preventDefault();
    pointerId = event.pointerId;
    puppy.setPointerCapture(pointerId);
    stage.classList.add('dragging');
    setInteractive(true);
    bridge.drag('start');
});
document.addEventListener('pointerup', () => finishDrag());
document.addEventListener('pointercancel', () => finishDrag('cancel'));
puppy.addEventListener('lostpointercapture', () => finishDrag('cancel'));
window.addEventListener('blur', () => { finishDrag('cancel'); setInteractive(false); });
document.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    finishDrag('cancel');
    bridge.menu();
});
document.addEventListener('dblclick', () => bridge.window('home'));
puppy.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        bridge.action('pet');
    }
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        event.preventDefault();
        bridge.menu();
    }
    if (event.key === 'Escape') finishDrag('cancel');
});

bridge.onState(renderState);
const response = await bridge.getState();
if (response.ok) renderState(response.data);
