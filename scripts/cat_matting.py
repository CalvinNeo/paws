import cv2
import numpy as np
from scipy import ndimage


def refine_foreground(image, alpha, radius=6, strength=0.55):
    image = np.asarray(image, dtype=np.float32) / 255
    alpha = np.asarray(alpha, dtype=np.float32) / 255
    core = cv2.erode((alpha > 0.995).astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
    exterior = alpha < 0.005
    if not core.any() or not exterior.any():
        return image, alpha
    distance, nearest = ndimage.distance_transform_edt(~core, return_indices=True)
    foreground_prior = image[nearest[0], nearest[1]]
    background_distance, nearest = ndimage.distance_transform_edt(~exterior, return_indices=True)
    background = image[nearest[0], nearest[1]]
    solved = (image - (1 - alpha[..., None]) * background) / np.maximum(alpha, 0.15)[..., None]
    solved = np.clip(solved, foreground_prior - 0.12, foreground_prior + 0.12)
    support = (alpha > 0.01) & (alpha < 0.995) & (distance <= radius) & (background_distance <= radius)
    contrast = np.linalg.norm(foreground_prior - background, axis=2)
    weight = support * np.clip((contrast - 0.04) / 0.16, 0, 1) * strength
    return np.clip(image * (1 - weight[..., None]) + solved * weight[..., None], 0, 1), alpha


def stabilize_alpha(previous_rgb, previous_alpha, image, alpha):
    height, width = alpha.shape
    reduced_size = (max(1, width // 2), max(1, height // 2))
    previous_gray = cv2.resize(cv2.cvtColor(previous_rgb, cv2.COLOR_RGB2GRAY), reduced_size)
    current_gray = cv2.resize(cv2.cvtColor(image, cv2.COLOR_RGB2GRAY), reduced_size)
    flow = cv2.calcOpticalFlowFarneback(current_gray, previous_gray, None, 0.5, 3, 19, 3, 5, 1.2, 0)
    flow = cv2.resize(flow, (width, height)) * 2
    horizontal, vertical = np.meshgrid(np.arange(width, dtype=np.float32), np.arange(height, dtype=np.float32))
    warped = cv2.remap(previous_alpha, horizontal + flow[..., 0], vertical + flow[..., 1], cv2.INTER_LINEAR)
    matching_rgb = cv2.remap(previous_rgb, horizontal + flow[..., 0], vertical + flow[..., 1], cv2.INTER_LINEAR)
    agreement = np.max(np.abs(matching_rgb.astype(np.float32) - image), axis=2) < 18
    soft_edge = (alpha > 0.01) & (alpha < 0.99) & (np.abs(warped - alpha) < 0.2) & agreement
    return np.where(soft_edge, alpha * 0.85 + warped * 0.15, alpha)


def remove_edge_spill(foreground, alpha, radius=12):
    interior = cv2.erode((alpha > 0.995).astype(np.uint8), np.ones((radius * 2 + 1, radius * 2 + 1), np.uint8)).astype(bool)
    if not interior.any():
        return foreground
    distance, nearest = ndimage.distance_transform_edt(~interior, return_indices=True)
    prior = foreground[nearest[0], nearest[1]]
    tint = foreground - prior
    chroma = tint.max(axis=2) - tint.min(axis=2)
    weight = np.clip((chroma - 0.045) / 0.11, 0, 1) * (distance <= radius * 2) * (alpha > 0)
    luminance = foreground.mean(axis=2, keepdims=True)
    corrected = np.clip(prior * luminance / np.maximum(prior.mean(axis=2, keepdims=True), 0.05), 0, 1)
    return foreground * (1 - weight[..., None]) + corrected * weight[..., None]


def repair_gap(image, alpha, neighbors, region):
    alpha = np.asarray(alpha, dtype=np.float32) / 255
    height, width = alpha.shape
    horizontal, vertical = np.meshgrid(np.arange(width, dtype=np.float32), np.arange(height, dtype=np.float32))
    current_gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    estimates = []
    for neighbor_rgb, neighbor_alpha in neighbors:
        flow = cv2.calcOpticalFlowFarneback(current_gray, cv2.cvtColor(neighbor_rgb, cv2.COLOR_RGB2GRAY), None, 0.5, 4, 25, 5, 7, 1.5, 0)
        estimates.append(cv2.remap(np.asarray(neighbor_alpha, dtype=np.float32) / 255, horizontal + flow[..., 0], vertical + flow[..., 1], cv2.INTER_LINEAR))
    consensus = np.maximum.reduce(estimates)
    left, top, right, bottom = region
    support = (horizontal >= left) & (horizontal < right) & (vertical >= top) & (vertical < bottom)
    return np.rint(np.where(support, np.minimum(alpha, consensus), alpha) * 255).astype(np.uint8)
