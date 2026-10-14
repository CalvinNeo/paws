let catSequence = 0;

class SilverCat extends HTMLElement {
    constructor() {
        super();
        catSequence += 1;
        const identifier = `silver-cat-${catSequence}`;
        this.attachShadow({ mode: 'open' }).innerHTML = `
            <style>
                :host { display: block; width: 100%; height: 100%; }
                svg { display: block; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
                [data-hit] path, [data-hit] ellipse, [data-hit] circle, [data-hit] use { pointer-events: visiblePainted; }
                .outline { stroke: #85918b; stroke-width: 1.5; stroke-linejoin: round; }
                .stripes { fill: #78847e; opacity: .7; }
                .cat { transform-origin: 160px 247px; animation: breathe 4.2s ease-in-out infinite; }
                .head { transform-origin: 160px 148px; animation: look-around 11s ease-in-out infinite; }
                .tail { transform-origin: 213px 225px; animation: tail-sway 3.5s ease-in-out infinite; }
                .right-ear { transform-origin: 210px 81px; animation: ear-twitch 12s ease-in-out infinite; }
                .awake-eyes { transform-origin: 160px 122px; animation: slow-blink 7.4s ease-in-out infinite; }
                .curled-body, .wrapped-tail, .closed-eyes, .sleep-marks, .hearts, .crumbs, .bandana, .collar, .carried-bone { display: none; }
                :host([accessory="bandana"]) .bandana, :host([accessory="collar"]) .collar { display: block; }
                :host([direction="left"]) .facing { transform: translateX(320px) scaleX(-1); }
                :host([carrying="bone"]) .carried-bone { display: block; }
                :host([behavior="walking"]) .cat { animation: trot .6s ease-in-out infinite; }
                :host([behavior="walking"]) .head { animation: none; }
                :host([behavior="walking"]) .front-left, :host([behavior="walking"]) .back-right { animation: step .6s ease-in-out infinite; }
                :host([behavior="walking"]) .front-right, :host([behavior="walking"]) .back-left { animation: step .6s ease-in-out -.3s infinite; }
                :host([behavior="petting"]) .front-left { animation: knead 1.1s ease-in-out infinite; }
                :host([behavior="petting"]) .front-right { animation: knead 1.1s ease-in-out -.55s infinite; }
                :host([behavior="petting"]) .head { animation: nuzzle 2.4s ease-in-out infinite; }
                :host([behavior="petting"]) .awake-eyes, :host([behavior="sleeping"]) .awake-eyes { display: none; }
                :host([behavior="petting"]) .closed-eyes, :host([behavior="petting"]) .hearts { display: block; }
                .heart-one { animation: float-heart 2s ease-out infinite; }
                .heart-two { animation: float-heart 2s ease-out -1s infinite; }
                :host([behavior="playing"]) .cat { animation: pounce .85s ease-in-out infinite; }
                :host([behavior="playing"]) .tail { animation-duration: .9s; }
                :host([behavior="eating"]) .head { animation: munch .7s ease-in-out infinite; }
                :host([behavior="eating"]) .crumbs { display: block; animation: crumbs .8s ease-out infinite; }
                :host([behavior="sleeping"]) .awake-body { display: none; }
                :host([behavior="sleeping"]) .curled-body, :host([behavior="sleeping"]) .wrapped-tail,
                :host([behavior="sleeping"]) .closed-eyes, :host([behavior="sleeping"]) .sleep-marks { display: block; }
                :host([behavior="sleeping"]) .head { animation: none; transform: translate(-34px, 65px) rotate(-14deg) scale(.8); }
                :host([behavior="sleeping"]) .right-ear { animation: none; }
                :host([behavior="sleeping"]) .cat { animation: sleep-breathe 4.8s ease-in-out infinite; }
                .sleep-marks { font: 500 20px Georgia, serif; fill: #809481; animation: dream 3.4s ease-in-out infinite; }
                @keyframes breathe { 0%, 100% { transform: scaleY(1); } 50% { transform: scaleY(1.012); } }
                @keyframes look-around { 0%, 30%, 65%, 100% { transform: rotate(0); } 42%, 55% { transform: rotate(-3deg); } }
                @keyframes tail-sway { 0%, 100% { transform: rotate(-4deg); } 50% { transform: rotate(5deg); } }
                @keyframes ear-twitch { 0%, 78%, 86%, 100% { transform: rotate(0); } 81%, 84% { transform: rotate(9deg); } }
                @keyframes slow-blink { 0%, 38%, 49%, 100% { transform: scaleY(1); } 42%, 45% { transform: scaleY(.06); } }
                @keyframes trot { 0%, 100% { transform: translateY(0) rotate(-.7deg); } 50% { transform: translateY(-3px) rotate(.7deg); } }
                @keyframes step { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
                @keyframes knead { 0%, 100% { transform: translateY(1px); } 50% { transform: translateY(-9px); } }
                @keyframes nuzzle { 0%, 100% { transform: rotate(-4deg) translateY(2px); } 50% { transform: rotate(4deg) translateY(4px); } }
                @keyframes pounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-7px) rotate(-2deg); } }
                @keyframes munch { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(4px) rotate(2deg); } }
                @keyframes sleep-breathe { 0%, 100% { transform: scaleY(1); } 50% { transform: scaleY(1.028); } }
                @keyframes float-heart { 0% { transform: translateY(5px); opacity: 0; } 30% { opacity: .85; } 100% { transform: translateY(-19px); opacity: 0; } }
                @keyframes crumbs { 0% { transform: translateY(0); opacity: .8; } 100% { transform: translateY(9px); opacity: 0; } }
                @keyframes dream { 0%, 100% { transform: translateY(0); opacity: .45; } 50% { transform: translateY(-6px); opacity: .85; } }
                :host([reduced-motion]) * { animation: none !important; }
                @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
            </style>
            <svg viewBox="0 0 320 280" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <defs>
                    <radialGradient id="${identifier}-fur" cx="40%" cy="25%" r="80%"><stop stop-color="#edf0e9"/><stop offset=".55" stop-color="#d4dbd4"/><stop offset="1" stop-color="#abb6af"/></radialGradient>
                    <radialGradient id="${identifier}-face" cx="50%" cy="70%" r="73%"><stop stop-color="#f3f3e9"/><stop offset=".62" stop-color="#dce1d9"/><stop offset="1" stop-color="#b2bdb4"/></radialGradient>
                    <linearGradient id="${identifier}-back" x2=".3" y2="1"><stop stop-color="#a0ada5"/><stop offset="1" stop-color="#d7ded5"/></linearGradient>
                    <radialGradient id="${identifier}-eye" cx="45%" cy="68%" r="65%"><stop stop-color="#d8df9e"/><stop offset=".7" stop-color="#aabd7b"/><stop offset="1" stop-color="#7a935d"/></radialGradient>
                    <path id="${identifier}-tail" d="M207 214c28 9 51 1 50-22-1-13-13-19-9-30 4-13 19-12 27 1 27 44-2 88-47 86l-24-8z"/>
                    <clipPath id="${identifier}-tail-clip"><use href="#${identifier}-tail"/></clipPath>
                    <path id="${identifier}-wrap" d="M243 192c3 25-11 40-42 43-24 3-41-3-54-1-13 2-13 18 0 22 36 8 77 5 101-12 19-14 23-38 14-53-6-10-20-9-19 1z"/>
                    <clipPath id="${identifier}-wrap-clip"><use href="#${identifier}-wrap"/></clipPath>
                </defs>
                <ellipse cx="164" cy="253" rx="100" ry="10" fill="#667661" opacity=".12"/>
                <g class="facing"><g class="cat">
                    <g class="awake-body">
                        <g class="tail" data-hit>
                            <use href="#${identifier}-tail" fill="url(#${identifier}-fur)" class="outline"/>
                            <g clip-path="url(#${identifier}-tail-clip)" class="stripes">
                                <path d="m205 216 12-7 7 45-12 3zm28 1 11-5 11 36-12 7zm22-14 10-10 24 22-8 13zm-1-24 4-12 29 11 3 14zM243 158l22-13 12 15-24 12z"/>
                            </g>
                        </g>
                        <path data-hit class="outline" d="M113 139c-18 12-29 49-27 75 1 29 31 34 72 34 43 0 73-9 72-37-1-30-15-60-31-72z" fill="url(#${identifier}-back)"/>
                        <g data-hit>
                            <ellipse cx="158" cy="195" rx="50" ry="47" fill="#edf0e5"/>
                            <path class="stripes" d="M96 169q11 1 22 12-17-2-26-5zm-7 23q12-3 22 9-17-2-23-2zm119-27q-11 7-13 14 14-4 22-8zm11 22q-15 3-19 11 17-4 23-4z"/>
                            <g class="back-left"><ellipse class="outline" cx="104" cy="236" rx="24" ry="13" fill="url(#${identifier}-fur)"/></g>
                            <g class="back-right"><ellipse class="outline" cx="215" cy="236" rx="24" ry="13" fill="url(#${identifier}-fur)"/></g>
                            <g class="front-left">
                                <path class="outline" d="M122 182c-5 14-7 31-7 48-3 7-7 13-2 16 8 5 32 4 35-2l-1-56" fill="url(#${identifier}-fur)"/>
                                <path class="stripes" d="M118 207q14 8 29 1v7q-17 5-30-2zm-2 16q17 7 31 0v6q-13 7-31-1z"/>
                                <path d="M120 240v6m10-6v7" fill="none" stroke="#9ca89a" stroke-linecap="round"/>
                            </g>
                            <g class="front-right">
                                <path class="outline" d="M174 188l-1 56c3 6 27 7 35 2 5-3 1-9-2-16 0-17-2-34-7-48" fill="url(#${identifier}-fur)"/>
                                <path class="stripes" d="M174 208q16 7 29-1l1 6q-14 7-30 2zm0 15q17 7 31 0v5q-18 8-31 1z"/>
                                <path d="M188 240v7m10-7v6" fill="none" stroke="#9ca89a" stroke-linecap="round"/>
                            </g>
                            <g class="bandana"><path d="M117 170q43 15 86 0l-15 31-28 18-14-18-17 2z" fill="#bd7b61" stroke="#a96b54" stroke-width="1.2"/><path d="m156 188 12 4-6 10z" fill="#f4d7af"/></g>
                            <g class="collar"><path d="M120 176q40 22 79 0" fill="none" stroke="#668376" stroke-width="9" stroke-linecap="round"/><circle cx="160" cy="191" r="7" fill="#e4c476" stroke="#b69958"/></g>
                        </g>
                    </g>
                    <g class="curled-body" data-hit>
                        <path class="outline" d="M76 211c-4-30 16-66 54-73 34-11 89-6 115 20 17 17 22 49 8 71-15 25-51 27-91 25-44-1-83-12-86-43z" fill="url(#${identifier}-back)"/>
                        <ellipse cx="181" cy="208" rx="52" ry="34" fill="#eef0e5"/>
                        <path class="stripes" d="M156 136q-15 22-5 43-2-30 18-43zm31 0q-12 20-4 38 3-24 17-35zm27 8q-8 15-5 29 8-20 17-23zm20 14q-3 13-1 21l13-12z"/>
                        <ellipse cx="190" cy="232" rx="23" ry="12" fill="#f4f3e8"/>
                    </g>
                    <g class="head">
                        <g data-hit>
                            <path class="outline" d="M92 91C81 74 81 47 89 42c8-3 28 10 40 28z" fill="url(#${identifier}-fur)"/>
                            <path d="M92 78c-5-10-6-19-2-25 10 3 20 10 23 17z" fill="#c7ada6"/>
                            <path d="M94 77 89 66l11 5-3-10 14 12" fill="none" stroke="#ecece0" stroke-width="2" stroke-linecap="round"/>
                        </g>
                        <g class="right-ear" data-hit>
                            <path class="outline" d="M193 69c12-18 30-29 37-25 8 6 5 34-6 49z" fill="url(#${identifier}-fur)"/>
                            <path d="m208 71 19-17c4 8 1 18-3 26z" fill="#c7ada6"/>
                            <path d="m215 72 10-11-2 11 9-5-8 15" fill="none" stroke="#ecece0" stroke-width="2" stroke-linecap="round"/>
                        </g>
                        <g data-hit>
                            <path class="outline" d="M81 115c-1-31 24-56 78-57 49-1 78 23 80 55l4 12-5 5 3 9-7 4c-9 27-39 46-74 46-38 0-69-16-77-42l-8-6 5-8-5-7z" fill="url(#${identifier}-face)"/>
                            <path class="stripes" d="M125 65q9 2 14 7l7 26-14-18zm22-6 12 22 12-21 8 2-13 38-8-10-9 10-10-39zm36 5 10 4-16 27 2-18zM81 110q22 3 29 14-20-7-31-6zm-1 22q16 0 26 8-17-2-23 3zm159-23q-22 5-29 15 20-7 30-7zm1 23q-16 0-26 8 17-2 23 3z"/>
                            <path d="M101 103q15-10 31-5m54 0q16-5 30 4" fill="none" stroke="#f7f5e9" stroke-width="5" stroke-linecap="round" opacity=".9"/>
                            <g class="awake-eyes">
                                <ellipse cx="121" cy="122" rx="18" ry="19" fill="#f5f3d8"/>
                                <ellipse cx="199" cy="122" rx="18" ry="19" fill="#f5f3d8"/>
                                <ellipse cx="121" cy="122" rx="15.5" ry="17" fill="url(#${identifier}-eye)" stroke="#4b5849" stroke-width="2.5"/>
                                <ellipse cx="199" cy="122" rx="15.5" ry="17" fill="url(#${identifier}-eye)" stroke="#4b5849" stroke-width="2.5"/>
                                <ellipse cx="122" cy="121" rx="7" ry="14" fill="#303b34"/><ellipse cx="198" cy="121" rx="7" ry="14" fill="#303b34"/>
                                <circle cx="116" cy="115" r="4" fill="#fffef2"/><circle cx="193" cy="115" r="4" fill="#fffef2"/>
                                <circle cx="127" cy="128" r="1.8" fill="#fffef2" opacity=".75"/><circle cx="204" cy="128" r="1.8" fill="#fffef2" opacity=".75"/>
                                <path d="m103 119-4-3m118 3 4-3" stroke="#4b5849" stroke-width="2.2" stroke-linecap="round"/>
                            </g>
                            <g class="closed-eyes" fill="none" stroke="#536254" stroke-width="3.5" stroke-linecap="round"><path d="M105 122q16 12 32 0m46 0q16 12 32 0"/></g>
                            <path d="M143 124q17 8 34 0l-8 31h-18z" fill="#c6cfc2" opacity=".6"/>
                            <ellipse cx="146" cy="160" rx="22" ry="16" fill="#f6f5e9"/><ellipse cx="174" cy="160" rx="22" ry="16" fill="#f6f5e9"/>
                            <ellipse cx="160" cy="176" rx="17" ry="9" fill="#f6f5e9"/>
                            <path d="M150 150q10-5 20 0-2 8-10 10-8-2-10-10z" fill="#ab7f79" stroke="#65584f" stroke-width="2" stroke-linejoin="round"/>
                            <path d="M160 160v6m-11 1q6 7 11-1 5 8 11 1" fill="none" stroke="#6a7161" stroke-width="1.9" stroke-linecap="round"/>
                            <g fill="#a5af9d"><circle cx="136" cy="155" r="1.2"/><circle cx="139" cy="162" r="1"/><circle cx="132" cy="162" r="1"/><circle cx="184" cy="155" r="1.2"/><circle cx="181" cy="162" r="1"/><circle cx="188" cy="162" r="1"/></g>
                            <g class="carried-bone" fill="#fff0c9" stroke="#c5a675" stroke-width="1.1"><path d="M135 164c-8-10-16-1-9 5-7 7 1 15 9 5h50c8 10 16 2 9-5 7-6-1-15-9-5z"/></g>
                        </g>
                        <g fill="none" stroke="#8f9b89" stroke-width="1.3" stroke-linecap="round" opacity=".8"><path d="m126 153-33-7m32 14-35 2m36 3-29 11m97-23 33-7m-32 14 35 2m-36 3 29 11"/></g>
                    </g>
                    <g class="wrapped-tail" data-hit>
                        <use href="#${identifier}-wrap" fill="url(#${identifier}-fur)" class="outline"/>
                        <g clip-path="url(#${identifier}-wrap-clip)" class="stripes"><path d="m139 230 15-2-3 32-13-1zm29 3 11 1 2 30-12-1zm26 1 11-2 8 31-13 3zm25-6 9-6 20 27-12 6zm17-15 5-12 32 8-5 13zm4-24 24-8 9 12-33 8z"/></g>
                    </g>
                </g></g>
                <g class="hearts" fill="#bc857c"><path class="heart-one" d="M257 91c-13-11-20 4 0 15 20-11 13-26 0-15"/><path class="heart-two" d="M64 99c-10-8-15 3 0 11 15-8 10-19 0-11"/></g>
                <g class="crumbs" fill="#b59267"><circle cx="138" cy="190" r="2.6"/><circle cx="179" cy="194" r="2"/></g>
                <g class="sleep-marks"><text x="237" y="129">z</text><text x="255" y="109" font-size="25">z</text><text x="275" y="84" font-size="30">z</text></g>
            </svg>`;
    }

    hitTest(clientX, clientY) {
        return Boolean(this.shadowRoot.elementFromPoint(clientX, clientY)?.closest('[data-hit]'));
    }

    update(snapshot) {
        this.setAttribute('coat', 'silver-tabby');
        this.setAttribute('accessory', snapshot.pet.settings.catAccessory || 'none');
        this.setAttribute('behavior', snapshot.runtime.behavior);
        this.setAttribute('direction', snapshot.runtime.behavior === 'walking' && snapshot.runtime.direction < 0 ? 'left' : 'right');
        this.setAttribute('carrying', snapshot.runtime.carrying || '');
        this.toggleAttribute('reduced-motion', snapshot.pet.settings.reducedMotion);
    }
}

customElements.define('silver-cat', SilverCat);
