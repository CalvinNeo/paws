module.exports = Object.freeze({
    species: 'cat',
    defaultName: 'My cat',
    defaults: { roaming: false, catPose: 'sitting' },
    choices: { catPose: ['sitting', 'loaf', 'relaxed'] },
    minimumPlayEnergy: 8,
    playAnchor: .53,
    needs: { awake: { fullness: 3, happiness: 2, energy: -3 }, sleeping: { fullness: 1.5, happiness: .5, energy: 18 } },
    care: {
        pet: { label: 'Chin scratches', emoji: '🤍', description: 'A gentle hello', menu: 'Give a chin scratch', happiness: 5, affection: 1, message: 'Prrr… right under the chin. ♥', activity: 'A gentle chin scratch. A quiet moment together.', explanation: 'Chin scratches (🤍) gently add happiness and trust. Your cat keeps their chosen pose; petting does not turn into a belly rub.' },
        feed: { label: 'A little snack', emoji: '🥣', description: 'A small serving', menu: 'Offer a cat snack', fullness: 18, energy: 2, affection: 1, message: 'A little snack, then a little nap.', activity: 'A small cat snack, served in a bowl.', explanation: 'A little snack (🥣) restores your cat’s fullness and a little energy. Wake them before feeding; a full cat saves snacks for later.' },
    },
    friendship: 'A little cat. A quiet kind of trust.',
    welcome: 'A quiet moment with you. ♡',
    sleepMessage: 'Curled up. Not a care in the world.',
    playDescription: 'Two little cat games',
    playExplanation: 'Cat playtime (🧶): flick a soft ball for Pounce & bat (🧶), or release a bubble for Bubble hunt (🫧). Your cat watches, pounces and bats; they never fetch or carry a toy back. Only visible toys and your cat receive mouse input.',
    playHelp: 'Pounce & bat (🧶): flick the soft ball. Your cat watches, pounces and bats it away, leaving it where it lands for your next flick. There is no return-to-hand phase. Bubble hunt (🫧): tap or drag a bubble; your cat watches, then catches it with a paw. No bones, fetch, or carrying. Only completed catches and bats earn rewards.',
    games: {
        pounce: { label: 'Pounce & bat', emoji: '🧶', toy: 'yarn', instruction: 'Flick the soft ball. I’ll watch, pounce, and bat it away.', description: 'Flick the soft ball. Your cat stalks and bats it away—no fetching it back.', progress: 'balls batted', reward: { energy: 3, happiness: 7, affection: 1, text: 'Watched, pounced, and batted a soft ball away.', message: 'Caught it. Bat! Where did it go? 🧶' } },
        bubbles: { label: 'Bubble hunt', emoji: '🫧', toy: 'bubble', instruction: 'Tap or drag a bubble. A little watching, then a quick paw.', description: 'Release a floating bubble. A patient look, a little pounce, and a paw-sized pop.', progress: 'bubbles popped', reward: { energy: 2, happiness: 5, affection: 1, text: 'Watched a floating bubble, then popped it with a paw.', message: 'One paw. One tiny pop. 🫧' } },
    },
});
