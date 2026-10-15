"""ComfyUI nodes: Orrery Prompt (seeded text + picks) and Orrery Log (galaxy.jsonl).

The node pack folder `comfyui/` in the repo is what gets symlinked into
ComfyUI/custom_nodes; it only puts `src/` on the path and re-exports these
mappings. Everything testable lives here.
"""

import hashlib
import json
import math
import os
import re
from datetime import UTC, datetime
from pathlib import Path

from orrery import anchors, endpoint, history, loras, miniruns, preview, runs, uistate
from orrery import batch as batches
from orrery import sweep as sweeps
from orrery.autolib import needs, write_apart
from orrery.chain import DEFAULT_CHAIN, load, previous_clip
from orrery.comfy_film import OrreryContinue, OrreryFilm
from orrery.comfy_llm import ComfyBackend, can_write, llm_config
from orrery.comfy_refmods import OrreryRefMods
from orrery.comfy_write import OrreryAsk, OrreryWrite
from orrery.continuum.grid import CONTEXT
from orrery.dsl import (
    RNG,
    MissingLibrary,
    bindings,
    expand,
    override,
    parse,
    strip_comments,
    wanted_libraries,
    with_inline,
)
from orrery.h3 import DEFAULT_CONTEXT, compile_scene, image_slots, render_scene
from orrery.h3_ref import word_issue
from orrery.home import STATE, Home, resolve_home
from orrery.library import library_files
from orrery.llm import Backend, InvalidProposal, OpenAIBackend
from orrery.loras import long_form, lora_files, lora_stack
from orrery.presets import (
    list_presets,
    load_preset,
    preset_exists,
    remember_template,
    resolve_includes,
)
from orrery.reel import ReelEnd, split_reel
from orrery.slots import (
    SLOT,
    export_slots,
    fill,
    fill_exports,
    keep_marks,
    names_output,
    pictures_in,
    put_back,
    request,
    rewrites_in,
    slots,
    write,
)
from orrery.takes import kept_rewrites, rewrite_key, write_pictures

TARGETS = ["text", "h3-base", "flat"]
NO_PRESET = "(none)"
DEFAULT_TEMPLATE = "$hero = __animal__\n$hero in a {misty|frozen:2|burning} forest"


H3_FPS = 24
H3_DEFAULT_LENGTH = 124  # the MiniMax H3 nodes' default: about 5 s


def h3_length(seconds: float) -> int:
    """Frames at 24 fps, snapped up to H3's 17k+5 grid like the MiniMax H3 nodes do."""
    frames = max(5, math.ceil(seconds * H3_FPS - 1e-4))
    return frames + (5 - frames) % 17


_MP = re.compile(r"(\d+(?:\.\d+)?)\s*mp", re.IGNORECASE)


def header_megapixels(template: str) -> float | None:
    """`0.6MP` in the @h3 line: the canvas area in megapixels."""
    first = next((line.strip() for line in template.splitlines() if line.strip()), "")
    header = re.match(r"@h3\s+\w+(.*)$", first, re.IGNORECASE)
    return next((float(m.group(1)) for t in header.group(1).split() if (m := _MP.fullmatch(t))), None) if header else None


def h3_canvas(ratio: str, megapixels: float | None = None) -> tuple[int, int] | None:
    """The MiniMax H3 canvas for a ratio: 768 short edge, 768×1344 area cap, multiples of 32. With
    megapixels, the area is that many pixels in the ratio's shape (square without a ratio)."""
    m = re.fullmatch(r"(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)", ratio or "")
    if (not m or not float(m.group(2))) and not megapixels:
        return None
    r = float(m.group(1)) / float(m.group(2)) if m and float(m.group(2)) else 1.0
    if megapixels:
        w, h = math.sqrt(megapixels * 1e6 * r), math.sqrt(megapixels * 1e6 / r)
        return max(32, round(w / 32) * 32), max(32, round(h / 32) * 32)
    w, h = (768 * r, 768) if r >= 1 else (768, 768 / r)
    if w * h > 768 * 1344:
        scale = math.sqrt(768 * 1344 / (w * h))
        w, h = w * scale, h * scale
    return max(32, round(w / 32) * 32), max(32, round(h / 32) * 32)


