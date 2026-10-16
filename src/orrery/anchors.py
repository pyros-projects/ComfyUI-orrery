"""Anchors: the frames Orrery Refs last fetched for each sent image, kept in the orrery home.

Every time Orrery Refs fetches a `SEND:` image from the chain, it stores the frames under
`anchors/image_N/` (one PNG a frame). With Orrery Refs' `keep_sent` on, an image that has an
anchor comes from it instead, from segment 0 and for the whole run, so a character can outlive
the run that made it; switched off, the next fetch replaces the anchor.
"""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import TYPE_CHECKING

from orrery.home import Home

if TYPE_CHECKING:
    import numpy as np  # numpy and Pillow come with ComfyUI; the CLI's core runs without them


def folder(home: Home, n: int) -> Path:
    return home.anchors_dir / f"image_{n}"


def stored(home: Home) -> set[int]:
    """The images that have an anchor."""
    if not home.anchors_dir.is_dir():
        return set()
    return {int(p.name.split("_", 1)[1]) for p in home.anchors_dir.glob("image_*")
            if p.is_dir() and p.name.split("_", 1)[1].isdigit() and any(p.glob("*.png"))}


def save(home: Home, n: int, frames) -> None:
    """Store an IMAGE batch (torch or numpy, values 0–1) as image N's anchor, replacing the old one."""
    import numpy as np
    from PIL import Image

    array = frames.cpu().numpy() if hasattr(frames, "cpu") else np.asarray(frames)
    dest = folder(home, n)
    tmp = dest.with_name(dest.name + ".tmp")
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    for i, frame in enumerate(array):
        Image.fromarray(np.clip(frame[..., :3] * 255.0 + 0.5, 0, 255).astype(np.uint8)).save(tmp / f"{i:04d}.png")
    shutil.rmtree(dest, ignore_errors=True)
    tmp.rename(dest)


def load(home: Home, n: int) -> np.ndarray | None:
    """Image N's anchor as a float array (frames, height, width, 3), or None without one."""
    import numpy as np
    from PIL import Image

    files = sorted(folder(home, n).glob("*.png"))
    if not files:
        return None
    return np.stack([np.asarray(Image.open(f).convert("RGB"), dtype=np.float32) / 255.0 for f in files])
