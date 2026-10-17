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

Pet clicks and app activation also leave an already-open dashboard in the background, and never restore a minimized dashboard. Only an explicit home/menu command brings settings forward.

For testing, open **Preferences → Testing → Reset pet data…** and confirm. This resets only the current companion's Fullness/Happiness/Energy to 82/88/76, wakes them, clears friendship, interaction counts, game totals and activity, and ends any game or action. Their name, adoption date, appearance, preferences and desktop position are retained, as is the other companion's data. The reset is saved immediately.

The default pet is **30% of the original width and height** (a 90 × 80 logical-pixel window). Right-click the pet and choose **Pet size**, or open **Wardrobe → A perfect fit** for a **20%–150%** slider. Your choice is saved across restarts; **Reset to 30%** restores the default. Old saves using the original default Medium migrate to 30%; deliberately selected Small/Large keep their previous 80%/120% sizes. Tiny pets hide the text bubble and caption so text never covers the pet; the dashboard still shows interaction messages.

## Your real cat

Right-click the pet → **Your companion → Your cat · real photos**, or choose **Wardrobe → Your cat**. Puppy and cat have **independent profiles**: names, care, friendship, naps, activity, game totals, appearance, size, motion preferences and desktop position. Switching restores that companion's own profile and puts their toys away. Only one pet appears at a time; launch-at-login is the only shared preference.

The cat uses **high-resolution photographs and real video frames** from the owner's cat. **Sitting** includes a short recorded head movement with quiet pauses. **Resting**, **Belly up**, and the curled-up sleeping pose use 1280 × 1120 photographic canvases with subtle breathing. Petting gives gentle **chin scratches**; snacks come in a **bowl**. Cats rest in place by default; wandering remains optional. Cats never fetch bones or carry toys back.

Right-click an awake cat → **Stand up** for a 4.2-second photo-based rise, gentle balance and settle, then a return to the selected pose. **Cat pose → Standing** keeps the upright photograph on the desk. This action uses IMG_3345 with a small torso deformation and an unchanged face; it is synthesized from a photograph, not captured continuous standing-up footage. The source hides the rear paws and tail, so those parts are not reconstructed. Standing earns no care or game rewards, never moves or focuses the pet window, and respects reduced motion. The optional standing asset can be regenerated with `scripts/prepare-cat.py ~/Desktop/catfull --stills standing`; its absence does not disable the other cat poses.

Right-click an awake cat → **Groom**, or choose **Groom** in the dashboard, for a recorded 4.27-second grooming sequence with a raised hind leg. It plays once at the source speed and returns to the selected pose; choosing it again restarts the action. This uses actual video frames, earns no rewards, and respects reduced motion. Fixed exposure and white-balance correction brighten the backlit coat while preserving the transparent outline. The 720p source remains softer than the high-resolution stills. Regenerate only this clip with `scripts/prepare-cat.py ~/Desktop/catfull --clips groom`. Groom is unavailable when its atlases are missing; other cat actions still work.

Games have observation, crouching, acceleration, a short pounce, a visible paw reach, and braking. During play, the cat turns left or right toward the toy by reflecting the recorded footage; the leading paw's contact point follows that direction. After reaching a ball, the cat extends its paw before batting it away at the recorded strike frame. Bubbles also pop at the strike instead of disappearing on approach. Cat toys scale with the pet, including their clickable area and drag distance. Watch and paw movements use transparent 768 × 672 video-frame atlases, with stable scale and optical-flow-assisted alignment. These are short edited real-video clips, not a complete walking cycle or a rotatable 3D model. Moving across the desk still uses translated footage because the supplied videos do not contain a clean full walking cycle. Video detail is limited by the original subject's size and motion blur. Reduced motion freezes playback; hidden or detached previews stop animating.

**Offer a cat snack** now plays 4.27 seconds of actual eating from the new full-body video, including its original bowl and complete tail. Fixed exposure and white-balance correction brighten the coat without changing its transparent outline. It plays once and returns to the selected pose. The cat must be awake and not already full; the existing feeding reward is applied only once. Missing eating assets leave feeding available with a still-photo fallback. Regenerate just this sequence with `scripts/prepare-cat.py ~/Desktop/catfull --clips eat`.

Click handling samples the current rendered frame's alpha mask. Transparent pixels, gaps, letterboxing and the ground shadow pass clicks through, including during animation and after changing poses or size. Cat menus offer only the cat games below; unsupported dog games are also rejected by the application, not merely hidden in the UI.

Photo and video processing is entirely local. Original media remain untouched. Prepared PNGs and `assets/cat/motion/` are **ignored by Git**. A fresh clone without the photographs runs the puppy and explains why cat selection is disabled; existing cat saves fall back to the puppy without losing progress. Missing motion clips fall back to available photographs. To regenerate this owner's curated assets on macOS 14+ with Swift and Python 3.9+:

```sh
python3 -m venv .test-artifacts/cat-tools
.test-artifacts/cat-tools/bin/pip install -r scripts/cat-requirements.txt
.test-artifacts/cat-tools/bin/python scripts/prepare-cat.py ~/Desktop/catfull
```

