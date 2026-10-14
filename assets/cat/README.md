# Private photo-cat assets

The cat uses real photographic cutouts, not an illustrated or freely rotatable 3D model. The five PNG sprites are prepared locally from the owner's reference photos. They are ignored by Git; neither the source photographs nor their derivatives are uploaded by the preparation script.

On macOS 14+ with Swift and Python/Pillow installed:

```sh
npm run cat:prepare -- ~/Desktop/cat
```

The script uses Apple's local Vision foreground extraction, preserves the fur and facial features, and exports transparent 640 × 560 sprites. `poses.json` describes the shared canvas and the toy-carrying anchor. No cloud service or API key is used.

Prepared assets work offline on **Windows and macOS**, and are included when packaging this local checkout. A clean Git checkout without these private PNGs keeps the puppy available and disables cat selection with an explanation. To ship the cat on another computer, use a locally built installer or copy the five prepared PNGs to this directory. Keep private-photo assets out of public releases unless the owner explicitly wants to share them.
