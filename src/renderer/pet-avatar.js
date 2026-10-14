import './puppy.js';
import './cat.js';

class PetAvatar extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' }).innerHTML = '<style>:host { display: block; width: 100%; height: 100%; } puppy-dog, silver-cat { width: 100%; height: 100%; }</style>';
        this.avatar = document.createElement('puppy-dog');
        this.avatar.setAttribute('aria-hidden', 'true');
        this.shadowRoot.append(this.avatar);
    }

    hitTest(clientX, clientY) {
        return this.avatar?.hitTest(clientX, clientY) ?? false;
    }

    update(snapshot) {
        const species = snapshot.pet.settings.species === 'cat' ? 'cat' : 'dog';
        const tagName = species === 'cat' ? 'silver-cat' : 'puppy-dog';
        if (this.avatar?.localName !== tagName) {
            this.avatar?.remove();
            this.avatar = document.createElement(tagName);
            this.avatar.setAttribute('aria-hidden', 'true');
            this.shadowRoot.append(this.avatar);
        }
        this.avatar.update(snapshot);
        this.setAttribute('species', species);
        for (const attribute of ['coat', 'accessory', 'behavior', 'direction', 'carrying']) {
            this.setAttribute(attribute, this.avatar.getAttribute(attribute) || '');
        }
        this.toggleAttribute('reduced-motion', snapshot.pet.settings.reducedMotion);
    }
}

customElements.define('pet-avatar', PetAvatar);
