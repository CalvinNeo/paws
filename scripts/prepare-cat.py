import argparse
import json
import math
import subprocess
import sys
from pathlib import Path

import cv2
import imageio_ffmpeg
import numpy as np
import pillow_heif
from PIL import Image, ImageDraw, ImageOps

from cat_matting import refine_foreground, stabilize_alpha, repair_gap, remove_edge_spill, restore_foreground, relight_foreground


ROOT = Path(__file__).resolve().parent.parent
SIZE = (1280, 1120)
FRAME_SIZE = (768, 672)
STILLS = {'sitting': 'IMG_3302', 'loaf': 'IMG_0960', 'sleeping': 'IMG_3307', 'relaxed': 'IMG_9704', 'standing': 'IMG_3345'}
TEASER_PLACEMENT = {'bounds': [250, 650, 750, 1460], 'sourceAnchor': [500, 1420], 'canvasAnchor': [384, 621.6], 'scale': 0.8}
CLIPS = {
    'eat': {'source': 'a4283a233e8e675a49b23a79607c4a11.mov', 'startFrame': 960, 'frameStep': 2, 'frames': 64, 'fps': 15, 'loop': False, 'pingPong': False, 'rotationDegrees': 90, 'shadow': [480, 970, 280, 24],
            'lighting': {'exposureStops': 0.9, 'whiteBalance': [0.9, 1.0, 1.22]},
            'gapRepairs': {frame: [90, 960, 290, 1220] for frame in (5, 16, 61, 62)}, 'gapReferences': {61: [60, 63], 62: [60, 63]},
            'backgroundRepairs': {**{frame: [9, 10] for frame in range(1, 9)}, **{frame: [49, 50] for frame in range(51, 65)}}, 'backgroundRegion': [160, 380, 270, 460]},
    'idle': {'source': 'IMG_1768.MOV', 'start': 0.800, 'frames': 12, 'fps': 18, 'loop': True, 'pingPong': True, 'loopPauseMs': 1800},
    'watch': {'source': 'IMG_1768.MOV', 'start': 19.383, 'frames': 12, 'fps': 18, 'loop': True, 'pingPong': True, 'loopPauseMs': 600, 'roi': [140, 400, 750, 1260]},
    'bat': {'source': 'IMG_1768.MOV', 'start': 17.515, 'frames': 19, 'fps': 24, 'loop': False, 'pingPong': False, 'gapRepairs': {9: [440, 990, 660, 1210], 13: [440, 990, 660, 1210]}},
    'teaser-watch': {'source': 'IMG_2125.MOV', 'startFrame': 174, 'frames': 8, 'fps': 30, 'loop': True, 'pingPong': True, 'loopPauseMs': 600, 'roi': [250, 750, 750, 1460], 'alignSubject': False, 'placement': TEASER_PLACEMENT, 'containsJump': False},
    'teaser-ready': {'source': 'IMG_2125.MOV', 'startFrame': 192, 'frames': 5, 'fps': 30, 'loop': False, 'pingPong': False, 'roi': [250, 650, 750, 1460], 'alignSubject': False, 'placement': TEASER_PLACEMENT, 'containsJump': False},
    'groom': {'source': '181426a85ab663fe2059e5167cf63ba3.mov', 'startFrame': 720, 'frameStep': 2, 'frames': 64, 'fps': 15, 'loop': False, 'pingPong': False,
              'foregroundRepairs': {35: [34, 36], **{frame: [39, 46] for frame in range(40, 46)}, 51: [50, 52]}, 'repairRegion': [240, 735, 520, 850],
              'lighting': {'exposureStops': 1.25, 'whiteBalance': [0.86, 1.0, 1.28]}},
}


def foreground_mask(source, folder, extractor, roi=None):
    if roi:
        original = Image.open(source)
        region_source = source.with_name(f'{source.stem}-region-{"-".join(map(str, roi))}.png')
        original.crop(roi).save(region_source)
        region_mask = foreground_mask(region_source, folder, extractor)
        bounds = region_mask.point(lambda value: 255 if value > 12 else 0).getbbox()
        if not bounds or min(bounds[0], bounds[1], region_mask.width - bounds[2], region_mask.height - bounds[3]) < 2:
            raise ValueError(f'Review crop truncates foreground: {source}')
        mask = Image.new('L', original.size)
        mask.paste(region_mask, roi[:2])
        return mask
    outputs = sorted(folder.glob(f'{source.stem}-*.png'))
    if not outputs:
        subprocess.run([str(extractor), str(source), str(folder)], check=True, stdout=subprocess.DEVNULL)
        outputs = sorted(folder.glob(f'{source.stem}-*.png'))
    masks = [Image.open(output).convert('RGBA').getchannel('A') for output in outputs]
    if not masks:
        raise ValueError(f'No foreground in {source.name}')
    return max(masks, key=lambda mask: np.asarray(mask, dtype=np.float32).sum())