def fit_canvas(ratio: float, area: float, step: int = 32) -> tuple[int, int]:
    """Width and height in multiples of `step`, in `ratio`'s shape as closely as the grid allows, with an
    area within 10 % of `area`: a picture scaled to it is not stretched (H3 stretches a first frame)."""
    ideal, best = math.sqrt(area * ratio), None
    for k in range(max(1, int(ideal * 0.8 // step)), int(ideal * 1.25 // step) + 2):
        w = k * step
        h = max(step, round(w / ratio / step) * step)
        if 0.9 <= w * h / area <= 1.1:
            key = (round(abs(math.log(w / h / ratio)), 9), abs(math.log(w * h / area)))
            best = min(best, (key, (w, h))) if best else (key, (w, h))
    if best:
        return best[1]
    return max(step, round(ideal / step) * step), max(step, round(math.sqrt(area / ratio) / step) * step)


def _frame_area(template: str, ratio: float) -> float:
    """The canvas area for a frame-shaped clip: the header's megapixels, else H3's canvas in that shape
    (768 short edge, 768×1344 cap), else 1024²."""
    if megapixels := header_megapixels(template):
        return megapixels * 1e6
    first = next((line.strip() for line in template.splitlines() if line.strip()), "")
    if not re.match(r"@h3\b", first, re.IGNORECASE):
        return 1024 * 1024
    w, h = (768 * ratio, 768) if ratio >= 1 else (768, 768 / ratio)
    return min(w * h, 768 * 1344)


Size = tuple[int, int] | None  # (width, height) of a wired frame


def shape(template: str, frames: tuple[Size, Size] = (None, None)) -> tuple[int, int, int]:
    """width, height and H3 length for the node's outputs: `: w… h…` wins, then the shape of a wired frame
    (first, else last), then an @h3 ratio."""
    params = parse(template).params
    lines = [line.strip() for line in template.splitlines() if line.strip()]
    header = re.match(r"@h3\s+\w+(.*)$", lines[0], re.IGNORECASE) if lines else None
    ratio = next((t for t in header.group(1).split() if h3_canvas(t)), "") if header else ""
    canvas = h3_canvas(ratio, header_megapixels(template)) or (1024, 1024)
    frame = frames[0] or frames[1]
    if frame and not (params.width or params.height):
        canvas = fit_canvas(frame[0] / frame[1], _frame_area(template, frame[0] / frame[1]))
    seconds = sum(float(m.group(1)) for line in lines
                  if (m := re.match(r"SHOT\s+(\d+(?:\.\d+)?)\s*s\b", line, re.IGNORECASE)))
    return (params.width or canvas[0], params.height or canvas[1],
            h3_length(seconds) if seconds else H3_DEFAULT_LENGTH)


def _same_shape(a: tuple[int, int], b: tuple[int, int], tolerance: float = 0.02) -> bool:
    return abs(math.log((a[0] / a[1]) / (b[0] / b[1]))) <= tolerance


def frame_lint(template: str, sizes: tuple[Size, Size], width: int, height: int) -> list[dict]:
    """What the wired frames did to the size, and the mismatches H3 would stretch or crop."""
    first, last = sizes
    frame, which = (first, "first") if first else (last, "last")
    if not frame:
        return []
    out = []
    params = parse(template).params
    if params.width or params.height:
        if not _same_shape(frame, (width, height)):
            out.append({"severity": "warn", "message": (
                f"`: w… h…` makes the clip {width}×{height}, but the {which} frame is {frame[0]}×{frame[1]}: H3 "
                f"{'stretches' if which == 'first' else 'crops'} it. Leave the size out and orrery takes it from the frame.")})
    else:
        lines = [line.strip() for line in template.splitlines() if line.strip()]
        header = re.match(r"@h3\s+\w+(.*)$", lines[0], re.IGNORECASE) if lines else None
        ratio = next((t for t in header.group(1).split() if h3_canvas(t)), "") if header else ""
        written = h3_canvas(ratio) if ratio else None
        if written and not _same_shape(written, frame):
            out.append({"severity": "info", "message": (
                f"The {which} frame is {frame[0]}×{frame[1]}, so the clip is {width}×{height} in its shape; the "
                f"header's {ratio} is set aside (H3 would stretch the frame into it).")})
    if first and last and not _same_shape(first, last):
        out.append({"severity": "warn", "message": (
            f"The last frame is {last[0]}×{last[1]}, the first {first[0]}×{first[1]}: H3 crops the last frame to the "
            "first's shape. Use two pictures of one shape.")})
    return out


def _size(image) -> Size:
    """(width, height) of an IMAGE batch [frames, height, width, channels], or None."""
    return None if image is None else (int(image.shape[2]), int(image.shape[1]))


def linked_preset(extra_pnginfo, unique_id) -> str | None:
    """The preset the node's editor is linked to, from the workflow ComfyUI sends along."""
    workflow = (extra_pnginfo or {}).get("workflow") or {}
    graphs = [workflow, *((workflow.get("definitions") or {}).get("subgraphs") or [])]
    node_id = str(unique_id or "").rsplit(":", 1)[-1]
    for graph in graphs:
        for node in graph.get("nodes") or []:
            if str(node.get("id")) == node_id:
                return (node.get("properties") or {}).get("orrery_preset") or None
    return None


def dial_values(params: str) -> dict[str, str]:
    """The node's params widget: JSON {binding: expression}; blanks and bad JSON count as unset."""
    try:
        values = json.loads(params) if params and params.strip() else {}
    except json.JSONDecodeError:
        print("[orrery] warn: the dials are not valid JSON and are ignored.")
        return {}
    return {str(k).lstrip("$"): str(v).strip() for k, v in values.items() if str(v).strip()} if isinstance(values, dict) else {}


def llm_for(home: Home, seed: int = 0, temperature: float | None = None) -> Backend | None:
    """The language model chosen in orrery's settings: an API endpoint (#165) or a text encoder there, else none;
    nothing wired overrides it (#282). `temperature` overrides the configured one (the writers' own)."""
    cfg = llm_config(home)
    options = {"temperature": float(cfg["temperature"] if temperature is None else temperature),
               "max_length": int(cfg["max_tokens"]), "seed": seed}
    if (api := endpoint.backend(home, options["temperature"])) is not None:
        return api
    if cfg["file"] and can_write(cfg["file"]):
        return ComfyBackend(file=cfg["file"], clip_type=cfg["clip_type"], **options)
    return None


def _missing_libraries(home: Home, template: str) -> bool:
    libraries = home.libraries()
    return not all(name in libraries and len(libraries[name].entries) >= n
                   for name, n in wanted_libraries(template).items())


def _count(frames) -> int:
    return len(frames) if frames is not None else 0


def _picture(image):
    """The first picture of a ComfyUI IMAGE batch, as PIL."""
    from PIL import Image

    batch = image.detach().cpu().numpy() if hasattr(image, "detach") else image
    return Image.fromarray((batch[0].clip(0, 1) * 255).round().astype("uint8"))


def _slot_pictures(h, words: list[str], result, inputs: dict | None, lint: list) -> tuple[list[str], list]:
    """The pictures the slots name (#174), as PIL, and the words of those found: first_frame and last_frame from
    the node's inputs, `image N` from the gallery pictures of the clip's CAST, a gallery name from its file. One
    that is not there is said and left out; its slot is written without it."""
    from PIL import Image

    from orrery import pictures as gallery

    kept, shown = [], []
    for word in words:
        if word in ("first_frame", "last_frame"):  # an IMAGE in a run, the Load Image's file over the API
            wired = (inputs or {}).get(word)
            picture = None if wired is None else Image.open(wired) if isinstance(wired, str | Path) else _picture(wired)
            why = f"nothing is wired into the Orrery Prompt's {word}"
        elif word.isdigit():
            made = (getattr(result, "pictures", None) or {}).get(int(word)) or {}
            picture = Image.open(made["file"]) if made.get("file") else None
            why = f"image {word} is no gallery picture of the CAST (one wired into Orrery Refs is not there while the prompt is written)"
        else:
            files = gallery.find(word, h.libraries()) or []
            picture, why = (Image.open(files[0]) if files else None), f"image {word} is no picture of the gallery"
        if picture is None:
            lint.append({"severity": "warn", "message": f"A slot names image {word}, but {why}: it is written without it."})
            continue
        kept.append(word)
        shown.append(picture)
    return kept, shown


def _images(frames, shown: list, backend):
    """What the model sees: the previous clip's frames, then the pictures the slots name. An endpoint takes them as
    they are; a text encoder takes one IMAGE batch, so every picture is fitted into one square size (#174)."""
    if not shown:
        return frames
    stills = [_picture(frames[i:i + 1]) for i in range(len(frames))] if frames is not None and len(frames) else []
    every = stills + shown
    if isinstance(backend, OpenAIBackend):
        return every
    import numpy as np
    import torch
    from PIL import Image

    edge, squares = 512, []
    for picture in every:
        picture = picture.convert("RGB")
        picture.thumbnail((edge, edge))
        square = Image.new("RGB", (edge, edge))
        square.paste(picture, ((edge - picture.width) // 2, (edge - picture.height) // 2))
        squares.append(np.asarray(square, dtype=np.float32) / 255)
    return torch.from_numpy(np.stack(squares))


def _passages(result, target: str) -> list[tuple[str, str, object]]:
    """What `> instructions` ask to rewrite: (instruction, passage, put the rewrite in its place).
    A text prompt is one passage; in a screenplay, each prose line of a shot in scope, never dialogue."""
    if target == "text":
        if not result.enhance:
            return []
        return [(result.enhance, result.text, lambda new: setattr(result, "text", new))]
    out = []
    for shot in result.scene.shots:
        instruction = shot.enhance or result.scene.enhance
        for i, item in enumerate(shot.items if instruction else []):
            if isinstance(item, str) and item.strip():
                out.append((instruction, item, lambda new, items=shot.items, i=i: items.__setitem__(i, new)))
    return out


def _dials(template: str, params) -> dict[str, str]:
    """The dials (JSON or a dict) of the template's own bindings."""
    known = {name for name, _ in bindings(template)}
    return {k: v for k, v in dial_values(params if isinstance(params, str) else json.dumps(params or {})).items() if k in known}


def dialed(h, template: str, params) -> str:
    """The template as a run reads it: its dials applied, @include resolved, comments gone, the short forms long."""
    return long_form(strip_comments(resolve_includes(h, override(template, _dials(template, params)))))  # the hash keeps the comments


def _sweep_run(h, source: str, sweep: str):
    """A LoRA sweep's or a grid's run of this queue item (the first, from ComfyUI's own Run): the template as that
    run reads it, its grid cell, and what the run records of it."""
    plan, sweep_picks, sweep_data, folder, cell = sweeps.runs(source), [], None, "", None
    grid = batches.axes(*with_inline(source, h.libraries())) if parse(source).params.grid is not None else []
    cells = batches.cells(grid) if grid else 1
    planned = sweep_formula(source, grid)
    if plan or grid:
        index, _, folder = (sweep or "").partition("|")
        i = int(index) if index.strip().isdigit() else 0
        total = max(len(plan), 1) * cells
        if i >= total:
            raise ValueError(f"Sweep run {i} does not exist: this template sweeps {total} runs ({planned}).")
        lora_run, cell = divmod(i, cells)
        if plan:
            sweep_picks = sweeps.picks(source, plan[lora_run])
            source = sweeps.apply(source, plan[lora_run])
        cell = cell if grid else None
        sweep_data = {"run": i, "runs": total}
    return source, cell, plan, grid, cells, planned, sweep_picks, sweep_data, folder


def swept(h, source: str, sweep: str) -> tuple[str, int | None]:
    """The template and the grid cell a sweep's run reads (#171's plan asks the same as its render run)."""
    return _sweep_run(h, source, sweep)[:2]


def _ask_library(one, h, backend) -> dict:
    """A mini-run's library (#171): written as a run writes it, for review."""
    from orrery.autolib import lists_in, prompt_for, write_lists
    from orrery.llm import extract_json

    if not one:
        return {"task": "library", "error": "nothing to write: the library is there, or no language model is set"}
    try:
        notes = write_lists(h, one, lists_in(extract_json(backend.complete(prompt_for(one))), one), backend)
    except (InvalidProposal, RuntimeError) as err:
        return {"task": "library", "what": one[0].name, "error": str(err)}
    return {"task": "library", "what": one[0].name, "notes": notes}


def _ask_rewrites(h, passages, result, target: str, packed: bool, backend) -> dict:
    """A mini-run's rewrites (#171): every `>` passage of the run in one request, as the run asks them, each into
    the cache by its instruction and passage."""
    if backend is None:
        return {"task": "rewrites", "error": "> enhance needs a language model"}
    if not passages:
        return {"task": "rewrites", "written": 0, "of": 0}
    marked = [keep_marks(passage) for _, passage, _ in passages]
    prompt = request([], [], result.text, 0, [(i, t) for (i, _, _), (t, _) in zip(passages, marked, strict=True)],
                     made=_made(result, packed) if target != "text" else [])
    try:
        reply = backend.complete(prompt)
        written = 0
        for (instruction, before, _), (_, kept), new in zip(passages, marked, rewrites_in(reply, len(marked)), strict=False):
            after = put_back(new, kept) if new else None
            if after:
                miniruns.put(h, miniruns.rewrite_cache_key(rewrite_key(instruction, before)), after)
                written += 1
    except (InvalidProposal, RuntimeError) as err:
        return {"task": "rewrites", "error": str(err)}
    return {"task": "rewrites", "written": written, "of": len(passages)}


def _ask_slot(h, directions: str, todo: list[str], result, target: str, packed: bool, frames, pictures, backend, key) -> dict:
    """A mini-run's slot (#171): one slot, seeing what the run's request would show it (the prompt as it rolls, the
    clip before, the pictures it names), into the cache under `key`."""
    if directions not in todo:
        return {"task": "slot", "what": directions, "error": "this roll has no such slot"}
    if backend is None:
        return {"task": "slot", "what": directions, "error": "--…-- slots are written by a language model"}
    said: list[dict] = []
    named, shown = _slot_pictures(h, pictures_in([directions]), result, pictures, said)
    prompt = request([], [directions], result.text, _count(frames), [],
                     made=_made(result, packed) if target != "text" else [], pictures=named)
    try:
        got, _ = write(h, [], [directions], backend.complete(prompt, images=_images(frames, shown, backend)), backend)
    except (InvalidProposal, RuntimeError) as err:
        return {"task": "slot", "what": directions, "error": str(err)}
    if directions not in got:
        return {"task": "slot", "what": directions, "error": "the language model wrote nothing for it"}
    miniruns.put(h, key, got[directions])
    return {"task": "slot", "what": directions, "text": got[directions], "notes": [i["message"] for i in said]}


def run_prompt(template: str, seed: int, target: str, home: str = "",
               preset: str = NO_PRESET, linked: str | None = None,
               params: str = "", segment: int = 0,
               frames=None, packed: bool = False,
               wired: int | None = None, chain: str = DEFAULT_CHAIN,
               keep: bool = False, sweep: str = "",
               continued: bool = False, sizes: tuple[Size, Size] = (None, None),
               refmodded: bool = True, standing: frozenset[int] = frozenset(),
               pictures: dict | None = None, ask: dict | None = None):
    """`frames`: the previous clip's stills, which the model sees when it writes `--…--` slots.
    `pictures`: the IMAGEs wired into first_frame and last_frame, for a slot that names them (#174).
    `packed`: Orrery Refs routes the images per clip; `wired`: the reference images Reference to
    Video has (both from the graph, see `wiring`). `chain`: the Motion Context chain SEND: reads;
    `keep`: Orrery Refs' keep_sent, so sent images with a stored anchor are held from segment 0.
    `sweep`: "run|galaxy folder", set by Generate for each run of a LoRA sweep (orrery.sweep) or a
    `: grid` (orrery.batch); the LoRA runs are the outer loop, the grid's cells the inner one.
    `continued`: an Orrery Continue reads the picks, which pins 22 frames whatever `context:` says.
    `sizes`: (width, height) of the frames wired into first_frame and last_frame, or None.
    `refmodded`: an Orrery RefMods reads the picks, which applies the clip's RefMods.
    `ask`: one task of a mini-run (#171), {"task": "library"|"rewrites"|"slot", "what": …}: the run goes as far as
    the task needs, answers it with one request, puts the answer where the render run finds it, and returns what it
    did (a dict) instead of the run's outputs. Without it, the run takes what its mini-runs wrote and asks the model
    only for the rest."""
    h = resolve_home(home or None)
    if preset and preset != NO_PRESET:
        template, linked = load_preset(h, preset), preset
    if linked and not preset_exists(h, linked):
        linked = None
    dials, source = _dials(template, params), dialed(h, template, params)
    if target == "text" or split_reel(source) is None:  # no SCENE: one clip on its own, never a reel's next (#190)
        segment, frames = 0, None
    source, cell, plan, grid, cells, planned, sweep_picks, sweep_data, folder = _sweep_run(h, source, sweep)

    # One request per run (ComfyUI cannot safely generate twice): libraries still missing and the
    # slots go together, the slots then seeing the template; otherwise the slots see the compiled prompt.
    written, missing = slots(source), _missing_libraries(h, source)
    backend = llm_for(h, seed=seed) if written or missing else None
    if written and backend is None:
        raise ValueError("--…-- slots are written by a language model: pick one in orrery's settings (the gear in "
                         "the node)")
    texts: dict[str, str] = {}
    notes: list[str] = []
    missed: dict[str, str] = {}  # marker → directions of the slots the combined answer left out
    wanted = needs(h, source, int(llm_config(h)["entries"])) if missing and backend is not None else []
    if ask and ask.get("task") == "library":
        return _ask_library([n for n in wanted if n.name == ask.get("what")], h, backend)
    if ask and wanted:
        return {**ask, "error": "the libraries this template needs are still to be written"}
    if wanted and isinstance(backend, OpenAIBackend):  # an endpoint writes each library apart, at once, and can be
        notes, wanted = write_apart(h, wanted, backend), []  # asked again: the slots then see the compiled prompt
    if wanted:
        see = frames if written else None
        reply = backend.complete(request(wanted, written, source, _count(see)), images=see)
        answered, notes = write(h, wanted, written, reply, backend)
        texts = {f"slot {i}": answered.get(d) or d for i, d in enumerate(written, start=1)}
        missed = {f"slot {i}": d for i, d in enumerate(written, start=1) if d not in answered}
        source = SLOT.sub(lambda m: f"--slot {written.index(m.group(1)) + 1}--", source)  # survives the compile
    try:
        if target == "text":
            result = expand(source, seed, h.libraries(), h.weights(), cell=cell)
            lint = [{"severity": "warn", "message": w} for w in result.warnings]
        else:
            result = compile_scene(source, seed, h.libraries(), h.weights(), target=target, segment=segment,
                                   packed=packed, held=anchors.stored(h) if keep else frozenset(), cell=cell,
                                   standing=standing, past=_past(chain, segment),
                                   film=_held(chain, segment) if continued else None)
            lint = [{"severity": i.severity, "message": i.message} for i in result.lint]
            needed = len(result.refs) if packed else max(image_slots(result.scene), default=0)
            if wired is not None and wired < needed:
                lint.append({"severity": "warn", "message": f"This clip uses {needed} reference images, but Reference "
                                                            f"to Video has {wired} wired: <Picture {wired + 1}> and up "
                                                            "point at nothing."})
    except MissingLibrary as err:
        raise ValueError(f"{err}, or pick a language model in orrery's settings (the gear in the node) "
                         "and it is created when the node runs") from err
    passages = _passages(result, target)
    enhanced: list[dict] = []
    if passages:  # a rewrite kept for this roll (Use selected, #276) or written by its mini-run (#171) stands in
        kept = kept_rewrites(h)  # for the model's, before the slots
        asked = {} if ask and ask.get("task") == "rewrites" else miniruns.cached(h)
        ready = {}
        for instruction, before, place in passages:
            key = rewrite_key(instruction, before)
            if key in kept or miniruns.rewrite_cache_key(key) in asked:
                ready[key] = kept[key]["text"] if key in kept else asked[miniruns.rewrite_cache_key(key)]
                place(ready[key])
                enhanced.append({"instruction": instruction, "before": before, "after": ready[key],
                                 **({"kept": True} if key in kept else {"asked": True})})
        passages = [p for p in passages if rewrite_key(p[0], p[1]) not in ready]
        if enhanced and target != "text":
            result.text = render_scene(result.scene, target, [])
    if ask and ask.get("task") == "rewrites":
        return _ask_rewrites(h, passages, result, target, packed, backend or llm_for(h, seed=seed))
    todo = slots(result.text)
    todo += [d for d in export_slots(getattr(result, "exports", {})) if d not in todo]  # EXPORT: lines write too
    later = [d for d in todo if names_output(d)]  # from the picture the run makes: once it exists (#174, #175)
    todo = [d for d in todo if d not in later]
    exported = set(export_slots(getattr(result, "exports", {})))
    lint += [{"severity": "warn", "message": f"--{d}-- names image output, the picture this run makes, which exists only "
                                             "after it: such a slot stands in an EXPORT: line, and the Gallery writes it."}
             for d in later if d not in exported]
    if ask and ask.get("task") == "slot":
        return _ask_slot(h, ask.get("what", ""), todo, result, target, packed, frames, pictures, backend,
                         miniruns.slot_key(source, seed, segment, cell, ask.get("what", "")))
    asked_slots = {}
    if todo and not wanted:  # what the run's mini-runs wrote (#171)
        asked = miniruns.cached(h)
        asked_slots = {d: asked[k] for d in todo if (k := miniruns.slot_key(source, seed, segment, cell, d)) in asked}
        todo = [d for d in todo if d not in asked_slots]
    named, shown = _slot_pictures(h, pictures_in(todo), result, pictures, lint) if todo else ([], [])
    if passages and wanted:
        lint.append({"severity": "info", "message": "The > enhance instructions run on the next run; this one "
                                                    "writes the missing libraries."})
    elif passages and backend is None:
        backend = llm_for(h, seed=seed)
        if backend is None:
            lint.append({"severity": "warn", "message": "> enhance needs a language model: pick one in orrery's "
                                                        "settings (the gear in the node); the prompt stays as written."})
    if (todo or (passages and backend is not None)) and not wanted:
        marked = [keep_marks(passage) for _, passage, _ in passages] if backend is not None else []
        prompt = request([], todo, result.text, _count(frames),
                         [(instruction, text) for (instruction, _, _), (text, _) in zip(passages, marked, strict=False)],
                         made=_made(result, packed) if target != "text" else [], pictures=named)
        try:
            reply = backend.complete(prompt, images=_images(frames, shown, backend))
            texts, _ = write(h, [], todo, reply, backend)
            for (instruction, before, place), (_, kept), new in zip(passages, marked, rewrites_in(reply, len(marked)),
                                                                    strict=False):
                after = put_back(new, kept) if new else None
                if after is None:
                    lint.append({"severity": "warn", "message": f"> {instruction}: the language model left a passage "
                                                                "as it was."})
                    continue
                place(after)
                enhanced.append({"instruction": instruction, "before": before, "after": after})
            if enhanced and target != "text":
                result.text = render_scene(result.scene, target, [])
        except InvalidProposal as err:
            lint.append({"severity": "warn", "message": f"The language model wrote no slots or rewrites ({err})."})
    texts = {**asked_slots, **texts}
    unanswered = [missed[k] for k in todo if k in missed] if wanted else [d for d in todo if d not in texts]
    lint += [{"severity": "warn", "message": f"--{d}-- got no text from the language model; its directions stand in."}
             for d in unanswered]
    result.text = fill(result.text, texts)
    if getattr(result, "exports", None):
        result.exports = fill_exports(result.exports, texts)
    if texts and "\ndetailed_description:\n" in result.text:  # count what the model wrote too
        lint = [i for i in lint if not i["message"].startswith("detailed_description has")]
        described = result.text.split("\ndetailed_description:\n", 1)[1].split("\n\noverall_soundscape:", 1)[0]
        if issue := word_issue(described):
            lint.append({"severity": issue.severity, "message": issue.message})
    lint = [{"severity": "info", "message": n} for n in notes] + lint
    for old in sweeps.legacy(source):
        swept = old.split(":", 2)[-1].rstrip(">")
        lint.append({"severity": "info", "message": f"{old} sweeps with commas, as before: write "
                     f"{old.replace(swept, swept.replace(',', '|'))}, since commas now separate a knob's strength, "
                     "start and end (#227)."})
    if (plan or grid) and not sweep:
        what = "LoRA sweep" if not grid else "Grid" if not plan else "LoRA sweep and grid"
        on = " on this clip (the segment holds still)" if getattr(result, "chunks", 0) else ""
        lint.append({"severity": "info", "message": f"{what}: {max(len(plan), 1) * cells} runs ({planned}); "
                                                     f"Roll runs them all{on}, Run takes the first."})
    stack: list = []
    if result.loras:  # a screenplay's LORA: lines, or a text template's (#311)
        stack, warnings = lora_stack(result.loras, lora_files())
        lint += [{"severity": "warn", "message": w} for w in warnings]
    refmods = getattr(result, "refmods", []) if target != "text" else []
    images = getattr(result, "images", []) if target != "text" else []
    if (refmods or images) and not refmodded:
        what = ", ".join([r["name"] for r in refmods] + [f"image {i['image']} at {i['strength']:g}" for i in images])
        lint.append({"severity": "warn", "message": (
            f"This clip uses RefMods or picture strengths ({what}), but no Orrery RefMods reads this node's picks: "
            "put one between Reference to Video's conditioning and the sampler (or Orrery Continue), with the "
            "picks wired in. The prompt already describes them.")})
    for issue in lint:
        print(f"[orrery] {issue['severity']}: {issue['message']}")
    data = {
        "seed": seed,
        "target": target,
        "template": remember_template(h, template),
        "preset": linked,
        "edited": bool(linked) and template != load_preset(h, linked),
        "params": dials,
        **({"exports": result.exports} if target == "text" and getattr(result, "exports", None) else {}),
        "rng": parse(source).params.rng or RNG,  # the dice: a replay of an older run puts @rng 1 on top
        # a screenplay's format (lite by default since 2026-10-02, `full` the guide's): a replay of an older run adds full
        **({"format": "lite" if result.scene.lite else "full"} if target != "text" and getattr(result, "scene", None) else {}),
        "text": result.text,
        "picks": [{"label": p.label, "value": p.value, "keys": list(p.keys)} for p in result.picks] + sweep_picks,
        **({"sweep": sweep_data} if sweep_data else {}),
        **({"folder": folder.strip()} if sweep_data and folder.strip() else {}),
        "lint": lint,
        **({"refs": result.refs} if target != "text" and packed else {}),
        **({"pictures": {str(n): p["file"] for n, p in result.pictures.items() if not packed or n in result.refs}}
           if target != "text" and getattr(result, "pictures", None) else {}),
        **({"sends": {"chain": chain, "home": str(h.root), "slots": result.send_slots,
                      "ready": {str(k): v for k, v in result.sends.items()}}}
           if target != "text" and result.send_slots else {}),
        **({"enhanced": enhanced} if enhanced else {}),
        **({"refmods": refmods} if refmods else {}),
        **({"images": images} if images else {}),
    }
    width, height, length = shape(source, sizes)
    lint += frame_lint(source, sizes, width, height)
    data["megapixels"] = header_megapixels(source) or round(width * height / 1e6, 3)
    if target != "text":
        if result.scene.shots:
            length = h3_length(result.scene.duration)
        if result.chunks:
            data["segment"], data["chunks"], data["segments"] = result.segment, result.chunks, result.segments
            data["chunk"] = result.chunk  # the scene this clip plays, which its take keeps (#240)
            data["kept"] = result.kept  # its bindings and END ON:, so the clips after it read the past as rendered (#261)
            data["continues"] = result.continues
            if result.test:
                data["test"] = True
            if result.uses_input:
                data["input"] = True
            context = DEFAULT_CONTEXT if result.scene.context is None else result.scene.context
            data["chain"], data["context"] = chain, context
            if continued and context != CONTEXT:
                off = abs(context - CONTEXT)
                data["lint"].append({"severity": "warn", "message": (
                    f"context: {context}, but Orrery Continue pins {CONTEXT} frames all the same, so from the second "
                    f"segment on each clip runs {off} frames ({off / 24:.1f} s) "
                    f"{'longer' if context > CONTEXT else 'shorter'} than its shots. Write context: {CONTEXT}, or "
                    "leave the line out; H3 Motion Context takes other lengths.")})
                print(f"[orrery] warn: {data['lint'][-1]['message']}")
    return result.text, json.dumps(data, ensure_ascii=False), seed, width, height, length, stack


def _keep_input(video, latent_path: str) -> None:
    """The input video, kept in the reel's chain (orrery.film.keep_input) for Orrery Refs, Orrery RefMods
    and Orrery Continue to read."""
    if video is None:
        raise ValueError("This reel reads the input video (a REMEMBER: in the head, or a scene AFTER: the input "
                         "video), but nothing is wired into the Orrery Prompt's video input: wire a Load Video.")
    import folder_paths  # ComfyUI

    from orrery import film

    output = Path(folder_paths.get_output_directory())
    source = video.get_stream_source()
    if not isinstance(source, str):  # a video held in memory: written out first
        source = str(Path(folder_paths.get_temp_directory()) / "orrery_input_source.mp4")
        video.save_to(source)
    film.keep_input(source, output, latent_path)


def _previous(latent_path: str, segment: int):
    """The stills of the clip before this segment in the chain, for the model's `--…--` slots, else None."""
    try:
        import folder_paths  # ComfyUI
    except ImportError:
        return None
    path = previous_clip(Path(folder_paths.get_output_directory()), latent_path or DEFAULT_CHAIN, segment)
    return load(path) if path else None


def _held(latent_path: str, segment: int) -> frozenset[int] | None:
    """The segments Orrery Film's film holds (#415): a clip whose clip before it lacks starts afresh. None for clip 1
    and outside ComfyUI, where the reel runs as written."""
    if segment <= 0:
        return None
    from orrery import film

    try:
        import folder_paths  # ComfyUI

        return film.held(Path(folder_paths.get_output_directory()), latent_path or DEFAULT_CHAIN)
    except Exception:  # noqa: BLE001 - no store: as written
        return None


def _past(latent_path: str, segment: int) -> dict[int, dict]:
    """What the clips before this segment rendered, from Orrery Film's takes (#261); nothing outside ComfyUI."""
    if segment <= 0:
        return {}
    from orrery import film

    try:
        import folder_paths  # ComfyUI

        return film.past(Path(folder_paths.get_output_directory()), latent_path or DEFAULT_CHAIN, segment)
    except Exception:  # noqa: BLE001 - no store, no past: the clip rolls its past as before
        return {}


def _announce(unique_id, segment: int, end: bool = False, seed: int | None = None, take: int = 0, roll: str = "") -> None:
    """Tell the node's app which reel segment runs (or that the reel is over), so Generate can show it; a template
    without scenes runs as segment -1 (#211), with its seed and take, so its result becomes a take under the prompt,
    and `roll`, the folder of the sweep or grid it is a run of, so a Roll's runs at one seed are one take (#320)."""
    if unique_id is None:
        return
    try:
        from server import PromptServer  # ComfyUI
    except ImportError:
        return
    PromptServer.instance.send_sync("orrery.segment", {"node": str(unique_id), "prompt_id": runs.current_prompt(),
                                                       "segment": segment, "end": end, "seed": seed, "take": take,
                                                       "roll": roll})


def state_token(home: Home) -> str:
    """Changes whenever a library, a preset or the learned weights change, so ComfyUI re-runs the node."""
    digest = hashlib.sha256()
    presets = sorted(home.presets_dir.rglob("*.orr")) if home.presets_dir.exists() else []  # @include
    for f in [*library_files(home.library_dir).values(), home.weights_path, *presets]:
        if f.exists():
            digest.update(f.as_posix().encode() + f.read_bytes())
    return digest.hexdigest()[:16]


def sweep_formula(source: str, grid: list) -> str:
    """How a template's runs come about: the LoRA sweep's formula, the grid's, or both multiplied."""
    parts = [f"({f})" if "+" in (f := sweeps.formula(source)) and grid else f] if sweeps.runs(source) else []
    return " × ".join(parts + ([batches.formula(grid)] if grid else []))


def _galaxy_folder(name) -> str:
    """A sweep's galaxy folder, when it is a valid one."""
    from orrery.galaxy import clean_folder

    try:
        return clean_folder(name) if name else ""
    except (ValueError, TypeError):
        return ""


def log_outputs(home: Home, picks_json: str, media: list[str]) -> list[dict]:
    data = json.loads(picks_json)
    ts = datetime.now(UTC).isoformat(timespec="seconds")
    rows = [{
        "ts": ts,
        "media": m,
        "seed": data.get("seed"),
        "target": data.get("target"),
        "template": data.get("template"),
        "preset": data.get("preset"),
        "edited": bool(data.get("edited")),
        "params": data.get("params") or {},
        "text": data.get("text"),
        "picks": data.get("picks", []),
        **({"exports": data["exports"]} if data.get("exports") else {}),  # what EXPORT: kept beside the prompt
        **({"rng": data["rng"]} if data.get("rng") else {}),
        **({"format": data["format"]} if data.get("format") else {}),
        **({"segment": data["segment"], "chunks": data["chunks"]} if data.get("chunks") else {}),
        # the reel and the scene a clip belongs to: the Gallery's albums (#298)
        **({"chain": data["chain"]} if data.get("chunks") and data.get("chain") else {}),
        **({"chunk": data["chunk"]} if data.get("chunks") and isinstance(data.get("chunk"), int) else {}),
        **({"shoot": data["shoot"]} if data.get("shoot") and not data.get("chunks") else {}),  # its shoot's album (#321)
        **({"folder": folder} if (folder := _galaxy_folder(data.get("folder"))) else {}),
        "rating": None,
    } for m in (media or [None])]
    home.root.mkdir(parents=True, exist_ok=True)
    with STATE, home.galaxy_path.open("a", encoding="utf-8") as f:  # never while a rating rewrites the log (#260)
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    if uistate.load_ui(home)["picture_slots"] == "every run":  # its picture slots written now (#175)
        for note in write_pictures(home, [r for r in rows if r.get("media")]):
            print(f"[orrery] warn: {note}")
    return rows


def save_png(image, path: Path | str, picks_json: str) -> None:
    """Save one HxWxC float image (0..1) with the picks in a PNG text chunk."""
    import numpy as np
    from PIL import Image
    from PIL.PngImagePlugin import PngInfo

    pixels = (np.clip(np.asarray(image), 0.0, 1.0) * 255).round().astype(np.uint8)
    info = PngInfo()
    info.add_text("orrery", picks_json)
    Image.fromarray(pixels).save(path, pnginfo=info)


class OrreryPrompt:
    CATEGORY = "orrery"
    FUNCTION = "run"
    RETURN_TYPES = ("STRING", "STRING", "INT", "INT", "INT", "INT", "FLOAT", "MODEL")
    RETURN_NAMES = ("text", "picks", "seed", "width", "height", "length", "megapixels", "model")
    OUTPUT_TOOLTIPS = ("", "", "", "From `: w…` in the template, else the @h3 ratio, else 1024.",
                       "From `: h…` in the template, else the @h3 ratio, else 1024.",
                       ("Frames at 24 fps for the MiniMax H3 nodes' length input: the sum of the SHOT "
                        "durations (in a reel: the scene's, plus the pinned context from the second "
                        "clip on), snapped up to H3's 17k+5 grid (124 without SHOTs)."),
                       ("The canvas area: `0.6MP` from the @h3 line, else width × height, for resolution and "
                        "scale nodes that take megapixels."))
    DESCRIPTION = ("Expands an orrery template (text) or compiles a screenplay (h3-base, flat) "
                   "and outputs the picks that produced it.")

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "template": ("STRING", {"multiline": True, "default": DEFAULT_TEMPLATE,
                                        "pysssss.autocomplete": False}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xFFFFFFFF,
                                 "control_after_generate": True}),
                "target": (TARGETS,),
            },
            "optional": {
                "preset": ([NO_PRESET, *list_presets(resolve_home())],),
                "home": ("STRING", {"default": ""}),
                "params": ("STRING", {"default": "", "tooltip": "The dials: JSON {binding: expression}, "
                                                                "set in the Prompt tab."}),
                "segment": ("INT", {"default": 0, "min": 0, "max": 99999, "control_after_generate": True,
                                    "tooltip": "The reel's clip to write, counted from 0 here (0 is clip 1). With "
                                               "increment, every queued run plays the next clip, which Orrery "
                                               "Continue chains to the one before. Plain screenplays ignore it."}),
                "first_frame": ("IMAGE", {"tooltip": (
                    "Optional: the picture the clip starts on (wire it into the H3 node's first_frame too). Width and "
                    "height then take its shape at the header's megapixels, so H3 does not stretch it.")}),
                "last_frame": ("IMAGE", {"tooltip": (
                    "Optional: the picture the clip ends on (and the H3 node's last_frame). Without a first frame, width "
                    "and height take its shape, so H3 does not crop it.")}),
                "model": ("MODEL", {"tooltip": (
                    "Optional: the model, through orrery to the sampler (#209). The clip being sampled then plays in "
                    "orrery's clip box as it forms, in real time, decoded with the tiny VAE (taeh3 in models/vae_approx); "
                    "the gear's Live preview makes it light or smooth. "
                    "The model output is this model with that preview and the template's LORA: lines on it (#208), "
                    "so no LoRA node is needed; nothing loads again.")}),
                "video": ("VIDEO", {"tooltip": (
                    "Optional: a video of your own that the reel starts from (a Load Video). The template's head is "
                    "its scene: REMEMBER: there keeps its frames, END ON: there says how it ends, and a scene with "
                    "AFTER: the input video continues it.")}),
                "sweep": ("STRING", {"default": "", "tooltip": (
                    "Set by Roll for each run of a LoRA sweep (run|gallery folder); empty runs the first.")}),
                "take": ("INT", {"default": 0, "min": 0, "max": 0xFFFFFFFF, "tooltip": (
                    "Set by the app for sample surfing (#206): the seed output carries seed + take, so the sampler's "
                    "noise changes while the prompt rolls at the seed as before.")}),
                "chain": ("STRING", {"default": "", "tooltip": (
                    "Set by the app (#197): the folder under ComfyUI's output where this reel's clips live, "
                    "reels/<preset> or reels/untitled/<date time>; empty is h3_context. Orrery Film keeps them in "
                    "its orrery_film folder.")}),
                "shoot": ("STRING", {"default": "", "tooltip": (
                    "Set by the app (#321): the shoot a template's takes belong to, so the gallery keeps them "
                    "together; empty for a reel, whose clips have their chain.")}),
            },
            "hidden": {"unique_id": "UNIQUE_ID", "extra_pnginfo": "EXTRA_PNGINFO", "prompt": "PROMPT"},
        }

    @classmethod
    def IS_CHANGED(cls, template, seed, target, preset=NO_PRESET, home="", params="", segment=0,
                   sweep="", chain="", take=0, shoot="", **_):
        h = resolve_home(home or None)
        chosen = load_preset(h, preset) if preset and preset != NO_PRESET else template
        return f"{seed}:{target}:{hash(chosen)}:{hash(params)}:{segment}:{chain}:{take}:{sweep}:{shoot}:{state_token(h)}"

    def run(self, template, seed, target, preset=NO_PRESET, home="", params="", segment=0,
            sweep="", chain="", take=0, shoot="", unique_id=None, extra_pnginfo=None, prompt=None,
            first_frame=None, last_frame=None, video=None, model=None, clip=None):  # clip: an old workflow's, unused (#282)
        preview.forward_core_previews()  # ComfyUI's own preview reaches every tab, not just the one that queued
        chain = chain or DEFAULT_CHAIN  # the app names it after the reel; old workflows and the CLI keep h3_context
        stills = _previous(chain, segment)
        packed, wired, keep, standing = wiring(prompt, unique_id)
        try:
            outputs = run_prompt(template, seed, target, home, preset, linked_preset(extra_pnginfo, unique_id),
                                 params, segment, stills, packed, wired, chain, keep,
                                 sweep, continued(prompt, unique_id), (_size(first_frame), _size(last_frame)),
                                 reads_picks(prompt, unique_id, "OrreryRefMods"), standing,
                                 {"first_frame": first_frame, "last_frame": last_frame})
            data = json.loads(outputs[1])
            if take:  # sample surfing (#206): the rolls as at the seed, the sampler's noise from seed + take
                data["take"] = take
                outputs = (outputs[0], json.dumps(data, ensure_ascii=False), (seed + take) % 2**32, *outputs[3:])
            if shoot and "segments" not in data:  # a template's take, in its shoot: the gallery keeps them together (#321)
                data["shoot"] = shoot
                outputs = (outputs[0], json.dumps(data, ensure_ascii=False), *outputs[2:])
            h = resolve_home(home or None)
            history.record(h, data)
            if uistate.load_ui(h)["log_prompts"]:
                print("\n".join(history.log_lines(data)))
            if data.get("input"):
                _keep_input(video, chain)
            if "sends" in data and not packed:
                raise ValueError("This reel REMEMBERs frames as reference images, which Orrery Refs fetches: wire this "
                                 "node's picks into an Orrery Refs, and its ref outputs into Reference to Video.")
            if data.get("pictures") and not packed:
                raise ValueError("The CAST names pictures of the gallery (image NAME), which Orrery Refs loads: wire this "
                                 "node's picks into an Orrery Refs, and its ref outputs into Reference to Video.")
            if (prompt_id := runs.current_prompt()) and unique_id is not None:
                runs.remember(prompt_id, unique_id, outputs[1])  # for Generate: Save nodes log to the galaxy
            if "segments" in data:  # a reel
                _announce(unique_id, data["segment"], seed=seed, take=take)
            else:  # results under the prompt in every mode (#211)
                _announce(unique_id, -1, seed=seed, take=take, roll=data.get("folder", ""))
            stack, outputs = outputs[6], outputs[:6]  # the LORA: lines go on the model, not out (#208)
            if stack and model is not None:
                model = loras.apply(model, stack)
                when = lambda a, b: "" if (a, b) == (0, 1) else f", {a:.0%}–{b:.0%}"  # a timed LoRA's start and end (#227)
                print(f"[orrery] LoRAs on the model: {', '.join(f'{n} ({s:g}{when(a, b)})' for n, s, _, a, b in stack if s)}")
            elif stack:
                print("[orrery] warn: the LORA: lines go on the model that passes through this node; wire the model "
                      "loader into its model input and its model output on to the sampler, else they change nothing.")
            return (*outputs, data["megapixels"], preview.patched(model, unique_id, h) if model is not None else None)
        except ReelEnd as end:
            try:
                from comfy_execution.graph_utils import ExecutionBlocker  # ComfyUI
            except ImportError:
                raise end from None
            print(f"[orrery] {end} The reel is done, so nothing downstream runs.")
            _announce(unique_id, segment, end=True)
            return tuple(ExecutionBlocker(None) for _ in self.RETURN_TYPES)


class OrreryLog:
    CATEGORY = "orrery"
    FUNCTION = "log"
    OUTPUT_NODE = True
    RETURN_TYPES = ()
    DESCRIPTION = ("Saves images (PNG) or a video (MP4, e.g. from Create Video) with their picks "
                   "embedded and appends one line per output to galaxy.jsonl. For files saved by "
                   "another node, pass the path as media_path.")

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {"picks": ("STRING", {"forceInput": True})},
            "optional": {
                "images": ("IMAGE",),
                "video": ("VIDEO", {"tooltip": "A video (with its audio), e.g. from Create Video; "
                                              "saved as MP4 in place of Save Video."}),
                "filename_prefix": ("STRING", {"default": "orrery"}),
                "media_path": ("STRING", {"default": ""}),
                "home": ("STRING", {"default": ""}),
            },
        }

    def log(self, picks, images=None, video=None, filename_prefix="orrery", media_path="", home=""):
        media, ui = [], []
        if video is not None:
            import folder_paths  # ComfyUI

            folder, name, counter, subfolder, _ = folder_paths.get_save_image_path(
                filename_prefix, folder_paths.get_output_directory())
            file = f"{name}_{counter:05}_.mp4"
            video.save_to(os.path.join(folder, file), metadata={"orrery": json.loads(picks)})
            media.append(os.path.join(folder, file))
            log_outputs(resolve_home(home or None), picks, media)
            return {"ui": {"images": [{"filename": file, "subfolder": subfolder, "type": "output"}],
                           "animated": (True,)}}
        if images is not None:
            import folder_paths  # ComfyUI

            height, width = images[0].shape[0], images[0].shape[1]
            folder, name, counter, subfolder, _ = folder_paths.get_save_image_path(
                filename_prefix, folder_paths.get_output_directory(), width, height)
            for image in images:
                file = f"{name}_{counter:05}_.png"
                save_png(image.cpu().numpy(), os.path.join(folder, file), picks)
                media.append(os.path.join(folder, file))
                ui.append({"filename": file, "subfolder": subfolder, "type": "output"})
                counter += 1
        elif media_path:
            media.append(media_path)
        log_outputs(resolve_home(home or None), picks, media)
        return {"ui": {"images": ui}}


REF2VA = "MiniMaxH3ReferenceToVideo"
PREVIEW_HEIGHT = 512
LABEL_SIZE = 40


def preview_frames(labelled: list[tuple[str, object]]):
    """Every frame of each (label, IMAGE batch) as one float array for a Preview Image: scaled to one
    height, the label in white with a black edge in the corner, centred on neutral grey at the widest
    width. Without any, one grey frame that says so."""
    import numpy as np
    from PIL import Image, ImageDraw, ImageFont

    font = ImageFont.load_default(size=LABEL_SIZE)
    shots = []
    for label, batch in labelled or [("no refs", np.full((1, PREVIEW_HEIGHT, PREVIEW_HEIGHT, 3), 0.5, np.float32))]:
        array = batch.cpu().numpy() if hasattr(batch, "cpu") else np.asarray(batch)
        for frame in array:
            pic = Image.fromarray(np.clip(frame[..., :3] * 255.0 + 0.5, 0, 255).astype(np.uint8))
            pic = pic.resize((max(1, round(pic.width * PREVIEW_HEIGHT / pic.height)), PREVIEW_HEIGHT), Image.BILINEAR)
            ImageDraw.Draw(pic).text((14, 10), label, font=font, fill="white", stroke_width=4, stroke_fill="black")
            shots.append(np.asarray(pic, dtype=np.float32) / 255.0)
    widest = max(shot.shape[1] for shot in shots)
    out = np.full((len(shots), PREVIEW_HEIGHT, widest, 3), 0.5, dtype=np.float32)
    for i, shot in enumerate(shots):
        x = (widest - shot.shape[1]) // 2
        out[i, :, x:x + shot.shape[1]] = shot
    return out


def stack_preview(labelled: list[tuple[str, object]]):
    """preview_frames as an IMAGE batch. ComfyUI only (torch)."""
    import torch

    return torch.from_numpy(preview_frames(labelled))


def _made(result, packed: bool) -> dict[str, str]:
    """For the slots: the prompt that made each gallery picture of the clip, by its label in the compiled
    prompt (packed: in Orrery Refs' order)."""
    return {f"<Picture {result.refs.index(n) + 1 if packed else n}>": picture["prompt"]
            for n, picture in sorted(getattr(result, "pictures", {}).items())
            if picture.get("prompt") and (not packed or n in result.refs)}


def load_picture(path: str):
    """A picture file as an IMAGE batch of one. ComfyUI only (torch)."""
    import numpy as np
    from PIL import Image

    return to_image(np.asarray(Image.open(path).convert("RGB"), dtype=np.float32)[None] / 255.0)


def to_image(array):
    """A float array (frames, height, width, 3) as an IMAGE batch. ComfyUI only (torch)."""
    import torch

    return torch.from_numpy(array)


def reads_picks(prompt: dict | None, unique_id, class_type: str) -> bool:
    """Whether a node of `class_type` reads this node's picks; True without a graph (the CLI, tests)."""
    if not prompt or unique_id is None:
        return True
    return any(n.get("class_type") == class_type and n.get("inputs", {}).get("picks") == [str(unique_id), 1]
               for n in prompt.values())


def continued(prompt: dict | None, unique_id) -> bool:
    """Whether an Orrery Continue reads this node's picks (then orrery continues the reel itself)."""
    if not prompt or unique_id is None:
        return False
    return any(n.get("class_type") == "OrreryContinue" and n.get("inputs", {}).get("picks") == [str(unique_id), 1]
               for n in prompt.values())


def wiring(prompt: dict | None, unique_id) -> tuple[bool, int | None, bool, frozenset[int]]:
    """What the node's graph says (R2): whether an Orrery Refs reads its picks (then the images are
    packed per clip), how many reference images the Reference to Video node its text reaches
    (directly or through a few text nodes) has wired (None when there is none), whether that
    Orrery Refs has keep_sent on, and which of its image_N have a picture wired in."""
    if not prompt or unique_id is None:
        return False, None, False, frozenset()
    uid = str(unique_id)
    link = lambda v: (str(v[0]), v[1]) if isinstance(v, list) and len(v) == 2 else None
    readers = [n for n in prompt.values()
               if n.get("class_type") == "OrreryRefs" and link(n.get("inputs", {}).get("picks")) == (uid, 1)]
    packed, keep = bool(readers), any(n.get("inputs", {}).get("keep_sent") is True for n in readers)
    standing = frozenset(int(k.removeprefix("image_")) for n in readers for k, v in n.get("inputs", {}).items()
                         if k.startswith("image_") and k.removeprefix("image_").isdigit() and link(v))
    reach = {(uid, 0)}
    for _ in range(3):  # through Text Concatenate and friends
        reach |= {(str(nid), i) for nid, n in prompt.items() if n.get("class_type") != REF2VA
                  for v in n.get("inputs", {}).values() if link(v) in reach for i in range(4)}
    wired = [sum(1 for k, v in n["inputs"].items() if "ref_image" in k and link(v))
             for n in prompt.values() if n.get("class_type") == REF2VA and link(n.get("inputs", {}).get("prompt")) in reach]
    return packed, (max(wired) if wired else None), keep, standing


class OrreryRefs:
    """Hands Reference to Video only the reference images the current clip's CAST uses, packed in
    order, so a reel's chunks don't all see every image. Orrery Prompt notices it and renumbers
    <Picture N> to match. Images a SEND: line fills come from the sending clip in the chain, and are
    kept as that image's anchor; with keep_sent on they come from the anchor instead."""

    CATEGORY = "orrery"
    FUNCTION = "route"
    SLOTS = 9
    RETURN_TYPES = ("IMAGE",) * (SLOTS + 1)
    RETURN_NAMES = (*(f"ref_{i}" for i in range(1, SLOTS + 1)), "preview")
    OUTPUT_TOOLTIPS = ("Wire ref_1 into Reference to Video ref_image_0, ref_2 into ref_image_1, and so on.",
                       *("",) * (SLOTS - 1),
                       ("Every image this clip gets, labelled with its ref, as one batch for a Preview Image (grey when "
                        "there is none). Preview here, not on the ref_N that go into Reference to Video: an empty one "
                        "is None there."))
    DESCRIPTION = ("Routes the reference images per reel clip: wire every image as image_N (N as in the CAST's "
                   "(image N)) and the Orrery Prompt's picks; the clip's images come out packed as ref_1, ref_2 …, "
                   "and all of them together on preview, for a Preview Image.")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"picks": ("STRING", {"forceInput": True})},
                "optional": {**{f"image_{i}": ("IMAGE",) for i in range(1, cls.SLOTS + 1)},
                             "keep_sent": ("BOOLEAN", {"default": False, "tooltip": (
                                 "On: every remembered image with a stored anchor (the frames last fetched for it) uses "
                                 "that anchor from clip 1 and for the whole run, so a character you liked stays. "
                                 "Off: fresh frames from this run's chain, which replace the anchors.")})},
                "hidden": {"prompt": "PROMPT", "unique_id": "UNIQUE_ID"}}

    @classmethod
    def IS_CHANGED(cls, **_):
        """Always run: the chain behind a SEND: changes while the picks stay the same (a reel rendered again
        from Restart), and a cached output would hand on an older run's frames."""
        return float("NaN")

    def route(self, picks, prompt=None, unique_id=None, keep_sent=False, **images):
        data = json.loads(picks or "{}")
        refs, sends, named = data.get("refs"), data.get("sends") or {}, data.get("pictures") or {}
        for n in sorted(int(k) for k in named if images.get(f"image_{k}") is not None):
            print(f"[orrery] warn: image {n} is wired into Orrery Refs and named in the CAST too: the gallery picture "
                  f"{Path(named[str(n)]).name} replaces the wired one.")
        for k, path in named.items():
            if not Path(path).is_file():
                raise ValueError(f"The CAST names the gallery picture {path}, but the file is gone.")
            images[f"image_{k}"] = load_picture(path)
        for n in sorted(n for n in sends.get("slots", []) if images.get(f"image_{n}") is not None):
            sent = sends.get("ready", {}).get(str(n), {})
            print(f"[orrery] warn: image {n} is wired into Orrery Refs and kept by a REMEMBER: (SEND:) line too: "
                  + (f"the frames from clip {sent['segment'] + 1} replace the wired picture." if "segment" in sent
                     else "the wired picture until those frames exist."))
        if refs is None:  # nothing packed: pass the images through as wired
            order = [images.get(f"image_{i}") for i in range(1, self.SLOTS + 1)]
        else:
            ready = sends.get("ready", {})
            home = Home(Path(sends["home"])) if sends.get("home") else resolve_home(None)
            for n in refs:
                if str(n) not in ready:
                    continue
                if ready[str(n)].get("held"):
                    held = anchors.load(home, n)
                    if held is None:
                        raise ValueError(f"image {n} is held (keep_sent), but it has no stored anchor: switch keep_sent "
                                         "off for a run that sends it, then on again.")
                    images[f"image_{n}"] = to_image(held)
                else:
                    images[f"image_{n}"] = self._sent(n, ready[str(n)], sends.get("chain") or DEFAULT_CHAIN)
                    anchors.save(home, n, images[f"image_{n}"])
            missing = [f"image_{n}" for n in refs if images.get(f"image_{n}") is None]
            if missing:
                raise ValueError(f"This clip's CAST uses {', '.join(missing)}, but nothing is wired into it.")
            order = [images[f"image_{n}"] for n in refs]
            self._warn_batches(order, prompt, unique_id)
        out = order[:self.SLOTS] + [None] * (self.SLOTS - len(order))
        try:
            preview = stack_preview([(f"ref_{k + 1}", img) for k, img in enumerate(out) if img is not None])
        except ImportError:  # outside ComfyUI
            preview = None
        return (*(self._blocked(v, self._readers(prompt, unique_id, k)) for k, v in enumerate(out)),
                self._blocked(preview, self._readers(prompt, unique_id, self.SLOTS)))

    @staticmethod
    def _readers(prompt, unique_id, k: int) -> list[str]:
        """The class types of the nodes that read output k, from the graph."""
        if not prompt or unique_id is None:
            return []
        link = lambda v: (str(v[0]), v[1]) if isinstance(v, list) and len(v) == 2 else None
        return [n.get("class_type") for n in prompt.values()
                if (str(unique_id), k) in {link(v) for v in n.get("inputs", {}).values()}]

    @staticmethod
    def _blocked(value, readers: list[str]):
        """An empty ref that only nodes other than Reference to Video read (a preview, say) is blocked, so
        they skip this clip instead of failing on None; Reference to Video itself skips None."""
        if value is not None or not readers or REF2VA in readers:
            return value
        try:
            from comfy_execution.graph_utils import ExecutionBlocker  # ComfyUI
        except ImportError:
            return None
        return ExecutionBlocker(None)

    @staticmethod
    def _sent(n: int, send: dict, latent_path: str):
        """The frames a SEND: line names, from the sending segment's clip in the chain."""
        import folder_paths  # ComfyUI

        from orrery import chain

        segment = send["segment"]
        path = chain.clip_file(Path(folder_paths.get_output_directory()), latent_path, segment)
        if path is None and segment == -1:
            raise ValueError(f"image {n} is remembered from the input video, but the chain {latent_path!r} holds "
                             "none: wire a Load Video into the Orrery Prompt's video input.")
        if path is None:
            raise ValueError(f"image {n} is sent from clip {segment + 1}, but the chain {latent_path!r} has no clip "
                             f"{segment + 1}: render the reel from that scene on.")
        batch, dropped = chain.frames(path, send["frames"], send.get("step", 1))
        if dropped:
            many = len(dropped) > 1
            print(f"[orrery] REMEMBER as image {n}: frame{'s' if many else ''} {', '.join(map(str, dropped))} "
                  f"{'are' if many else 'is'} not in clip {segment + 1}, so "
                  f"{'they are' if many else 'it is'} left out.")
        return batch

    @classmethod
    def _warn_batches(cls, order: list, prompt, unique_id) -> None:
        """Reference to Video reads the first image of each reference only: say so when a batch goes there."""
        for k, img in enumerate(order):
            if img is None or getattr(img, "shape", (1,))[0] < 2:
                continue
            if REF2VA in cls._readers(prompt, unique_id, k):
                print(f"[orrery] ref_{k + 1} carries {img.shape[0]} frames, but Reference to Video reads only the first "
                      "image of a reference; send several stills to several images for @h3 references.")


NODE_CLASS_MAPPINGS = {"OrreryPrompt": OrreryPrompt, "OrreryLog": OrreryLog, "OrreryRefs": OrreryRefs,
                       "OrreryContinue": OrreryContinue, "OrreryFilm": OrreryFilm, "OrreryWrite": OrreryWrite,
                       "OrreryRefMods": OrreryRefMods, "OrreryAsk": OrreryAsk}
NODE_DISPLAY_NAME_MAPPINGS = {"OrreryPrompt": "Orrery Prompt", "OrreryLog": "Orrery Log", "OrreryRefs": "Orrery Refs",
                              "OrreryContinue": "Orrery Continue", "OrreryFilm": "Orrery Film",
                              "OrreryWrite": "Orrery Write", "OrreryRefMods": "Orrery RefMods", "OrreryAsk": "Orrery Ask"}
