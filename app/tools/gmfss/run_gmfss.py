#!/usr/bin/env python3
"""
GMFSS_Fortuna Frame Interpolation Wrapper
==========================================
Called by the Electron app to run GMFSS_Fortuna on a directory of extracted frames.

Usage:
  python run_gmfss.py \
    --input_dir   /path/to/frames_in \
    --output_dir  /path/to/frames_out \
    --input_fps   24 \
    --target_fps  60 \
    --quality     BALANCED \
    --scene       AUTO \
    --gpu_id      0 \
    --gmfss_path  /path/to/GMFSS_Fortuna

Prints progress lines to stdout:
  PROGRESS:<percent>
  SCENE_CHANGE:<frame_number>
  ERROR:<message>
  DONE
"""

import argparse
import glob
import os
import sys

def parse_args():
    p = argparse.ArgumentParser(description="GMFSS frame interpolation wrapper")
    p.add_argument("--input_dir", required=True, help="Directory of input frames (PNG)")
    p.add_argument("--output_dir", required=True, help="Directory for interpolated output frames")
    p.add_argument("--input_fps", type=float, default=24.0)
    p.add_argument("--target_fps", type=float, default=60.0)
    p.add_argument("--quality", choices=["FAST", "BALANCED", "BEST"], default="BALANCED")
    p.add_argument("--scene", choices=["AUTO", "STRICT", "OFF"], default="AUTO")
    p.add_argument("--gpu_id", type=int, default=0)
    p.add_argument("--gmfss_path", required=True, help="Path to GMFSS_Fortuna repo root")
    p.add_argument("--union", action="store_true", help="Use union model variant")
    p.add_argument("--fp16", action="store_true", help="Use fp16 for faster inference on Tensor Core GPUs")
    p.add_argument("--scale", type=float, default=1.0, help="Flow scale (0.5 for 4K content)")
    return p.parse_args()


def detect_scene_change(img0, img1, threshold=0.35):
    """Simple MAE-based scene change detection between two tensors."""
    import torch
    diff = torch.abs(img0 - img1).mean().item()
    return diff > threshold