def bounds_for(alpha):
    bounds = Image.fromarray(np.rint(alpha * 255).astype(np.uint8)).point(lambda value: 255 if value > 12 else 0).getbbox()
    if bounds is None:
        raise ValueError('Empty foreground mask')
    return bounds


def refine_frame(source, alpha, radius):
    source_rgb = np.asarray(source.convert('RGB'))
    foreground, refined = refine_foreground(source_rgb, alpha, radius=radius)
    return source_rgb, foreground, refined


def rgba_image(foreground, alpha):
    return Image.fromarray(np.rint(np.dstack((foreground, alpha)) * 255).astype(np.uint8))


def place(image, bounds, size, height_fraction=0.82):
    cropped = image.crop(bounds)
    scale = min(size[0] * 0.84 / cropped.width, size[1] * height_fraction / cropped.height)
    resized = cropped.resize((round(cropped.width * scale), round(cropped.height * scale)), Image.Resampling.LANCZOS)
    stage = Image.new('RGBA', size)
    stage.alpha_composite(resized, (round((size[0] - resized.width) / 2), round(size[1] * 0.925 - resized.height)))
    return stage


def place_fixed(image, placement, size):
    bounds = image.getchannel('A').point(lambda value: 255 if value > 12 else 0).getbbox()
    left, top, right, bottom = placement['bounds']
    if bounds is None or bounds[0] < left or bounds[1] < top or bounds[2] > right or bounds[3] > bottom:
        raise ValueError('Foreground extends outside the shared source bounds')
    scale = placement['scale']
    offset = np.asarray(placement['canvasAnchor']) - np.asarray(placement['sourceAnchor']) * scale
    transformed = (bounds[0] * scale + offset[0], bounds[1] * scale + offset[1], bounds[2] * scale + offset[0], bounds[3] * scale + offset[1])
    if min(transformed[0], transformed[1], size[0] - transformed[2], size[1] - transformed[3]) < 2:
        raise ValueError('Shared placement truncates the subject')
    pixels = np.asarray(image, dtype=np.float32) / 255
    pixels[..., :3] *= pixels[..., 3:4]
    transform = np.float32([[scale, 0, offset[0]], [0, scale, offset[1]]])
    placed = cv2.warpAffine(pixels, transform, size, flags=cv2.INTER_LINEAR)
    alpha = placed[..., 3:4]
    placed[..., :3] = np.divide(placed[..., :3], alpha, out=np.zeros_like(placed[..., :3]), where=alpha > 0)
    return Image.fromarray(np.rint(np.clip(placed, 0, 1) * 255).astype(np.uint8))


def prepare_stills(photos, cache, output, extractor, selected=None):
    for pose, name in STILLS.items():
        if selected and pose not in selected:
            continue
        source = cache / f'{name}.png'
        if not source.exists():
            ImageOps.exif_transpose(Image.open(photos / f'{name}.HEIC')).convert('RGB').save(source)
        original = Image.open(source)
        alpha = foreground_mask(source, cache / 'masks', extractor)
        bounds = alpha.point(lambda value: 255 if value > 4 else 0).getbbox()
        margin = 32
        crop = (max(0, bounds[0] - margin), max(0, bounds[1] - margin), min(original.width, bounds[2] + margin), min(original.height, bounds[3] + margin))
        _, foreground, refined = refine_frame(original.crop(crop), alpha.crop(crop), 12)
        if pose == 'standing':
            foreground = remove_edge_spill(foreground, refined)
        subject = rgba_image(foreground, refined)
        if pose == 'standing':
            subject = subject.rotate(-11, resample=Image.Resampling.BICUBIC, expand=True)
        bounds = subject.getchannel('A').point(lambda value: 255 if value > 12 else 0).getbbox()
        prepared = place(subject, bounds, SIZE, 0.82 if pose in ('sitting', 'loaf', 'standing') else 0.65)
        prepared.save(output / f'{pose}-hd.png', optimize=True)
        print(f'Prepared {pose} from {name}', flush=True)


