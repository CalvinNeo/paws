# Private photographic cat assets

The cat uses the owner's actual photographs and short video sequences. Source media and generated PNG/WebP assets stay local and are excluded from Git. No image service or API key is used. `poses.mjs` contains only playback metadata.

## Prepare

Preparation needs macOS 14+, Swift, and Python 3.9+. Playback needs neither Python nor Vision and works offline in Electron on Windows and macOS.

```sh
python3 -m venv .test-artifacts/cat-tools
.test-artifacts/cat-tools/bin/pip install -r scripts/cat-requirements.txt
.test-artifacts/cat-tools/bin/python scripts/prepare-cat.py ~/Desktop/catfull
```

`npm run cat:prepare -- ~/Desktop/catfull` is equivalent when the active Python already has the dependencies. The script is tailored to the reviewed source filenames below. It does not modify or upload originals. `--output` generates into a staging directory for review before replacing active assets; `--cache` selects the intermediate directory. Review sheets and animated previews are written to `.test-artifacts/cat-prepared/` by default. Clear that cache when changing source files or extraction settings.

## Selected sources

| Asset | Source | Selection |
| --- | --- | --- |
| Sitting fallback | IMG_3302.HEIC | Complete seated body |
| Resting (`loaf` save key) | IMG_0960.HEIC | Head lowered, complete tail; muzzle separated from the wall fixture |
| Sleeping | IMG_3307.HEIC | Complete curled body |
| Belly up | IMG_9704.HEIC | Complete reclining body and tail |
| Standing | IMG_3345.HEIC | Front-facing upright photo; hind paws and tail are hidden in the original |
| Idle | IMG_1768.MOV | 0.800–1.168s, 12 consecutive source frames |
| Watch | IMG_1768.MOV | 19.383–19.750s, 12 consecutive source frames |
| Paw reach | IMG_1768.MOV | 17.515–18.115s, 19 consecutive source frames |
| Teaser observation | IMG_2125.MOV | Source frames 174–181, 5.805–6.038s; 8 frames |
| Teaser preparation | IMG_2125.MOV | Source frames 192–196, 6.405–6.538s; 5 frames |
| Grooming | 181426a85ab663fe2059e5167cf63ba3.mov | Source frames 720–846 inclusive, every second frame; 64 frames at 15fps, approximately 24.0–28.2s |
| Eating | a4283a233e8e675a49b23a79607c4a11.mov | Source frames 960–1086 inclusive, every second frame; 64 frames at 15fps, 32.0–36.2s |

Idle and watch play at 18fps, then reverse with a quiet pause; these are edited loops. The paw reach plays once with game-phase timing over about 0.65s and a short final-frame hold. It is not a full swipe-and-return cycle. The reaching fallback is a frame from the same reviewed clip. No clean complete walking cycle was found: pursuit uses the watch clip while the game moves the pet window.

Grooming plays once for 4267ms, followed by a short hold and a return to the selected pose. Sampling every second frame from the approximately 30fps source preserves its speed. It records the cat licking around a raised hind leg, not a front-paw face wash. The 720 × 1280 source is backlit and soft; enlarging its transparent frames does not restore detail. Four lossless atlas pages hold the complete sequence. The action can be replayed and does not change care, game totals or the saved pose. `--clips groom` regenerates this clip without replacing other assets.

The second new video, `4116.MP4`, was also reviewed. Frames 552–626 (18.402–20.902s) contain paw licking, but the bed rim partially obscures the lower outline and the initial mask retains a piece of bedding beside the body. It is not installed as a desktop animation. A clear full-body shot with the paws and tail separated from the bed would be needed for a clean second action.

Eating uses the replacement video `a4283a233e8e675a49b23a79607c4a11.mov`: a continuous overhead view of the cat eating from its real bowl with its entire tail visible. The extracted sequence is rotated 90 degrees counterclockwise for desktop presentation and aligned for camera translation; all anatomy and motion come from this one video. There is no tail graft, generated anatomy, or reversed playback. The 720 × 1280 source limits fine facial detail. Feeding plays the four-page clip once at source speed, then returns to the selected pose; reduced motion freezes it. The earlier `f8706bb1597515370e716471e943320d.mov` remains unused because it crops the tail.

Teaser observation plays at 30fps with a reverse and quiet pause; preparation plays once. They use the same camera-space scale and anchor, with no subject-translation stabilization or independent resizing. The preparation ROI extends upward to include the raised tail. Source frames that introduce colored feather/rod contamination near the paws are excluded. The shared placement preserves the real movement before takeoff. Regenerate just these clips with `scripts/prepare-cat.py ~/Desktop/catfull --clips teaser-watch teaser-ready`; this preserves other assets.