def main():
    args = parse_args()

    # Validate paths
    if not os.path.isdir(args.input_dir):
        print(f"ERROR:Input directory not found: {args.input_dir}", flush=True)
        sys.exit(1)

    if not os.path.isdir(args.gmfss_path):
        print(f"ERROR:GMFSS_Fortuna path not found: {args.gmfss_path}", flush=True)
        sys.exit(1)

    train_log_dir = os.path.join(args.gmfss_path, "train_log")
    if not os.path.isdir(train_log_dir):
        print(f"ERROR:Model weights not found at: {train_log_dir}", flush=True)
        print("ERROR:Download model from https://github.com/98mxr/GMFSS_Fortuna#model-zoo", flush=True)
        sys.exit(1)

    os.makedirs(args.output_dir, exist_ok=True)

    # Add GMFSS_Fortuna to sys.path so we can import its modules
    sys.path.insert(0, args.gmfss_path)

    try:
        import torch
        import numpy as np
        import cv2
        from torch.nn import functional as F
    except ImportError as e:
        print(f"ERROR:Missing dependency: {e}", flush=True)
        sys.exit(1)

    # Set up device
    if torch.cuda.is_available():
        device = torch.device(f"cuda:{args.gpu_id}")
        torch.backends.cudnn.enabled = True
        torch.backends.cudnn.benchmark = True
        if args.fp16:
            torch.set_default_tensor_type(torch.cuda.HalfTensor)
    else:
        device = torch.device("cpu")
        print("WARNING:CUDA not available, falling back to CPU (very slow)", flush=True)

    torch.set_grad_enabled(False)

    # ── Load the GMFSS model ────────────────────────────────────────────────
    try:
        if args.union:
            from model.GMFSS_infer_u import Model
            print("INFO:Using GMFSS union model variant", flush=True)
        else:
            from model.GMFSS_infer_b import Model
            print("INFO:Using GMFSS base model variant", flush=True)

        model = Model()
        model.load_model(train_log_dir, -1)
        model.eval()
        model.device()
        print(f"INFO:Model loaded on {device}", flush=True)

    except Exception as e:
        print(f"ERROR:Failed to load GMFSS model: {e}", flush=True)
        sys.exit(1)

    # ── Gather input frames ─────────────────────────────────────────────────
    frame_patterns = ["*.png", "*.jpg", "*.jpeg"]
    frames = []
    for pat in frame_patterns:
        frames.extend(glob.glob(os.path.join(args.input_dir, pat)))
    frames = sorted(frames)

    if len(frames) < 2:
        print(f"ERROR:Need at least 2 frames, found {len(frames)}", flush=True)
        sys.exit(1)

    print(f"INFO:Found {len(frames)} input frames", flush=True)

    # ── Compute padding (matches GMFSS_Fortuna's own formula) ───────────────
    # Read first frame to get dimensions
    first_frame = cv2.imread(frames[0], cv2.IMREAD_UNCHANGED)
    h, w, _ = first_frame.shape

    scale = args.scale
    tmp = max(64, int(64 / scale))
    ph = ((h - 1) // tmp + 1) * tmp
    pw = ((w - 1) // tmp + 1) * tmp
    padding = (0, pw - w, 0, ph - h)

    print(f"INFO:Frame size {w}x{h}, padded to {pw}x{ph}, scale={scale}", flush=True)

    def load_frame(path):
        """Load a frame as a float32 tensor [1,C,H,W] in [0,1], padded."""
        img = cv2.imread(path, cv2.IMREAD_UNCHANGED)
        # BGR -> RGB, HWC -> CHW
        tensor = torch.from_numpy(np.transpose(img[:, :, ::-1].copy(), (2, 0, 1))).to(
            device, non_blocking=True
        ).unsqueeze(0).float() / 255.0
        # Pad to model-compatible size
        tensor = F.pad(tensor, padding)
        if args.fp16:
            tensor = tensor.half()
        return tensor

    def save_frame(tensor, path):
        """Save a [1,C,H,W] tensor to file, removing padding by cropping (not resizing)."""
        # Crop back to original dimensions (no interpolation — preserves exact pixels)
        result = tensor[:, :, :h, :w]
        # Clamp to valid range
        result = result.clamp(0, 1)
        # Convert to numpy: CHW -> HWC, RGB -> BGR
        img = (result[0] * 255.0).byte().cpu().numpy().transpose(1, 2, 0)
        img = img[:, :, ::-1]  # RGB -> BGR for cv2
        cv2.imwrite(path, img)

    def save_raw_frame(cv2_img, path):
        """Save a raw cv2 image (BGR numpy array) to file."""
        cv2.imwrite(path, cv2_img)

    # ── Interpolation parameters ────────────────────────────────────────────
    multiplier = args.target_fps / args.input_fps

    # For non-integer multipliers (e.g. 24→60 = 2.5x), we compute the exact
    # output timestamps and place each frame at the correct position.
    # This avoids the jitter caused by rounding to a fixed number of intermediates.
    total_input_frames = len(frames)
    total_output_frames = int(round(total_input_frames * multiplier))

    scene_threshold = {
        "AUTO": 0.35,
        "STRICT": 0.20,
        "OFF": 999.0,
    }[args.scene]

    total_pairs = len(frames) - 1
    output_idx = 0
    scene_changes = []

    print(f"INFO:Interpolation multiplier={multiplier:.4f}, {total_input_frames} input -> ~{total_output_frames} output frames", flush=True)
    print(f"INFO:Processing {total_pairs} frame pairs...", flush=True)

    # ── Main interpolation loop ─────────────────────────────────────────────
    # We generate output frames at evenly-spaced timestamps in the source timeline.
    # For each output timestamp, we find which source pair it falls in and the
    # corresponding sub-frame timestep, then call GMFSS to synthesize it.

    # Pre-load first frame
    I1 = load_frame(frames[0])
    lastframe_raw = cv2.imread(frames[0], cv2.IMREAD_UNCHANGED)

    # Cache: track which pair is currently loaded
    current_pair_idx = -1
    current_reuse_things = None
    current_is_scene_change = False
    I0 = None

    for out_i in range(total_output_frames):
        # Map output frame index to a position in the source timeline
        # Output frame out_i corresponds to source position:
        src_pos = out_i * (total_input_frames - 1) / max(total_output_frames - 1, 1)

        # Which source pair does this fall in?
        pair_idx = int(src_pos)
        pair_idx = min(pair_idx, total_pairs - 1)  # clamp to last valid pair

        # Timestep within this pair (0.0 = left frame, 1.0 = right frame)
        timestep = src_pos - pair_idx

        # Load the pair if it changed
        if pair_idx != current_pair_idx:
            I0 = load_frame(frames[pair_idx])
            I1 = load_frame(frames[pair_idx + 1])

            # Scene change detection
            current_is_scene_change = detect_scene_change(I0, I1, scene_threshold)
            if current_is_scene_change:
                scene_changes.append(pair_idx)
                print(f"SCENE_CHANGE:{pair_idx}", flush=True)
                current_reuse_things = None
            else:
                # Precompute reusable flow/features for this pair
                current_reuse_things = model.reuse(I0, I1, scale)

            current_pair_idx = pair_idx

        # Generate the output frame
        if timestep < 0.001:
            # Exactly the left frame — save raw source
            raw = cv2.imread(frames[pair_idx], cv2.IMREAD_UNCHANGED)
            save_raw_frame(raw, os.path.join(args.output_dir, f"{output_idx:08d}.png"))
        elif timestep > 0.999:
            # Exactly the right frame — save raw source
            raw = cv2.imread(frames[pair_idx + 1], cv2.IMREAD_UNCHANGED)
            save_raw_frame(raw, os.path.join(args.output_dir, f"{output_idx:08d}.png"))
        elif current_is_scene_change:
            # Scene change — hold the left frame (no blending across cuts)
            raw = cv2.imread(frames[pair_idx], cv2.IMREAD_UNCHANGED)
            save_raw_frame(raw, os.path.join(args.output_dir, f"{output_idx:08d}.png"))
        else:
            # Synthesize intermediate frame
            try:
                mid = model.inference(I0, I1, current_reuse_things, timestep)
                save_frame(mid, os.path.join(args.output_dir, f"{output_idx:08d}.png"))
            except Exception as e:
                print(f"ERROR:Inference failed at pair {pair_idx}, timestep {timestep:.4f}: {e}", flush=True)
                # Fallback: nearest source frame
                nearest = pair_idx if timestep < 0.5 else pair_idx + 1
                raw = cv2.imread(frames[nearest], cv2.IMREAD_UNCHANGED)
                save_raw_frame(raw, os.path.join(args.output_dir, f"{output_idx:08d}.png"))

        output_idx += 1

        # Progress
        pct = int((out_i + 1) / total_output_frames * 100)
        if pct != int(out_i / total_output_frames * 100):
            print(f"PROGRESS:{pct}", flush=True)

    print(f"INFO:Generated {output_idx} output frames", flush=True)
    print(f"INFO:Scene changes detected: {len(scene_changes)}", flush=True)
    print("DONE", flush=True)


if __name__ == "__main__":
    main()