def alignment(previous, current, mask):
    previous_gray = cv2.cvtColor(previous, cv2.COLOR_RGB2GRAY)
    current_gray = cv2.cvtColor(current, cv2.COLOR_RGB2GRAY)
    support = cv2.erode((mask > 0.98).astype(np.uint8), np.ones((19, 19), np.uint8)) * 255
    corners = cv2.goodFeaturesToTrack(previous_gray, maxCorners=100, qualityLevel=0.025, minDistance=12, mask=support)
    if corners is None:
        return np.zeros(2)
    following, status, error = cv2.calcOpticalFlowPyrLK(previous_gray, current_gray, corners, None)
    good = status.reshape(-1).astype(bool) & (error.reshape(-1) < 20)
    offsets = (following - corners).reshape(-1, 2)[good]
    return np.median(offsets, axis=0) if len(offsets) >= 8 else np.zeros(2)


def review_frames(frames, directory, name, background='#252a34', suffix=''):
    for offset in range(0, len(frames), 12):
        batch = frames[offset:offset + 12]
        sheet = Image.new('RGB', (1200, math.ceil(len(batch) / 4) * 290), background)
        drawing = ImageDraw.Draw(sheet)
        for index, frame in enumerate(batch):
            thumbnail = frame.resize((300, 263), Image.Resampling.LANCZOS)
            left, top = index % 4 * 300, index // 4 * 290
            sheet.paste(thumbnail, (left, top), thumbnail)
            drawing.text((left + 12, top + 265), f'{name} frame {index + offset}', fill='black' if suffix else 'white')
        sheet.save(directory / f'{name}-review{suffix}-{offset // 12}.jpg', quality=93)


