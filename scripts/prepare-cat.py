import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw


ROOT = Path(__file__).resolve().parent.parent
ASSET_DIRECTORY = ROOT / 'assets' / 'cat'
PROFILE = json.loads((ASSET_DIRECTORY / 'poses.json').read_text())
REFERENCES = {
    'sitting': ('ad07d7f5e291178d63aa5689261217e6', 480, 470),
    'loaf': ('c0f60f7e800ea750341bf9ee23df40a8', 418, 365),
    'reaching': ('a6f3ae16ebb4a2301ae47d3d77d88c5c', 470, 460),
    'sleeping': ('62f4b3228f578d48a19963924941f164', 430, 350),
    'relaxed': ('83c4e63e7d529d01b5102d35beadcfd1', 510, 350),
}


def prepare_pose(pose: str, source: Path, maximum_width: int, maximum_height: int) -> None:
    image = Image.open(source).convert('RGBA')
    alpha = image.getchannel('A')
    if pose == 'sitting':
        cleanup = Image.new('L', image.size, 255)
        ImageDraw.Draw(cleanup).polygon([(1001, 1172), (1057, 1172), (1057, 1335), (1008, 1335), (998, 1278)], fill=0)
        alpha = ImageChops.multiply(alpha, cleanup)
        image.putalpha(alpha)
    bounds = alpha.point(lambda value: 255 if value >= 8 else 0).getbbox()
    if bounds is None:
        raise ValueError(f'No visible pixels in {source.name}')
    bounds = (
        max(0, bounds[0] - 2), max(0, bounds[1] - 2),
        min(image.width, bounds[2] + 2), min(image.height, bounds[3] + 2),
    )
    cropped = image.crop(bounds)
    scale = min(maximum_width / cropped.width, maximum_height / cropped.height)
    if pose == PROFILE['playPose']:
        source_mouth = (555, 529)
        target_mouth = PROFILE['poses'][pose]['mouth']
        scale = min(scale, (519 - target_mouth[1]) / (bounds[3] - source_mouth[1]))
        left = round(target_mouth[0] - (source_mouth[0] - bounds[0]) * scale)
        top = round(target_mouth[1] - (source_mouth[1] - bounds[1]) * scale)
    else:
        left = round((PROFILE['width'] - cropped.width * scale) / 2)
        top = round(519 - cropped.height * scale)
    resized = cropped.resize((round(cropped.width * scale), round(cropped.height * scale)), Image.Resampling.LANCZOS)
    stage = Image.new('RGBA', (PROFILE['width'], PROFILE['height']))
    stage.alpha_composite(resized, (left, top))
    destination = ASSET_DIRECTORY / PROFILE['poses'][pose]['file']
    stage.save(destination, optimize=True)
    print(f'{pose}: {destination}')


def main() -> None:
    parser = argparse.ArgumentParser(description='Prepare private, photographic cat sprites locally. Originals are never modified or uploaded.')
    parser.add_argument('photos', type=Path, help='Folder containing the reference photos')
    parser.add_argument('--cutouts', type=Path, help='Reuse foreground PNGs produced by extract-foreground.swift')
    arguments = parser.parse_args()
    photos = arguments.photos.expanduser().resolve()
    missing = [f'{identifier}.jpg' for identifier, _, _ in REFERENCES.values() if not (photos / f'{identifier}.jpg').is_file()]
    if missing:
        parser.error(f'Missing reference photos: {", ".join(missing)}')
    if arguments.cutouts is None and sys.platform != 'darwin':
        parser.error('Local extraction requires macOS 14+ and Swift. Prepared PNG assets run on both Windows and macOS.')
    ASSET_DIRECTORY.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='pawpal-cat-') as temporary:
        cutouts = arguments.cutouts.resolve() if arguments.cutouts else Path(temporary)
        for pose, (identifier, maximum_width, maximum_height) in REFERENCES.items():
            if arguments.cutouts is None:
                subprocess.run([
                    'swift', str(ROOT / 'scripts' / 'extract-foreground.swift'),
                    str(photos / f'{identifier}.jpg'), str(cutouts),
                ], check=True)
            prepare_pose(pose, cutouts / f'{identifier}-1.png', maximum_width, maximum_height)
    print('Done. Only background-free derivatives were saved; all original photos remain in their source folder.')


if __name__ == '__main__':
    main()
