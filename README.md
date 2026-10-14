# Pawpal

An offline desktop puppy for macOS and Windows. The native pet and toy windows are small, transparent, and non-focusable. There is no full-screen game overlay, keyboard hook, global mouse-button listener, or screen capture.

## Run

Requires Node.js 22.12 or newer. To set up a new checkout:

```sh
git clone https://github.com/CalvinNeo/puppy.git
cd puppy
npm ci
npm start
```

For an existing checkout, run `npm start` from the `puppy` directory. Quit an already-running Pawpal from its tray or puppy menu before restarting to load code changes. Opening `src/renderer/index.html` directly in a browser only displays the dashboard; desktop toys require Electron.

## Play

Choose **Playtime** in the dashboard, or **Play together** in the puppy or system-tray menu:

- **Fetch a bone (🦴):** grab the bone, drag it across the desktop, and release. Flick faster to throw farther. Your puppy runs to it, visibly carries it back, and leaves it where you originally picked it up. Drag again for another round.
- **Ball rally (🎾):** flick the ball. It rolls, slows down, and bounces off the usable display edges. Your puppy chases it and nudges it back to the starting point.
- **Bubble chase (🫧):** click a bubble to release it, or drag it to a new position. Your puppy catches the floating bubble; another appears after a short celebration.

Only the visible toy shapes and puppy respond to the mouse. Toy window padding and gaps pass clicks through. During flight or pursuit the toy is fully click-through. A drag captures only the pointer that began on the toy and releases it when you let go or cancel. Toys never focus themselves, hide the dashboard, or register global shortcuts, so typing and working in other apps can continue throughout a game.

Right-click a ready toy and choose **Put toys away**, or use the dashboard/puppy/tray menu at any time. There is intentionally no global Escape shortcut. Moving or hiding the puppy, starting a nap, changing its size, suspending/locking the computer, or changing displays also safely ends play. Games stay within the puppy's current display's usable area; move the puppy to another display before starting a game there.

Only completed rounds earn happiness/friendship, use a little energy, and update the saved game totals. Cancelling or merely opening a game never earns rewards. A tired or sleeping puppy cannot start another round. Existing saves automatically gain zeroed game counters. Saves stay in Electron's `userData` directory under `Pawpal/companion.json`.

## Checks

```sh
npm test
npm run check
npm run test:electron
```

Unit tests cover toy shapes, flick physics, fetch/return phases, ball bounces, bubble catches, cancellation, display boundaries, rewards, and old-save compatibility. Electron smoke tests use an isolated temporary profile and a deterministic cursor **only inside the test process**; they exercise real windows, pointer capture, shape hit-testing, non-focusable flags, renderer synchronization, cancellation, and saved counters. Screenshots are written under `.test-artifacts/`. A Windows or macOS machine is still needed to verify native click-through behavior on that operating system; DOM-injected test clicks alone cannot prove OS-level input routing.

## Packaging

```sh
npm run dist:mac
npm run dist:win
```

Use the matching operating system to build and verify its installers. Code signing/notarization certificates are not bundled. The original SVG illustrations and generated PNG icons are included; regenerate icons with `npm run icons` after editing the SVGs.