def prepare_clip(name, settings, photos, cache, output, extractor):
    directory = cache / name
    directory.mkdir(exist_ok=True)
    source_files = [directory / f'frame-{frame_number:04d}.png' for frame_number in range(1, settings['frames'] + 1)]
    if any(not source.exists() for source in source_files):
        command = [imageio_ffmpeg.get_ffmpeg_exe(), '-hide_banner', '-loglevel', 'error', '-y']
        if 'startFrame' in settings:
            frame_step = settings.get('frameStep', 1)
            last_frame = settings['startFrame'] + (settings['frames'] - 1) * frame_step
            selection = f"between(n\\,{settings['startFrame']}\\,{last_frame})"
            if frame_step > 1:
                selection += f"*not(mod(n-{settings['startFrame']}\\,{frame_step}))"
            command += ['-i', str(photos / settings['source']), '-vf', f'select={selection}']
        else:
            command += ['-ss', str(settings['start']), '-i', str(photos / settings['source'])]
        command += ['-frames:v', str(settings['frames']), '-fps_mode', 'passthrough', str(directory / 'frame-%04d.png')]
        subprocess.run(command, check=True)
    refined_frames = []
    previous_rgb = previous_alpha = None
    shift = np.zeros(2)
    first_area = None
    for source in source_files:
        original = Image.open(source).convert('RGB')
        mask = foreground_mask(source, directory / 'masks', extractor, settings.get('roi'))
        frame_number = int(source.stem.split('-')[1])
        gap = settings.get('gapRepairs', {}).get(frame_number)
        if gap:
            neighbors = []
            for neighbor in settings.get('gapReferences', {}).get(frame_number, (frame_number - 1, frame_number + 1)):
                neighbor_file = directory / f'frame-{neighbor:04d}.png'
                neighbors.append((np.asarray(Image.open(neighbor_file).convert('RGB')), foreground_mask(neighbor_file, directory / 'masks', extractor, settings.get('roi'))))
            mask = Image.fromarray(repair_gap(np.asarray(original), mask, neighbors, gap))
        references = settings.get('backgroundRepairs', {}).get(frame_number)
        if references:
            neighbors = []
            for neighbor in references:
                neighbor_file = directory / f'frame-{neighbor:04d}.png'
                neighbors.append((np.asarray(Image.open(neighbor_file).convert('RGB')), foreground_mask(neighbor_file, directory / 'masks', extractor, settings.get('roi'))))
            mask = Image.fromarray(repair_gap(np.asarray(original), mask, neighbors, settings['backgroundRegion']))
        references = settings.get('foregroundRepairs', {}).get(frame_number)
        if references:
            neighbors = []
            for neighbor in references:
                neighbor_file = directory / f'frame-{neighbor:04d}.png'
                neighbors.append((np.asarray(Image.open(neighbor_file).convert('RGB')), foreground_mask(neighbor_file, directory / 'masks', extractor, settings.get('roi'))))
            mask = Image.fromarray(restore_foreground(np.asarray(original), mask, neighbors, settings['repairRegion']))
        rgb, foreground, alpha = refine_frame(original, mask, 6)
        bounds = bounds_for(alpha)
        if min(bounds[0], bounds[1], original.width - bounds[2], original.height - bounds[3]) < 2:
            raise ValueError(f'Clipped silhouette: {source}')
        area = float(alpha.sum())
        first_area = first_area or area
        if not 0.75 < area / first_area < 1.35:
            raise ValueError(f'Unstable subject mask: {source}')
        if previous_rgb is not None:
            if settings.get('alignSubject', True):
                shift += alignment(previous_rgb, rgb, previous_alpha)
            alpha = stabilize_alpha(previous_rgb, previous_alpha, rgb, alpha)
        previous_rgb, previous_alpha = rgb, alpha
        rgba = np.asarray(rgba_image(foreground, alpha))
        if settings.get('alignSubject', True):
            transform = np.float32([[1, 0, -shift[0]], [0, 1, -shift[1]]])
            rgba = cv2.warpAffine(rgba, transform, original.size, flags=cv2.INTER_LINEAR)
        refined_frames.append(Image.fromarray(rgba))
    rotation = settings.get('rotationDegrees', 0)
    if rotation:
        refined_frames = [frame.rotate(rotation, resample=Image.Resampling.BICUBIC, expand=True) for frame in refined_frames]
    bounds = [frame.getchannel('A').point(lambda value: 255 if value > 12 else 0).getbbox() for frame in refined_frames]
    shared_bounds = (min(item[0] for item in bounds), min(item[1] for item in bounds), max(item[2] for item in bounds), max(item[3] for item in bounds))
    placement = settings.get('placement')
    frames = [place_fixed(frame, placement, FRAME_SIZE) if placement else place(frame, shared_bounds, FRAME_SIZE) for frame in refined_frames]
    lighting = settings.get('lighting')
    if lighting:
        for index, frame in enumerate(frames):
            pixels = np.array(frame)
            pixels[..., :3] = np.rint(relight_foreground(
                pixels[..., :3].astype(np.float32) / 255,
                exposure_stops=lighting['exposureStops'],
                white_balance=lighting['whiteBalance'],
            ) * 255).astype(np.uint8)
            frames[index] = Image.fromarray(pixels)
    review_frames(frames, cache, name)
    review_frames(frames, cache, name, '#f6f3e9', '-light')
    files = []
    for offset in range(0, len(frames), 16):
        atlas = Image.new('RGBA', (FRAME_SIZE[0] * 4, FRAME_SIZE[1] * 4))
        for index, frame in enumerate(frames[offset:offset + 16]):
            atlas.paste(frame, ((index % 4) * FRAME_SIZE[0], (index // 4) * FRAME_SIZE[1]))
        filename = f'motion/{name}-{offset // 16}.webp'
        atlas.save(output / filename, format='WEBP', lossless=True, method=4)
        files.append(filename)
    previews = []
    sequence = frames + frames[-2:0:-1] if settings['pingPong'] else frames
    sequence += [sequence[0]] * round(settings.get('loopPauseMs', 0) * settings['fps'] / 1000)
    for frame in sequence:
        preview = Image.new('RGBA', FRAME_SIZE, '#252a34')
        preview.alpha_composite(frame)
        previews.append(preview.convert('RGB'))
    previews[0].save(cache / f'{name}-preview.webp', save_all=True, append_images=previews[1:], duration=round(1000 / settings['fps']), loop=0, quality=90)
    if name == 'bat':
        place(refined_frames[0], shared_bounds, SIZE).save(output / 'reaching-hd.png')
    print(f'Prepared {name}: {len(frames)} actual video frames', flush=True)
    metadata = {'fps': settings['fps'], 'frames': len(frames), 'loop': settings['loop'], 'pingPong': settings['pingPong'], 'loopPauseMs': settings.get('loopPauseMs', 0), 'frameWidth': FRAME_SIZE[0], 'frameHeight': FRAME_SIZE[1], 'columns': 4, 'rows': 4, 'files': files, 'mirror': False}
    if lighting:
        metadata['lighting'] = lighting
    if 'startFrame' in settings:
        metadata.update({'source': {'file': settings['source'], 'startFrame': settings['startFrame'], 'frameCount': len(frames), 'frameStep': settings.get('frameStep', 1)}, 'durationMs': round(len(frames) * 1000 / settings['fps'])})
    if rotation:
        metadata['rotationDegrees'] = rotation
    if 'shadow' in settings:
        metadata['shadow'] = settings['shadow']
    if placement:
        metadata.update({'containsJump': settings.get('containsJump', False), 'placement': placement, 'source': {'file': settings['source'], 'startFrame': settings['startFrame'], 'frameCount': len(frames)}, 'durationMs': round(len(frames) * 1000 / settings['fps'])})
    return metadata


def main():
    parser = argparse.ArgumentParser(description='Prepare the reviewed private cat photographs and real-video motion locally. Originals stay untouched.')
    parser.add_argument('photos', type=Path)
    parser.add_argument('--cache', type=Path, default=ROOT / '.test-artifacts' / 'cat-prepared')
    parser.add_argument('--output', type=Path, default=ROOT / 'assets' / 'cat')
    parser.add_argument('--clips', nargs='+', choices=list(CLIPS), help='Prepare only these clips; preserve all stills and other animations in the existing profile.')
    parser.add_argument('--stills', nargs='+', choices=list(STILLS), help='Prepare only these stills; preserve other existing assets.')
    args = parser.parse_args()
    if sys.platform != 'darwin':
        parser.error('Preparation needs macOS 14+ and Swift. Prepared assets play offline on Windows and macOS.')
    pillow_heif.register_heif_opener()
    cache, output = args.cache.resolve(), args.output.resolve()
    cache.mkdir(parents=True, exist_ok=True)
    (output / 'motion').mkdir(parents=True, exist_ok=True)
    extractor = cache / 'extract-foreground'
    if not extractor.exists():
        subprocess.run(['swiftc', str(ROOT / 'scripts' / 'extract-foreground.swift'), '-o', str(extractor)], check=True)
    partial = bool(args.clips or args.stills)
    if partial:
        profile_file = output / 'poses.mjs'
        if not profile_file.exists():
            parser.error('Partial preparation requires an existing poses.mjs profile in the output directory')
        profile = json.loads(profile_file.read_text().removeprefix('export default ').strip().removesuffix(';'))
        if args.stills:
            prepare_stills(args.photos.expanduser(), cache, output, extractor, args.stills)
            profile['poses'].update({name: {'file': f'{name}-hd.png', 'shadow': [640, 1036, 230 if name in ('sleeping', 'relaxed', 'loaf') else 180, 24], 'mirror': False} for name in args.stills})
    else:
        prepare_stills(args.photos.expanduser(), cache, output, extractor)
        profile = {'width': SIZE[0], 'height': SIZE[1], 'playPose': 'reaching', 'poses': {
            name: {'file': f'{name}-hd.png', 'shadow': [640, 1036, 230 if name in ('sleeping', 'relaxed', 'loaf') else 180, 24], 'mirror': False}
            for name in (*STILLS.keys(), 'reaching')
        }, 'animations': {}}
    selected = {name: CLIPS[name] for name in args.clips} if args.clips else {} if args.stills else CLIPS
    profile['animations'].update({name: prepare_clip(name, settings, args.photos.expanduser(), cache, output, extractor) for name, settings in selected.items()})
    if 'standing' in profile['poses']:
        profile['poses']['standing'].update({'optional': True, 'source': 'IMG_3345.HEIC', 'motion': 'photo-rig'})
    (output / 'poses.mjs').write_text('export default ' + json.dumps(profile, indent=4) + ';\n')
    sources_file = cache / 'sources.json'
    sources = json.loads(sources_file.read_text()) if partial and sources_file.exists() else {'stills': {}, 'clips': {}}
    if args.stills:
        sources['stills'].update({name: STILLS[name] for name in args.stills})
    elif not partial:
        sources['stills'] = STILLS
    sources['clips'].update(selected)
    sources_file.write_text(json.dumps(sources, indent=4))
    print(f'Done. Review sheets and previews: {cache}', flush=True)


if __name__ == '__main__':
    main()