Apple Vision supplies the initial mask; original RGB reduces background color contamination around soft edges, and motion-compensated alpha blending reduces small frame-to-frame changes. No fur or whiskers are drawn over the photographs. Closed-form matting experiments that introduced background texture were rejected. This process cannot recover occluded anatomy or guarantee every fine whisker; clips with toys crossing the face or missing body parts are excluded. No image-generation service, API key, or upload is involved. Prepared assets run offline on both macOS and Windows. See `assets/cat/README.md` for source selections and packaging details.

## Play

Choose **Playtime** in the dashboard, or **Play together** in the pet or system-tray menu. Each companion has their own games and rewards.

### Puppy — unchanged

- **Fetch a bone (🦴):** grab the bone, drag it across the desktop, and release. Flick faster to throw farther. Your puppy runs to it, visibly carries it back, and leaves it where you originally picked it up. Drag again for another round.
- **Ball rally (🎾):** flick the ball. It rolls, slows down, and bounces off the usable display edges. Your puppy chases it and nudges it back to the starting point.
- **Bubble chase (🫧):** click a bubble to release it, or drag it to a new position. Your puppy catches the floating bubble; another appears after a short celebration.

### Cat

- **Pounce & bat (🧶):** flick the soft ball across your desktop. Your cat watches briefly, pounces, and bats it away. The ball stays where it lands for your next flick; there is no fetching, carrying or return-to-hand phase.
- **Bubble hunt (🫧):** tap or drag a bubble to release it. Your cat watches, then pounces and pops it with a paw; another bubble appears nearby.
- **Feather wand (🪶):** hold and move the feather while the cat watches, prepares and jumps toward it. Move it away to evade a jump or hold it within reach for a catch. Only physical contact earns a reward. Move the feather again after recovery to begin another attempt; leaving it still never repeatedly scores. Release or cancel to end pointer capture.

The wand uses two separate recorded clips from IMG_2125 for grounded observation and the brief preparation before takeoff. The complete jump remains a prototype translation using the preparation footage: the reviewed IMG_2125 and IMG_1758 jumps have feather occlusion or leave the frame. No substitute clip is labelled as a recorded jump. The renderer supports a separate `teaser-jump` with a calibrated paw-contact frame once suitable full-body footage is available.

Only the visible toy shapes and pet respond to the mouse. Toy window padding and gaps pass clicks through. Thrown balls and bubbles become click-through during pursuit; the wand stays draggable so you can tease or evade the cat. A drag captures only the pointer that began on the toy and releases it when you let go or cancel. Toys never focus themselves, hide the dashboard, or register global shortcuts, so typing and working in other apps can continue throughout a game.

Right-click a ready toy and choose **Put toys away**, or use the dashboard/pet/tray menu at any time. There is intentionally no global Escape shortcut. Moving or hiding the pet, starting a nap, switching companions, changing size, suspending/locking the computer, or changing displays also safely ends play. Games stay within the pet's current display's usable area; move the pet to another display before starting a game there.

**Play together is always available**, even at zero energy or during a nap. Choosing a game automatically wakes the pet. Energy still decreases after completed rounds, stops at zero, and never ends play. Only completed rounds earn happiness/friendship and update that companion's saved game totals; cancelling or merely opening a game never earns rewards. Cat and dog needs and reward costs remain independently configured.

## Profiles and development

Saves stay in Electron's `userData` directory under `Pawpal/companion.json`. The version-3 save holds `activeSpecies` and separate `pets.dog` / `pets.cat` states. Old single-profile saves are copied unchanged to `companion.json.before-profiles-<timestamp>` before migration. The dog retains the old progress. If the cat was selected in that old shared save, its identity, care and applicable progress are also retained once, but dog game counters and dog/belly-rub activity are not imported into its profile. Earlier shared history cannot reliably identify which animal earned every point; all future progress is independent. Missing cat photos restore the dog's own profile without deleting the cat's data.

Species rules and UI copy live in `src/companions/dog.cjs` and `src/companions/cat.cjs`. Game state machines are separate in `src/play/dog.cjs` and `src/play/cat.cjs`; `src/play/shared.cjs` only shares drag, motion and bounds primitives. Profile switching/migration lives in `src/profiles.cjs`. Cat improvements can be made without adding cat-specific branches to the puppy's behavior or renderer.

## Checks

For the current cat work:

```sh
npm run test:cat
npm run check
npm run test:cat:electron
```

The cat commands use an isolated cat profile and avoid puppy test flows. The complete suites remain available for work on both companions, but are not part of routine cat verification.

Unit tests cover animation timing and pauses, atlas pages, alpha masks, paw anchors, acceleration, contact-only rewards, independent profiles and offline care, migration backups, allowed games, flick physics, cancellation and display boundaries. Electron smoke tests use an isolated temporary profile and a deterministic cursor **only inside the test process**; they exercise real windows, shape hit-testing, non-focusable flags, menus and IPC validation, separate profiles, actual idle and paw frames, reduced-motion freezing, and stopping playback on detach. Cat rendering/game checks run when the private assets are installed. Screenshots are written under `.test-artifacts/`. A Windows or macOS machine is still needed to verify native click-through behavior on that operating system; DOM-injected test clicks alone cannot prove OS-level input routing.

## Packaging

```sh
npm run dist:mac
npm run dist:win
```

Use the matching operating system to build and verify its installers. Code signing/notarization certificates are not bundled. The original puppy SVG and generated PNG icons are included; regenerate icons with `npm run icons` after editing the SVGs. Locally prepared cat PNGs and motion atlases are included in local installers; do not publish those installers unless you intend to share the private media.
