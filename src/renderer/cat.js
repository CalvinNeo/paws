import profile from '../../assets/cat/poses.mjs';
import { photoPoint, alphaHit } from './photo-hit.mjs';

const photos = new Map();

function loadPhoto(pose) {
    if (!photos.has(pose)) {
        photos.set(pose, new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error(`The ${pose} photo is unavailable.`));
            image.src = new URL(`../../assets/cat/${profile.poses[pose].file}`, import.meta.url).href;
        }));
    }
    return photos.get(pose);
}

class SilverCat extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' }).innerHTML = `
            <style>
                :host { display: block; width: 100%; height: 100%; }
                canvas { display: block; width: 100%; height: 100%; object-fit: contain; pointer-events: auto; }
                .unavailable { display: none; color: #65705d; font: 12px system-ui, sans-serif; text-align: center; }
                :host([asset-error]) canvas { display: none; }
                :host([asset-error]) .unavailable { display: block; }
            </style>
            <canvas width="${profile.width}" height="${profile.height}" aria-hidden="true"></canvas>
            <span class="unavailable">Cat photos unavailable.<br>Switch to Puppy in the pet menu.</span>`;
        this.canvas = this.shadowRoot.querySelector('canvas');
        this.context = this.canvas.getContext('2d', { willReadFrequently: true });
        this.mask = null;
        this.signature = '';
        this.frameVersion = 0;
        this.ready = Promise.resolve();
    }

    notifyShapeChanged() {
        this.dispatchEvent(new CustomEvent('pet-shape-changed', { bubbles: true, composed: true }));
    }

    hitTest(clientX, clientY) {
        if (!this.isConnected || this.hasAttribute('asset-error')) return false;
        const point = photoPoint(this.canvas.getBoundingClientRect(), profile.width, profile.height, clientX, clientY);
        return point !== null && alphaHit(this.mask, profile.width, profile.height, point.x, point.y);
    }

    drawPhoto(image, pose, mirrored) {
        const context = this.context;
        context.clearRect(0, 0, profile.width, profile.height);
        context.save();
        if (mirrored) {
            context.translate(profile.width, 0);
            context.scale(-1, 1);
        }
        context.drawImage(image, 0, 0, profile.width, profile.height);
        this.mask = context.getImageData(0, 0, profile.width, profile.height).data;
        const [shadowX, shadowY, shadowWidth, shadowHeight] = profile.poses[pose].shadow;
        context.globalCompositeOperation = 'destination-over';
        context.translate(shadowX, shadowY);
        context.scale(shadowWidth, shadowHeight);
        const shadow = context.createRadialGradient(0, 0, .05, 0, 0, 1);
        shadow.addColorStop(0, '#29382c26');
        shadow.addColorStop(1, '#29382c00');
        context.fillStyle = shadow;
        context.fillRect(-1, -1, 2, 2);
        context.restore();
    }

    update(snapshot) {
        const settings = snapshot.pet.settings;
        const behavior = snapshot.runtime.behavior;
        const playing = Boolean(snapshot.game);
        const pose = behavior === 'sleeping' ? 'sleeping' : playing || behavior === 'walking' || behavior === 'eating'
            ? profile.playPose : settings.catPose || 'sitting';
        const mirrored = (playing || behavior === 'walking') && snapshot.runtime.direction < 0;
        this.setAttribute('coat', 'silver-tabby');
        this.setAttribute('accessory', 'none');
        this.setAttribute('behavior', behavior);
        this.setAttribute('direction', mirrored ? 'left' : 'right');
        this.setAttribute('carrying', '');
        this.toggleAttribute('reduced-motion', settings.reducedMotion);
        const signature = `${pose}:${mirrored}`;
        if (signature === this.signature) return;
        this.signature = signature;
        this.dataset.pose = pose;
        this.removeAttribute('ready');
        this.removeAttribute('asset-error');
        this.mask = null;
        this.context.clearRect(0, 0, profile.width, profile.height);
        this.notifyShapeChanged();
        const frameVersion = ++this.frameVersion;
        this.ready = loadPhoto(pose).then((image) => {
            if (frameVersion !== this.frameVersion) return;
            this.drawPhoto(image, pose, mirrored);
            this.setAttribute('ready', '');
            this.notifyShapeChanged();
        }).catch(() => {
            if (frameVersion !== this.frameVersion) return;
            this.mask = null;
            this.setAttribute('asset-error', '');
            this.notifyShapeChanged();
        });
    }
}

customElements.define('silver-cat', SilverCat);
