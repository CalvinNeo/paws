# Pawpal

An offline desktop companion for macOS and Windows: an illustrated puppy, or your own cat in real photographs. The native pet and toy windows are small, transparent, and non-focusable. There is no full-screen game overlay, keyboard hook, global mouse-button listener, or screen capture.

## Run

Requires Node.js 22.12 or newer. To set up a new checkout:

```sh
git clone https://github.com/CalvinNeo/puppy.git
cd puppy
npm ci
npm start
```

For an existing checkout, run `npm start` from the `puppy` directory. Quit an already-running Pawpal from its tray or puppy menu before restarting to load code changes. Opening `src/renderer/index.html` directly in a browser only displays the dashboard; desktop toys require Electron.

Normal startup shows **only your selected desktop pet** (a puppy on first launch). Clicking, double-clicking, or repeatedly clicking the pet only pets them; it never opens the dashboard. To open the dashboard, right-click the pet and choose **Open …'s home**, or use the system tray. Starting another instance also leaves the dashboard closed. To deliberately open it at startup, run `npm start -- --show-dashboard` (`--hidden` still takes precedence for login startup).

The default pet is **30% of the original width and height** (a 90 × 80 logical-pixel window). Right-click the pet and choose **Pet size**, or open **Wardrobe → A perfect fit** for a **20%–150%** slider. Your choice is saved across restarts; **Reset to 30%** restores the default. Old saves using the original default Medium migrate to 30%; deliberately selected Small/Large keep their previous 80%/120% sizes. Tiny pets hide the text bubble and caption so text never covers the pet; the dashboard still shows interaction messages.

## Your real cat

Right-click the pet → **Your companion → Your cat · real photos**, or choose **Wardrobe → Your cat**. Switching keeps your name, care, friendship and game progress; the puppy's coat/accessory choices are preserved. Only one pet appears at a time.

The cat is rendered from **real, background-free photographs**, preserving the owner's cat's face, fur, eyes and natural light. Choose **Sitting**, **Loaf**, or **Belly up** in Wardrobe or the **Cat pose** menu. Petting shows the belly-up photo, napping shows a curled-up photo, and games use a reaching photo with the carried bone aligned to the mouth. These are photographic poses, **not an AI-generated walking cycle or a freely rotatable 3D model**. There are no cartoon cat outlines, decorative wiggles, synthetic accessories, or invented facial animation.

Click handling samples the photo's alpha mask rather than its rectangular canvas. Transparent pixels, gaps, letterboxing and the ground shadow pass clicks through, including after changing poses or size. The three desktop games remain available.

Photo processing is entirely local. Original photos remain untouched in their source folder. The five prepared PNGs in `assets/cat/` are **ignored by Git** and are not automatically published. A fresh clone without them runs the puppy and explains why cat selection is disabled; existing cat saves fall back to the puppy without losing progress. To regenerate this owner's assets on macOS 14+ with Swift and Python/Pillow:

```sh
npm run cat:prepare -- ~/Desktop/cat
```

Apple Vision performs background extraction locally; no image-generation service, API key, or upload is involved. Prepared sprites run offline on both macOS and Windows. See `assets/cat/README.md` for private-asset preparation and packaging details.

## Play

Choose **Playtime** in the dashboard, or **Play together** in the pet or system-tray menu:

- **Fetch a bone (🦴):** grab the bone, drag it across the desktop, and release. Flick faster to throw farther. Your puppy runs to it, visibly carries it back, and leaves it where you originally picked it up. Drag again for another round.
- **Ball rally (🎾):** flick the ball. It rolls, slows down, and bounces off the usable display edges. Your puppy chases it and nudges it back to the starting point.
- **Bubble chase (🫧):** click a bubble to release it, or drag it to a new position. Your puppy catches the floating bubble; another appears after a short celebration.

Only the visible toy shapes and pet respond to the mouse. Toy window padding and gaps pass clicks through. During flight or pursuit the toy is fully click-through. A drag captures only the pointer that began on the toy and releases it when you let go or cancel. Toys never focus themselves, hide the dashboard, or register global shortcuts, so typing and working in other apps can continue throughout a game.

Right-click a ready toy and choose **Put toys away**, or use the dashboard/pet/tray menu at any time. There is intentionally no global Escape shortcut. Moving or hiding the pet, starting a nap, switching companions, changing size, suspending/locking the computer, or changing displays also safely ends play. Games stay within the pet's current display's usable area; move the pet to another display before starting a game there.

Only completed rounds earn happiness/friendship, use a little energy, and update the saved game totals. Cancelling or merely opening a game never earns rewards. A tired or sleeping puppy cannot start another round. Existing saves automatically gain zeroed game counters. Saves stay in Electron's `userData` directory under `Pawpal/companion.json`.

## Checks

```sh
npm test
npm run check
npm run test:electron
```

Unit tests cover photo alpha masks, letterboxing, companion/pose persistence, toy shapes, flick physics, fetch/return phases, ball bounces, bubble catches, cancellation, display boundaries, rewards, and old-save compatibility. Electron smoke tests use an isolated temporary profile and a deterministic cursor **only inside the test process**; they exercise real windows, pointer capture, shape hit-testing, non-focusable flags, renderer synchronization, cancellation, and saved counters. Cat rendering/game checks run when the private sprites are installed. Screenshots are written under `.test-artifacts/`. A Windows or macOS machine is still needed to verify native click-through behavior on that operating system; DOM-injected test clicks alone cannot prove OS-level input routing.

## Packaging

```sh
npm run dist:mac
npm run dist:win
```

Use the matching operating system to build and verify its installers. Code signing/notarization certificates are not bundled. The original puppy SVG and generated PNG icons are included; regenerate icons with `npm run icons` after editing the SVGs. Locally prepared cat PNGs are included in local installers; do not publish those installers unless you intend to share the private photos.
