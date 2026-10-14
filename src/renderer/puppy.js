let puppySequence = 0;

class PuppyDog extends HTMLElement {
    constructor() {
        super();
        puppySequence += 1;
        const identifier = `puppy-${puppySequence}`;
        const root = this.attachShadow({ mode: 'open' });
        root.innerHTML = `
            <style>
                :host { display: block; width: 100%; height: 100%; --fur: #edc387; --fur-light: #fff0ce; --fur-shadow: #cf995f; --ear: #b67a4b; --ear-light: #ce9560; --muzzle: #fff5e0; --line: #ab7549; }
                :host([coat="cloud"]) { --fur: #eeeae0; --fur-light: #fffef7; --fur-shadow: #d1cbbd; --ear: #aaa798; --ear-light: #c9c3b5; --muzzle: #ffffff; --line: #a39b88; }
                :host([coat="cocoa"]) { --fur: #9d7054; --fur-light: #bf9470; --fur-shadow: #79533f; --ear: #624435; --ear-light: #886048; --muzzle: #ebd4b2; --line: #684939; }
                svg { display: block; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
                [data-hit] path, [data-hit] ellipse, [data-hit] circle { pointer-events: visiblePainted; }
                .outline { stroke: var(--line); stroke-width: 1.3; stroke-linejoin: round; }
                .dog { transform-origin: 160px 242px; animation: breathe 3.8s ease-in-out infinite; }
                .head { transform-origin: 160px 172px; animation: head-tilt 9s ease-in-out infinite; }
                .tail { transform-origin: 219px 196px; animation: wag 1s ease-in-out infinite; }
                .left-ear { transform-origin: 99px 76px; }
                .right-ear { transform-origin: 220px 76px; }
                .awake-eyes { transform-origin: 160px 116px; animation: blink 6.3s infinite; }
                .sleep-eyes, .sleep-marks, .hearts, .ball, .crumbs, .collar, .carried-bone { display: none; }
                :host([carrying="bone"]) .carried-bone { display: block; }
                :host([carrying="bone"]) .tongue { display: none; }
                :host([accessory="collar"]) .collar { display: block; }
                :host([accessory="collar"]) .bandana, :host([accessory="none"]) .bandana { display: none; }
                :host([direction="left"]) .facing { transform: translateX(320px) scaleX(-1); }
                :host([behavior="walking"]) .dog { animation: trot .48s ease-in-out infinite; }
                :host([behavior="walking"]) .front-left, :host([behavior="walking"]) .back-right { animation: step .48s ease-in-out infinite; }
                :host([behavior="walking"]) .front-right, :host([behavior="walking"]) .back-left { animation: step .48s ease-in-out -.24s infinite; }
                :host([behavior="walking"]) .left-ear { animation: ear-flop .48s ease-in-out infinite; }
                :host([behavior="walking"]) .right-ear { animation: ear-flop .48s ease-in-out -.24s infinite; }
                :host([behavior="petting"]) .hearts { display: block; }
                :host([behavior="petting"]) .heart-one { animation: float-heart 1.6s ease-out infinite; }
                :host([behavior="petting"]) .heart-two { animation: float-heart 1.6s ease-out -.8s infinite; }
                :host([behavior="petting"]) .head { animation: happy-tilt 1.1s ease-in-out infinite; }
                :host([behavior="petting"]) .tail, :host([behavior="playing"]) .tail { animation-duration: .24s; }
                :host([behavior="playing"]) .dog { animation: hop .75s ease-in-out infinite; }
                :host([behavior="playing"]) .ball { display: block; animation: bounce .75s ease-in-out -.2s infinite; }
                :host([behavior="eating"]) .head { animation: munch .55s ease-in-out infinite; }
                :host([behavior="eating"]) .crumbs { display: block; animation: crumbs .65s ease-out infinite; }
                :host([behavior="sleeping"]) .awake-eyes, :host([behavior="sleeping"]) .tongue { display: none; }
                :host([behavior="sleeping"]) .sleep-eyes, :host([behavior="sleeping"]) .sleep-marks { display: block; }
                :host([behavior="sleeping"]) .dog { animation: sleep-breathe 4s ease-in-out infinite; }
                :host([behavior="sleeping"]) .head { animation: none; transform: rotate(7deg) translateY(9px); }
                :host([behavior="sleeping"]) .tail { animation: none; transform: rotate(18deg); }
                .sleep-marks { font: 600 21px Georgia, serif; fill: #708673; animation: dream 3s ease-in-out infinite; }
                @keyframes breathe { 0%, 100% { transform: scaleY(1); } 50% { transform: scaleY(1.015); } }
                @keyframes head-tilt { 0%, 32%, 70%, 100% { transform: rotate(0); } 40%, 56% { transform: rotate(-5deg); } }
                @keyframes wag { 0%, 100% { transform: rotate(-12deg); } 50% { transform: rotate(13deg); } }
                @keyframes blink { 0%, 42%, 46%, 100% { transform: scaleY(1); } 44% { transform: scaleY(.08); } }
                @keyframes trot { 0%, 100% { transform: translateY(0) rotate(-1deg); } 50% { transform: translateY(-4px) rotate(1deg); } }
                @keyframes step { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-9px); } }
                @keyframes ear-flop { 0%, 100% { transform: rotate(-3deg); } 50% { transform: rotate(5deg); } }
                @keyframes happy-tilt { 0%, 100% { transform: rotate(-6deg); } 50% { transform: rotate(5deg); } }
                @keyframes float-heart { 0% { opacity: 0; transform: translateY(10px); } 35% { opacity: 1; } 100% { opacity: 0; transform: translateY(-18px); } }
                @keyframes hop { 0%, 100% { transform: translateY(0) scaleY(.97); } 45% { transform: translateY(-20px) rotate(-3deg); } }
                @keyframes bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-34px); } }
                @keyframes munch { 0%, 100% { transform: rotate(2deg) translateY(3px); } 50% { transform: rotate(-2deg) translateY(9px); } }
                @keyframes crumbs { 0% { opacity: 0; transform: translateY(-3px); } 30% { opacity: 1; } 100% { opacity: 0; transform: translateY(12px); } }
                @keyframes sleep-breathe { 0%, 100% { transform: scaleY(.9); } 50% { transform: scaleY(.925); } }
                @keyframes dream { 0%, 100% { opacity: .4; transform: translateY(0); } 50% { opacity: .9; transform: translateY(-6px); } }
                :host([reduced-motion]) *, :host([reduced-motion]) .dog { animation: none !important; }
                @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
            </style>
            <svg viewBox="0 0 320 280" role="img" aria-label="A fluffy little puppy with a wagging tail">
                <defs>
                    <linearGradient id="${identifier}-fur" x1="0" y1="0" x2=".5" y2="1">
                        <stop stop-color="var(--fur-light)"/><stop offset="1" stop-color="var(--fur)"/>
                    </linearGradient>
                    <linearGradient id="${identifier}-ear" x2="0" y2="1">
                        <stop stop-color="var(--ear-light)"/><stop offset="1" stop-color="var(--ear)"/>
                    </linearGradient>
                    <radialGradient id="${identifier}-shadow"><stop stop-color="#75532d" stop-opacity=".2"/><stop offset="1" stop-color="#75532d" stop-opacity="0"/></radialGradient>
                </defs>
                <ellipse cx="164" cy="247" rx="105" ry="16" fill="url(#${identifier}-shadow)"/>
                <g class="facing">
                    <g class="dog" data-hit>
                        <g class="tail">
                            <path class="outline" d="M217 207c36-5 54-34 43-59-4-8-12-6-12 2 0 16-13 20-19 13-4-5-10-1-8 6 9 18-4 23-14 26z" fill="var(--fur-shadow)"/>
                            <path d="M232 182c12-4 20-16 21-29 7 18-6 36-18 40z" fill="var(--fur-light)" opacity=".6"/>
                        </g>
                        <ellipse class="outline" cx="159" cy="203" rx="66" ry="42" fill="url(#${identifier}-fur)"/>
                        <g class="back-left"><ellipse class="outline" cx="103" cy="234" rx="26" ry="16" fill="var(--fur)"/></g>
                        <g class="back-right"><ellipse class="outline" cx="217" cy="234" rx="26" ry="16" fill="var(--fur)"/></g>
                        <path d="M124 181c7 25 8 43 36 49 30-6 29-25 38-49z" fill="var(--muzzle)"/>
                        <g class="front-left">
                            <path class="outline" d="M113 196c-4 12-4 25-6 39-1 14 35 15 37 1l-1-38z" fill="url(#${identifier}-fur)"/>
                            <path d="M116 235v7m10-6v7" fill="none" stroke="var(--line)" stroke-opacity=".5" stroke-linecap="round"/>
                        </g>
                        <g class="front-right">
                            <path class="outline" d="M179 198l-1 38c2 14 37 13 36-1-2-14-2-27-6-39z" fill="url(#${identifier}-fur)"/>
                            <path d="M194 236v7m10-8v7" fill="none" stroke="var(--line)" stroke-opacity=".5" stroke-linecap="round"/>
                        </g>
                        <g class="bandana">
                            <path d="M103 168q58 24 115 0l-19 35-31 22-14-16-28 3z" fill="#bd7b61" stroke="#a96b54" stroke-width="1.2" stroke-linejoin="round"/>
                            <path d="m162 190 14 5-8 11zM187 190l7-3-3 8z" fill="#f4d7af" opacity=".9"/>
                            <path d="m106 173-15 20 23-5 10 7-4-20" fill="#bd7b61"/>
                        </g>
                        <g class="collar">
                            <path d="M108 179q52 25 105 0" fill="none" stroke="#627e70" stroke-width="12" stroke-linecap="round"/>
                            <circle cx="161" cy="199" r="9" fill="#e2b959" stroke="#b99042"/>
                            <path d="m157 199 3 3 5-6" fill="none" stroke="#fff5cf" stroke-width="2" stroke-linecap="round"/>
                        </g>
                        <g class="head">
                            <g class="left-ear">
                                <path class="outline" d="M108 65C71 50 44 78 49 119c3 32 16 49 36 40 19-9 20-39 33-59z" fill="url(#${identifier}-ear)"/>
                                <path d="M83 75c-24 8-22 52-11 64" fill="none" stroke="var(--fur-light)" stroke-opacity=".3" stroke-width="5" stroke-linecap="round"/>
                            </g>
                            <g class="right-ear">
                                <path class="outline" d="M210 65c37-15 64 13 59 54-3 32-16 49-36 40-19-9-20-39-33-59z" fill="url(#${identifier}-ear)"/>
                                <path d="M235 75c24 8 22 52 11 64" fill="none" stroke="var(--fur-light)" stroke-opacity=".3" stroke-width="5" stroke-linecap="round"/>
                            </g>
                            <path class="outline" d="M80 109c-1-39 24-69 56-73l8-9 8 7 14-11 8 12 14-5 4 10c37 10 54 40 48 73l5 7-7 7 4 10-10 5c-11 33-41 47-73 47-35 0-64-17-74-45l-9-5 5-10-7-7z" fill="url(#${identifier}-fur)"/>
                            <path d="M144 48q9-9 14-2m8-2q8-7 13 1" fill="none" stroke="var(--fur-shadow)" stroke-opacity=".35" stroke-width="3" stroke-linecap="round"/>
                            <path d="M106 95q8-6 16-2m74 0q8-4 16 2" fill="none" stroke="var(--ear)" stroke-opacity=".6" stroke-width="3" stroke-linecap="round"/>
                            <g class="awake-eyes">
                                <ellipse cx="115" cy="116" rx="9" ry="11" fill="#41372d"/>
                                <ellipse cx="204" cy="116" rx="9" ry="11" fill="#41372d"/>
                                <circle cx="118" cy="112" r="3" fill="#fffaf0"/><circle cx="207" cy="112" r="3" fill="#fffaf0"/>
                                <circle cx="112" cy="120" r="1.5" fill="#b68e61"/><circle cx="201" cy="120" r="1.5" fill="#b68e61"/>
                            </g>
                            <g class="sleep-eyes" fill="none" stroke="#584437" stroke-width="3.5" stroke-linecap="round">
                                <path d="M106 117q9 9 18 0m71 0q9 9 18 0"/>
                            </g>
                            <ellipse cx="101" cy="141" rx="13" ry="7" fill="#d9957f" opacity=".4"/>
                            <ellipse cx="219" cy="141" rx="13" ry="7" fill="#d9957f" opacity=".4"/>
                            <ellipse cx="160" cy="149" rx="40" ry="31" fill="var(--muzzle)"/>
                            <path d="M146 137q14-9 28 0c0 9-8 16-14 16s-14-7-14-16" fill="#47392e"/>
                            <ellipse cx="156" cy="137" rx="5" ry="2" fill="#fff" opacity=".25"/>
                            <path class="tongue" d="M150 164v10c0 14 20 14 20 0v-10z" fill="#df9690"/>
                            <path class="tongue" d="M160 172v6" stroke="#bd7774" stroke-width="1.4" stroke-linecap="round"/>
                            <path d="M160 153v8m-15 0q6 11 15 1 9 10 15-1" fill="none" stroke="#634b36" stroke-width="2.5" stroke-linecap="round"/>
                            <g class="carried-bone" fill="#fff0c9" stroke="#c5a675" stroke-width="1.1">
                                <path d="M135 163c-8-10-16-1-9 5-7 7 1 15 9 5h50c8 10 16 2 9-5 7-6-1-15-9-5z"/>
                            </g>
                        </g>
                    </g>
                </g>
                <g class="hearts" fill="#c77e71">
                    <path class="heart-one" d="M254 70c-16-13-24 5 0 17 24-12 16-30 0-17"/>
                    <path class="heart-two" d="M69 57c-11-9-17 4 0 13 17-9 11-22 0-13"/>
                </g>
                <g class="ball">
                    <circle cx="269" cy="229" r="17" fill="#7a9d80" stroke="#55735b" stroke-width="1.5"/>
                    <path d="M254 222q18 4 21 23m-5-31q-10 10-16 16" stroke="#e6ead2" stroke-width="3" fill="none"/>
                </g>
                <g class="crumbs" fill="#ba804a"><circle cx="134" cy="185" r="3"/><circle cx="184" cy="192" r="2.5"/><circle cx="143" cy="198" r="2"/></g>
                <g class="sleep-marks"><text x="242" y="86">z</text><text x="261" y="62" font-size="27">z</text><text x="284" y="37" font-size="32">z</text></g>
            </svg>`;
    }

    hitTest(clientX, clientY) {
        return Boolean(this.shadowRoot.elementFromPoint(clientX, clientY)?.closest('[data-hit]'));
    }

    update(snapshot) {
        this.setAttribute('coat', snapshot.pet.settings.coat);
        this.setAttribute('accessory', snapshot.pet.settings.accessory);
        this.setAttribute('behavior', snapshot.runtime.behavior);
        this.setAttribute('direction', snapshot.runtime.behavior === 'walking' && snapshot.runtime.direction < 0 ? 'left' : 'right');
        this.setAttribute('carrying', snapshot.runtime.carrying || '');
        this.toggleAttribute('reduced-motion', snapshot.pet.settings.reducedMotion);
    }
}

customElements.define('puppy-dog', PuppyDog);