A complete, unoccluded takeoff-through-landing clip is still needed. No `teaser-jump` is installed. Current airborne gameplay uses translated preparation footage and is a prototype, not a recorded airborne body action. A future jump clip must include `containsJump: true` and normalized `contact: {x, y, frame}` metadata calibrated to the paw at impact. This disables the extra window hop and prevents rewards at an unrelated ground-level anchor.

IMG_1769's earlier bat experiment is excluded: the source crops the body and a pink toy overlaps the face. IMG_2111's roller hides the extended paw. Samples with cropped tails or toy overlap are not used to invent missing anatomy.

Resting previously used IMG_0959, where a wall fixture overlaps the muzzle and its mask retained a pointed background fragment resembling malformed whiskers. The adjacent IMG_0960 photograph separates the face from that fixture. It replaces the entire Resting photograph, preserving the real facial fur and whiskers visible against the chest without tracing new strands or retaining the fixture. The saved `loaf` pose and canvas size stay the same.

Standing is a separate optional photograph, not a video atlas. Its mask excludes the chair, mask and foreground cables. A conservative edge-only color correction reduces the reddish chair and cyan object spill, and an 11-degree rotation corrects the camera tilt. No missing paws, tail, fur or whiskers are painted. `--stills standing` updates only this image and its profile metadata.

The Stand up action is explicitly a photo rig: the head translates without changing its proportions, a monotonic torso deformation lifts the chest, the base stays anchored, and a small upper-body sway settles before returning to the previous selected pose. It runs once for 4200ms, can be replayed, and renders its hit mask from the deformed foreground. Reduced motion shows the original standing pose without deformation. This does not reconstruct a genuine sit-to-stand sequence; a full-body continuous shot would be needed for that. IMG_9609/9610 lean on a chair and hide the hindquarters, while IMG_1763 has substantial motion blur, so none is stitched into a false continuous sequence.

## Processing and limits

Still canvases are 1280 × 1120 RGBA; motion tiles are 768 × 672 in lossless WebP sheets, at most 4 × 4 tiles per file. Canvas dimensions are not a claim that the original video subject has that many pixels of detail. In the paw footage the cat is roughly 400 pixels wide before fitting onto the canvas.

Vision produces a soft subject mask. Foreground colors are estimated conservatively from the original RGB near semi-transparent boundaries to reduce blue/gray spill. This never paints invented whiskers. Closed-form alpha matting was also evaluated, but it incorporated sofa texture near the tail and was not accepted. Fine whiskers omitted by the initial mask and source motion blur remain limitations.

Video masks are checked for clipping and large area changes. Optical flow aligns body translation; one shared bounding box per clip prevents per-frame resizing. Low-weight, motion-compensated alpha blending is restricted to agreeing soft-edge pixels. Two reviewed paw frames incorrectly retained bedding between the front legs: that small region is repaired using both neighboring clean masks warped to the current frame, removing a pixel only where both neighbors agree it is background. The source RGB remains unchanged. Every final clip was inspected on dark and light backgrounds; these automatic checks alone do not establish visual quality.

Eight grooming masks incorrectly removed part of the real tail. Inside the reviewed tail region only, two clean nearby masks are warped to the current frame; foreground is restored only where both agree and the original colors match. The current frame supplies all RGB detail. This corrects the mask without drawing new anatomy, fur or whiskers.

Grooming also receives one fixed exposure and white-balance correction after frame placement: +1.25 exposure stops and linear RGB gains of 0.86, 1.0 and 1.28, with a smooth highlight roll-off. This brightens the backlit coat and reduces its warm cast without changing any alpha values. Every frame uses the same transform to avoid exposure flicker; the original videos remain unchanged. Regeneration applies the correction once to freshly prepared frames, never to already-corrected atlases.

Four eating masks retained floor pixels at the tail tip, and 22 retained a bright floor reflection beside the front paw. Inside each reviewed region, two nearby clean masks remove background only where both agree after motion alignment; the source frame supplies the actual fur pixels.

Eating uses the same fixed lighting transform with +0.9 exposure stops and RGB gains of 0.9, 1.0 and 1.22. This lifts the dim coat and reduces the yellow cast while preserving the original alpha, dark fur bands and bowl highlights. All 64 frames use identical settings; regeneration starts from the original source frames rather than applying the correction to an already brightened atlas.

The renderer keeps a bounded shared image cache, draws an alpha-only hit mask for the current frame before adding its shadow, and stops playback for reduced motion, hidden previews, and disconnected elements. Missing atlases fall back to available photographs; missing required stills disable cat selection without discarding the saved cat profile.

## Packaging

Locally built installers include the prepared PNGs and `motion/` directory. For another checkout, privately copy those assets along with matching `poses.mjs`, or regenerate them locally. Do not publish installers containing these private derivatives unless the owner intends to share the media.
