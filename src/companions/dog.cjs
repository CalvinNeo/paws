module.exports = Object.freeze({
    species: 'dog',
    defaultName: 'Mochi',
    defaults: { roaming: true, coat: 'apricot', accessory: 'bandana' },
    choices: { coat: ['apricot', 'cloud', 'cocoa'], accessory: ['bandana', 'collar', 'none'] },
    minimumPlayEnergy: 12,
    playAnchor: .61,
    needs: { awake: { fullness: 4, happiness: 3, energy: -5 }, sleeping: { fullness: 2, happiness: 1, energy: 18 } },
    care: {
        pet: { label: 'Head scratches', emoji: '🤍', description: 'A little love', menu: 'Give a head scratch', happiness: 7, affection: 1, message: 'My favorite human. ♥', activity: 'A few head scratches. A very happy pup.', explanation: 'Head scratches (🤍) add happiness and friendship. You can also click the puppy itself.' },
        feed: { label: 'A little treat', emoji: '🦴', description: 'Something yummy', menu: 'Give a treat', fullness: 22, energy: 3, affection: 2, message: 'A treat? For me? Nom nom!', activity: 'A tasty treat, served with love.', explanation: 'A little treat (🦴) restores fullness and a little energy. Wake your puppy before feeding; a full puppy will save snacks for later.' },
    },
    friendship: 'A small dog. A very big friendship.',
    welcome: 'Happy you’re here. ♡',
    sleepMessage: 'A little dream. A little snore.',
    playDescription: 'Three little games',
    playExplanation: 'Playtime (🎾) opens three desktop games: Fetch a bone (🦴), Ball rally (🎾), and Bubble chase (🫧). Only the toy and puppy respond to clicks. Completed rounds earn happiness and use a little energy.',
    playHelp: 'Fetch a bone (🦴), Ball rally (🎾), and Bubble chase (🫧): drag a bone or ball and release to throw; faster flicks travel farther. Your puppy retrieves the bone or nudges the ball back to where you picked it up. Tap or drag a bubble to let it float; your puppy catches it, then another appears.',
    games: {
        fetch: { label: 'Fetch a bone', emoji: '🦴', toy: 'bone', instruction: 'Drag the bone and let go, or flick to throw. I’ll bring it back!', description: 'Drag the bone and release. A quick flick sends it farther; your puppy brings it back.', progress: 'bones returned', reward: { energy: 4, happiness: 8, affection: 2, text: 'A bone fetched and proudly brought back.', message: 'Fetched it! Another throw? 🦴' } },
        ball: { label: 'Ball rally', emoji: '🎾', toy: 'ball', instruction: 'Flick the ball. I’ll chase it and nudge it back to you!', description: 'Flick a bouncing ball across your desk. Your puppy chases it and nudges it back.', progress: 'rallies completed', reward: { energy: 5, happiness: 10, affection: 2, text: 'Chased a bouncing ball and nudged it back.', message: 'Your turn! That was a good rally. 🎾' } },
        bubbles: { label: 'Bubble chase', emoji: '🫧', toy: 'bubble', instruction: 'Tap a bubble to send it floating, or drag it somewhere new.', description: 'Tap a bubble to send it floating, or drag it somewhere new. Your puppy catches it. Pop!', progress: 'bubbles caught', reward: { energy: 2, happiness: 5, affection: 1, text: 'Chased a floating bubble. Pop! One happy friend.', message: 'Pop! Did you see that? 🫧' } },
    },
});
