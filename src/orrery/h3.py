"""MiniMax H3 as a compiler target: screenplay in, contract out.

A screenplay-shaped template expands (seeded, recording picks) into a scene
model; writers serialize the scene. The `h3-base` writer computes every
mechanical rule of the official guide (VIDEO_PROMPT_WRITING_GUIDE_base_en.md):
alignment lines, shot timestamps, speaker IDs, `<d>` tags, camera sentences,
soundscape and `N/A` rules. Randomness only ever fills slots.

    @h3 text 16:9
    style: live-action, cinematic
    SHOT 5s: push in, small, slow
    A misty forest at dawn.
    NARRATOR (calm voice, off-screen): The forest remembers.
    SFX: branches creak under frost; soft footfalls on snow
    SHOT 3s: cut, static
    A close-up of glowing eyes.
    MUSIC: sparse cello at a slow tempo, fading out

Speaker names are role nouns (WOMAN, NARRATOR, BAKER): the guide identifies
speakers by description, so they render as "The woman … (S1)".
"""

import re
from collections.abc import Mapping
from dataclasses import dataclass, field, replace

from orrery import knobs
from orrery.cast import (
    MAX_SLOTS,
    MEMBER,
    Labels,
    Member,
    Names,
    article,
    attach,
    bare,
    bracket_sources,
    oxford,
    parse_member,
)
from orrery.dsl import Expander, Pick, strip_comments
from orrery.library import Library

CAMERA = {
    "push in": "pushes in", "pull out": "pulls out", "zoom in": "zooms in", "zoom out": "zooms out",
    "pan left": "pans left", "pan right": "pans right",
    "truck left": "trucks left", "truck right": "trucks right",
    "tilt up": "tilts up", "tilt down": "tilts down",
    "pedestal up": "pedestals up", "pedestal down": "pedestals down",
    "arc": "arcs around the subject", "tracking": "tracks the moving subject",
    "static": "holds a static shot",
    "shake slightly": "shakes slightly", "shake strongly": "shakes strongly",
    "pov": "shows the subject's point of view",
    "roll clockwise": "rolls clockwise", "roll counterclockwise": "rolls counterclockwise",
}
TRANSITIONS = {
    "cut": "the camera cuts to",
    "dissolve": "the shot transitions with a cross-dissolve to",
    "fade": "the shot fades to",
    "wipe": "the shot wipes to",
}
MODES = ("t2va", "i2va", "fl2va", "l2va", "ref2va")
MODE_WORDS = {"text": "t2va", "image": "i2va", "first-last": "fl2va", "last": "l2va", "references": "ref2va"}
WORD = {mode: word for word, mode in MODE_WORDS.items()}  # `@h3 references` for ref2va, MiniMax's own name
MOOD_WORDS = re.compile(
    r"\b(sad|happy|epic|emotional|melancholic|melancholy|uplifting|tense|dramatic|romantic|"
    r"hopeful|joyful|nostalgic|heartwarming|mournful|moody)\b", re.IGNORECASE)

_HEADER = re.compile(r"^@h3\s+([\w-]+)(.*)$", re.IGNORECASE)
_RATIO = re.compile(r"^\d+(?:\.\d+)?:\d+(?:\.\d+)?$")
_STYLE = re.compile(r"^style:\s*(.+)$", re.IGNORECASE)
_SUMMARY = re.compile(r"^summary:\s*(.+)$", re.IGNORECASE)
_ATTRIBUTE = re.compile(r"^(voice|keep):\s*(.+)$")
_ANCHOR = re.compile(r"\b(from|to)\s+image\s+(\d+)(?:\s*\(([^)]*)\))?|\b(after)\s+video\s+(\d+)", re.IGNORECASE)
_SHOT = re.compile(r"^SHOT\s+(\d+(?:\.\d+)?)\s*s\b\s*(?:[:|]\s*(.*))?$", re.IGNORECASE)  # `|`: the older spelling
_MUSIC = re.compile(r"^MUSIC:\s*(.+)$", re.IGNORECASE)
_SFX = re.compile(r"^SFX:\s*(.+)$", re.IGNORECASE)
_VOICE = re.compile(r"^([A-Z][A-Z0-9 _-]*?)\s*(?:\(([^)]*)\))?\s*:\s*(.+)$")
_BINDING = re.compile(r"^\$([A-Za-z_]\w*)\s*=\s*(.+)$")
_HANDOFF = re.compile(r"^(?:END ON|HANDOFF):\s*(.+)$")
_SEND_LINE = re.compile(r"^(?:REMEMBER|SEND):")
_AFTER = re.compile(r"^AFTER:")
_START_WITH = re.compile(r"^START WITH:")
_LORA = re.compile(r"^LORA:\s*(.+)$")
_CONTEXT = re.compile(r"^context:\s*(\d+)\s*f?$", re.IGNORECASE)
_REFMODS = re.compile(r"^refmods:\s*(?:at\s+(\d*\.?\d+))?\s*(?:from\s+(\d+(?:\.\d+)?)\s*%)?\s*(?:to\s+(\d+(?:\.\d+)?)\s*%)?\s*$",
                      re.IGNORECASE)
REFMOD_START = 0.0  # RefMods start with the first step: a character's identity is laid out early, too
_SET = re.compile(r"^SET:\s*(.*)$")
_SET_ITEM = re.compile(r"([^,()]+?)\s*\(([^()]*)\)")  # name(strength, start)
_SET_IMAGE = re.compile(r"^image[\s_]*(\d+)$", re.IGNORECASE)
_DSL_ONLY = re.compile(r"^(:\s*(x\d|seed=|w\d|h\d|grid\b|unique=)|@(grid|unique|size|seed|batch|rng)\b)")  # params lines of plain templates
_ENHANCE = re.compile(r"^>\s*(.+)$")
H3_FPS = 24
DEFAULT_CONTEXT = 22  # H3 Motion Context's default context_length, in frames
IMPLICIT_SECONDS = 5.0  # a template without SHOT lines is one shot of H3's default length
_LANG = re.compile(r"^\[([A-Za-z ]+)\]\s*(.*)$")
_CLIP_WEIGHT = re.compile(r"\([^()]*:\s*\d+(?:\.\d+)?\)")
_FIRST_SENTENCE = re.compile(r"^(.*?[.!?])(?:\s+|$)(.*)$", re.DOTALL)


@dataclass(frozen=True)
class Issue:
    severity: str  # "error" | "warn"
    message: str


@dataclass
class Voice:
    name: str
    mods: str
    text: str


@dataclass
class Shot:
    duration: float
    transition: str = "cut"
    camera: str = ""
    items: list = field(default_factory=list)  # str (prose) | Voice
    sfx: list[list[str]] = field(default_factory=list)
    start: float = 0.0
    first_frame: tuple[int, str] | None = None  # ref2va: (image slot, what it shows)
    last_frame: tuple[int, str] | None = None
    continues: int | None = None  # ref2va: the video slot this shot continues (`after video N`)
    enhance: str = ""  # a `> instruction` inside the shot: the language model rewrites its prose


@dataclass
class Scene:
    mode: str = "t2va"
    ratio: str = ""
    style: str = ""
    shots: list[Shot] = field(default_factory=list)
    music: str | None = None
    silence: bool = False
    cast: list[Member] = field(default_factory=list)
    summary: str = ""
    lite: bool = True  # <Subject N> = … definitions over the base fields; `full` in the header: MiniMax's full format
    loras: list[str] = field(default_factory=list)
    context: int | None = None  # frames Motion Context pins at the start of every reel segment after the first
    refmod_strength: float = 1.0  # `refmods: at 0.8 from 35%`: what a RefMod without its own `at`/`from` gets
    refmod_start: float = REFMOD_START
    refmod_end: float = 1.0  # `refmods: … to 80%`: where a RefMod without its own `to` stops
    dials: dict = field(default_factory=dict)  # `SET: image_1(0.5, 35%)`: ("image", 1) or ("refmod", name) → {"strength", "from"}
    sets: list = field(default_factory=list)  # the SET: items in order, (target, strength, start, end, words, kind, spec): see _apply_sets
    enhance: str = ""  # a `> instruction` before the first shot: for every shot without its own

    @property
    def duration(self) -> float:
        return round(sum(s.duration for s in self.shots), 6)


@dataclass
class Compiled:
    text: str
    picks: list[Pick]
    lint: list[Issue]
    scene: Scene
    loras: str = ""
    chunks: int = 0  # a reel's number of CHUNKs; 0 for a plain screenplay
    segment: int = 0
    segments: int | None = 0  # a reel's clips, counting repeats; None when a CHUNK repeats forever
    refs: list[int] = field(default_factory=list)  # packed: the original image slots, in their new order (sent ones the prompt does not name last)
    sends: dict[int, dict] = field(default_factory=dict)  # sent images that exist in this segment (Reel.ready)
    send_slots: list[int] = field(default_factory=list)  # every image a SEND: line of the reel fills
    refmods: list[dict] = field(default_factory=list)  # the RefMods this clip gets (clip_refmods), for Orrery RefMods
    images: list[dict] = field(default_factory=list)  # the clip's pictures with an at or a from (clip_images)
    continues: int | None = None  # the segment whose picture this clip continues (Reel.before); None: afresh
    test: bool = False  # a test scene's clip: Orrery Film leaves it out of the film
    uses_input: bool = False  # the reel reads the Orrery Prompt's input video (Reel.uses_input)
    pictures: dict[int, dict] = field(default_factory=dict)  # image slot → {file, prompt} a CAST names (name_pictures)
    chunk: int | None = None  # a reel's scene this clip plays (its index), for the take tree (#240)
    kept: dict | None = None  # what a reel clip's take keeps (#261): its bindings and its END ON:


# --- front end ------------------------------------------------------------------------------

def parse_scene(src: str, ex: Expander, lint: list[Issue], expanded: bool = False) -> Scene:
    """`expanded`: the lines are already expanded and their bindings bound (reels do that)."""
    lines = [raw.strip() for raw in src.splitlines()]
    if not expanded:
        for line in lines:
            if m := _BINDING.match(line):
                ex.bind(m.group(1), m.group(2))
    scene, cur, in_cast = Scene(), None, False
    block, last = 0, None  # the CAST block being read, and its last member (for voice: and keep:)
    loose: list[str] = []  # prose before any SHOT: the implicit shot, or ignored
    loose_sfx: list[list[str]] = []
    for raw in lines:
        if not raw or _BINDING.match(raw) or _DSL_ONLY.match(raw):
            continue
        line = _IMAGE_ANGLE.sub(r"[image \1]", raw if expanded else ex.expr(raw))  # <Image N>, as H3 users write it (#224)
        if not line.strip():  # a `? cond:` line that does not hold
            continue
        if m := _ENHANCE.match(line):
            if cur is None:
                scene.enhance = m.group(1).strip()
            else:
                cur.enhance = m.group(1).strip()
        elif m := _HEADER.match(line):
            scene.mode = MODE_WORDS.get(m.group(1).lower(), m.group(1).lower())
            for token in m.group(2).split():
                if token.lower() in ("lite", "full"):
                    scene.lite = token.lower() == "lite"
                elif _RATIO.match(token):
                    scene.ratio = token
        elif m := _STYLE.match(line):
            scene.style = m.group(1).strip()
        elif m := _SUMMARY.match(line):
            scene.summary = m.group(1).strip()
        elif m := _LORA.match(line):  # its LoRAs; a RefMod's, an image's or a member's long form is a SET item (#227)
            others = [k.group(0) for k in knobs.LONG.finditer(m.group(1)) if k.group(1).lower() != "lora"]
            loras = knobs.LONG.sub(lambda k: k.group(0) if k.group(1).lower() == "lora" else "", m.group(1)).strip()
            if loras:
                scene.loras.append(loras)
            if others:
                _set_line(scene, ", ".join(others), lint)
        elif _HANDOFF.match(line):
            lint.append(Issue("warn", "END ON: only works inside a SCENE; it is ignored."))
        elif _AFTER.match(line):
            lint.append(Issue("warn", "AFTER: only works inside a SCENE of a reel; it is ignored."))
        elif _START_WITH.match(line):
            lint.append(Issue("warn", "START WITH: only works inside a SCENE of a reel; it is ignored."))
        elif _SEND_LINE.match(line):
            raise ValueError("REMEMBER: (SEND:) belongs inside a SCENE: it keeps frames of that scene's clip for the "
                             "clips after it.")
        elif m := _CONTEXT.match(line):
            scene.context = int(m.group(1))
        elif m := _SET.match(line):
            _set_line(scene, m.group(1), lint)
        elif m := _REFMODS.match(line):
            if m.group(1):
                scene.refmod_strength = float(m.group(1))
            if m.group(2):
                scene.refmod_start = min(1.0, float(m.group(2)) / 100)
            if m.group(3):
                scene.refmod_end = min(1.0, float(m.group(3)) / 100)
        elif (m := _MUSIC.match(line)) and cur is None and in_cast:
            scene.music = m.group(1).strip()
        elif line == "CAST" and cur is None:
            in_cast, block = True, block + 1
        elif in_cast and cur is None and not _SHOT.match(line):
            last = _cast_line(scene, line, lint, block, last)
        elif m := _SHOT.match(line):
            spec, anchors = _anchors(m.group(2) or "")
            transition, head = "cut", spec.split(",")[0].strip().lower()
            if head in TRANSITIONS:
                transition, spec = head, ",".join(spec.split(",")[1:]).strip()
            cur = Shot(float(m.group(1)), transition, spec, first_frame=anchors.get("from"),
                       last_frame=anchors.get("to"), continues=anchors["after"][0] if "after" in anchors else None)
            scene.shots.append(cur)
        elif m := _MUSIC.match(line):
            scene.music = m.group(1).strip()
        elif m := _SFX.match(line):
            body = m.group(1).strip()
            if body.lower() == "silence":
                scene.silence = True
            else:
                (cur.sfx if cur else loose_sfx).append([x.strip() for x in body.split(";") if x.strip()])
        elif cur is None:
            loose.append(line)
        elif m := _VOICE.match(line):
            cur.items.append(Voice(m.group(1).strip(), m.group(2) or "", m.group(3).strip()))
        else:
            cur.items.append(line)
    if not scene.shots and loose:
        implicit = Shot(IMPLICIT_SECONDS, sfx=loose_sfx)
        for line in loose:
            m = _VOICE.match(line)
            implicit.items.append(Voice(m.group(1).strip(), m.group(2) or "", m.group(3).strip()) if m else line)
        scene.shots.append(implicit)
    else:
        lint.extend(Issue("warn", f"Ignored text before the first SHOT: {line[:48]}") for line in loose)
        if loose_sfx:
            lint.append(Issue("warn", "SFX before the first SHOT is ignored."))
    t = 0.0
    for shot in scene.shots:
        shot.start, t = t, t + shot.duration
    _apply_sets(scene, lint)
    # SET: dials any image the clip hands to H3, CAST or not, and brings in a RefMod no member has (#224)
    pictures = {s.name or s.index for m in scene.cast for s in m.sources if s.kind == "image"} | set(image_slots(scene))
    for kind, target in scene.dials:
        if kind == "image" and target not in pictures:
            lint.append(Issue("warn", f"SET: image_{target}: the clip hands no image {target} to H3 (a CAST source, a frame "
                                      f"anchor, or [image {target}] or <Image {target}> in its text), so it changes nothing."))
    return scene


def _refmod_key(name: str) -> str:
    return name.removesuffix("_Video")


def _share(text: str) -> float | None:
    """A start as written: `35%`, `0.35`, or `35` (more than 1: a percentage)."""
    text = text.strip()
    if not text:
        return None
    value = float(text.rstrip("%").strip())
    return min(1.0, value / 100 if text.endswith("%") or value > 1 else value)


def _set_line(scene: Scene, text: str, lint: list[Issue]) -> None:
    """`SET: image_1(0.5, 35%), emma_canon(0.3), @JINX(0.6, refmods), refmods(1, 35%), turbo(0.8, 0%, 50%)`: the
    dials of a picture, a RefMod, a member's references (all, or those its words choose), the RefMod defaults
    and a LoRA (#227), for every clip in the head, for that clip in a chunk. A long form names its kind
    (`<lora:…>`, `<refmod:…>`, `<image:N:…>`, `<cast:NAME:…>`); a short one is told by its name once the CAST is
    read (_apply_sets): a later SET wins, and SET wins over the CAST."""
    long = list(knobs.LONG.finditer(text))
    items = [(k.group(2).strip() if k.group(1).lower() != "image" else f"image_{k.group(2).strip()}", k.group(3) or "",
              k.group(1).lower()) for k in long if k.group(1).lower() != "lora"]
    loras = [k.group(0) for k in long if k.group(1).lower() == "lora"]
    scene.loras += loras
    text = knobs.LONG.sub("", text)
    items += [(target, args, None) for target, args in _SET_ITEM.findall(text)]
    rest = _SET_ITEM.sub("", text).replace(",", "").strip()
    if not (items or loras) or rest:
        lint.append(Issue("warn", f"SET: {text[:48]} is not name(strength, start), e.g. SET: image_1(0.5, 35%) or "
                                  "SET: emma_canon(0.3); it is left out."))
        return
    for target, args, kind in items:
        # a sweep's field (#227) not run by Roll (the Test tab, ComfyUI's own Run) takes its first value
        values = [knobs.options(v)[0].strip() if knobs.sweeps(v) else v.strip() for v in args.split(",")]
        words = [v for v in values if v[:1].isalpha()]  # `refmods`, `image 1`: which of a member's references
        numbers = [v for v in values if not v[:1].isalpha()]
        try:
            strength = float(numbers[0]) if numbers and numbers[0] else None
            start = _share(numbers[1]) if len(numbers) > 1 else None
            end = _share(numbers[2]) if len(numbers) > 2 else None
        except ValueError:
            lint.append(Issue("warn", f"SET: {target.strip()}({args}) takes numbers: (strength), (strength, start) or "
                                      "(strength, start, end)."))
            continue
        scene.sets.append((target.strip(), strength, start, end, words, kind, args.strip()))


_CHOICE = re.compile(r"^(images?|refmods?)$|^image\s+(\d+)$|^refmod\s+([\w./-]+)$", re.IGNORECASE)


def _apply_sets(scene: Scene, lint: list[Issue]) -> None:
    """The SET: items as dials, in the order written, now that the CAST is known: a member's name turns
    all its pictures and RefMods, or the ones its words choose (`images`, `refmods`, `image 1`, `refmod
    NAME`); `refmods` alone sets the RefMod defaults, as a `refmods:` line does."""
    for target, strength, start, end, words, kind, spec in scene.sets:
        member = next((m for m in scene.cast if m.name == target), None) if kind in (None, "cast") else None
        if kind == "cast" and member is None:
            lint.append(Issue("warn", f"SET: <cast:{target}:…>: no member {target} in the CAST, so it changes nothing."))
            continue
        if kind is None and member is None and not _SET_IMAGE.match(target) and target.lower() != "refmods":
            found = knobs.kind_of(target)  # a LoRA's name, or a RefMod's (#227)
            if found == "lora":
                scene.loras.append(f"<lora:{target}:{spec}>")
                continue
            if found == "both":
                lint.append(Issue("warn", f"SET: {target}(…) names a LoRA and a RefMod: write <lora:{target}:…> or "
                                          f"<refmod:{target}:…>. It is left out."))
                continue
        if member is None and target.lower() == "refmods" and not words:
            for name, value in (("refmod_strength", strength), ("refmod_start", start), ("refmod_end", end)):
                if value is not None:
                    setattr(scene, name, value)
            continue
        if member is not None:
            keys = _chosen(member, words, lint)
        elif words:
            lint.append(Issue("warn", f"SET: {target}({', '.join(words)}) takes numbers: (strength), (strength, start) "
                                      "or (strength, start, end). Words choose among a member's references, as in "
                                      "SET: @JINX(0.6, refmods), and it is not in the CAST."))
            continue
        else:
            image = _SET_IMAGE.match(target)
            keys = [("image", int(image.group(1))) if image else ("refmod", _refmod_key(target))]
        for key in keys:
            dial = scene.dials.setdefault(key, {})
            for name, value in (("strength", strength), ("from", start), ("to", end)):
                if value is not None:
                    dial[name] = value


def _chosen(member: Member, words: list[str], lint: list[Issue]) -> list[tuple]:
    """The dial keys of the member's pictures and RefMods its words choose; all of them without words."""
    own = [("image", s.name or s.index) if s.kind == "image" else ("refmod", _refmod_key(s.name))
           for s in member.sources if s.kind in ("image", "refmod")]  # a named picture's dials move to its slots later
    if not words:
        return own
    out = []
    for word in words:
        m = _CHOICE.match(" ".join(word.split()))
        if not m:
            found = []
        elif m.group(1):  # images, refmods: every one of that kind
            found = [k for k in own if k[0] == m.group(1).lower().rstrip("s")]
        elif m.group(2):
            found = [k for k in own if k == ("image", int(m.group(2)))]
        else:
            found = [k for k in own if k == ("refmod", _refmod_key(m.group(3)))]
        if not found:
            has = ", ".join(f"image {n}" if kind == "image" else f"refmod {n}" for kind, n in own) or "no picture or RefMod"
            lint.append(Issue("warn", f"SET: {member.name}({word}): {member.name} has no {word} ({has}), so it "
                                      "changes nothing there."))
        out += [k for k in found if k not in out]
    return out


def _cast_line(scene: Scene, line: str, lint: list[Issue], block: int = 0, last: Member | None = None) -> Member | None:
    """One line of a CAST block; returns the member a following voice: or keep: line belongs to. A
    member a later block declares again (a chunk's own CAST) replaces the earlier one in its place,
    so its <Subject N> keeps its number."""
    if (m := _ATTRIBUTE.match(line)) and last is not None:
        attach(last, m.group(1), m.group(2))
        return last
    if m := MEMBER.match(line):
        member = parse_member(m.group(1), m.group(2), m.group(3).rstrip("."))
        member.block = block
        at = next((i for i, c in enumerate(scene.cast) if c.name == member.name), None)
        if at is None:
            scene.cast.append(member)
        elif scene.cast[at].block == block:
            lint.append(Issue("warn", f"{member.name} is in the CAST twice; the first one counts."))
            return last
        else:
            scene.cast[at] = member
        return member
    lint.append(Issue("warn", f"Ignored CAST line (write NAME (sources): description): {line[:48]}"))
    return last


def _clause(text: str) -> str:
    """A handoff as the end of "The shot ends as …": lower-case unless it opens with a NAME."""
    text = text.strip().rstrip(".")
    return text if re.match(r"[A-Z][A-Z0-9_-]+\b", text) else _low(text)


def _anchors(spec: str) -> tuple[str, dict[str, tuple[int, str]]]:
    found = {(m.group(1) or m.group(4)).lower(): (int(m.group(2) or m.group(5)), (m.group(3) or "").strip())
             for m in _ANCHOR.finditer(spec)}
    rest = ", ".join(p.strip() for p in _ANCHOR.sub("", spec).split(",") if p.strip())
    return rest, found


# --- helpers --------------------------------------------------------------------------------

def _cap(s: str) -> str:
    return s[:1].upper() + s[1:]


def _low(s: str) -> str:
    return s[:1].lower() + s[1:]


def _end(s: str) -> str:
    s = s.strip()
    return s if s[-1:] in ".!?" else s + "."


def _sentence_case(s: str) -> str:
    return _cap(re.sub(r"([.!?]\s+)([a-z])", lambda m: m.group(1) + m.group(2).upper(), s))


def timestamp(t: float) -> str:
    minutes = int(t // 60)
    return f"{minutes:02d}:{t - minutes * 60:06.3f}"


def camera_sentence(spec: str, shot_no: int, lint: list[Issue]) -> str:
    parts = [p.strip().lower() for p in spec.split(",") if p.strip()]
    if not parts:
        return ""
    motion, mods = parts[0], parts[1:]
    if motion not in CAMERA:
        lint.append(Issue("warn", f"Shot {shot_no}: \"{motion}\" is not in the guide's camera vocabulary "
                                  f"({', '.join(CAMERA)}); it goes in as written."))
        return f"Camera movement: {spec.strip()}."
    if motion == "static":
        return "The camera holds a static shot."
    amplitude = speed = ""
    for mod in mods:
        if mod in ("small", "large"):
            amplitude = f" with {mod} amplitude"
        elif mod in ("slow", "fast"):
            speed = f" at {mod} speed"
        else:
            lint.append(Issue("warn", f"Shot {shot_no}: camera modifier \"{mod}\" is not in the "
                                      "guide (small/large, slow/fast)."))
    return f"The camera {CAMERA[motion]}{amplitude}{speed}."


# --- writers --------------------------------------------------------------------------------

class _Speakers:
    """Speaker IDs in the order of first vocal events (assigned up front, so prose can carry a
    member's ID before its line). Cast members speak as their description or, in ref2va, as
    <Subject N> (Sx); everyone else as "The <role> with a <voice> (Sx)"."""

    def __init__(self, scene: Scene, labels: Labels | None = None, sep: str | None = None) -> None:
        self.ids: dict[str, str] = {}
        for shot in scene.shots:
            for it in shot.items:
                if isinstance(it, Voice) and it.name not in self.ids:
                    self.ids[it.name] = f"S{len(self.ids) + 1}"
        self.cast = {m.name: m for m in scene.cast}
        self.labels = labels
        self.sep = sep or ("," if labels else ":")
        self.seen: set[str] = set()

    def in_shot(self, shot: Shot) -> dict[str, str]:
        return {it.name: self.ids[it.name] for it in shot.items if isinstance(it, Voice) and it.name in self.cast}

    def render(self, v: Voice, shot_no: int, lint: list[Issue], names: Names | None = None,
               tagged: set[str] | None = None) -> str:
        mods = [m.strip() for m in v.mods.split(",") if m.strip()]
        flags = {m.lower() for m in mods}
        voiceover = "voiceover" in flags
        off_screen = bool(flags & {"off-screen", "offscreen"})
        desc = ", ".join(m for m in mods if m.lower() not in ("voiceover", "off-screen", "offscreen"))
        lang, words = "English", v.text
        if m := _LANG.match(words):
            lang, words = m.group(1), m.group(2)
        if not words:
            lint.append(Issue("warn", f"Shot {shot_no}: {v.name} has an empty line."))
        sid, sep, first = self.ids[v.name], self.sep, v.name not in self.seen
        self.seen.add(v.name)
        d = f"<d>[{lang}] {words}</d>"
        if member := self.cast.get(v.name):
            if names:
                names.note(v.name, shot_no)
            if tagged is not None:
                tagged.add(v.name)
            if self.labels:
                subject = f"<Subject {self.labels.subjects[v.name]}> ({sid})"
            elif names and v.name not in names.introduced:
                names.introduced.add(v.name)
                subject = f"{_cap(member.head)}{member.tail} ({sid})"
            else:
                subject = f"{_cap(member.short)} ({sid})"
            manner = ""
            if desc:
                has_article = re.match(r"(a|an|the)\s", desc, re.IGNORECASE)
                manner = (f" in {desc if has_article else article(desc) + ' ' + desc}" if "voice" in desc.lower()
                          else f" with {desc}")
            if self.labels and member.voice:
                manner += f", using the voice timbre referenced from {self.labels.label(member.voice)}"
            says = f"{subject} says{manner}"
        else:
            noun = v.name.lower().replace("_", " ")
            says = f"The {noun}{' with a ' + desc if desc and first else ''} ({sid}) says"
        if voiceover:
            return f"{says} in an off-screen voiceover{sep} {d} while their lips remain completely closed."
        if off_screen:
            return f"{says} off-screen{sep} {d}"
        return f"{says}{sep} {d}"


def _alignment(scene: Scene) -> str:
    n, s = len(scene.shots), f"{scene.duration:.2f}"
    if scene.mode == "i2va":
        return ("For the target video, at 0.00 seconds into the target video, "
                "<Picture 1> (from [Shot 1]) is fully referenced.")
    if scene.mode == "fl2va":
        return ("How the reference pictures align with the target video — Picture 1 (from Shot 1) "
                "aligns with the 0.00-second mark of the target video; Picture 2 (from Shot "
                f"{n}) aligns with the {s}-second mark of the target video.")
    if scene.mode == "l2va":
        return ("How the reference pictures align with the target video — <Picture 1> "
                f"(from [Shot {n}]) aligns with the {s}-second mark of the target video.")
    return ""


def render_shots(scene: Scene, lint: list[Issue], speakers: _Speakers, names: Names,
                 labels: Labels | None = None, style: str = "") -> list[str]:
    """One string per shot; `style` opens Shot 1 as its own sentence. With labels (ref2va and
    lite) cast names become <Subject N>, `[image 2]`-style sources become labels, and frame
    anchors are spelled out."""
    shots = []
    for i, shot in enumerate(scene.shots, start=1):
        speaking, tagged, parts = speakers.in_shot(shot) if labels else {}, set(), []
        for it in shot.items:
            if isinstance(it, str):
                text = labels.brackets(it) if labels else it
                parts.append(_sentence_case(_end(names.render(text, i, speaking, tagged))))
            else:
                parts.append(speakers.render(it, i, lint, names, tagged))
        if labels and shot.first_frame:
            parts.insert(0, f"The shot begins from <Picture {shot.first_frame[0]}>.")
        if labels and shot.continues:
            parts.insert(0, f"The shot continues from the end of <Video {shot.continues}>.")
        if labels and shot.last_frame:
            parts.append(f"The shot ends on <Picture {shot.last_frame[0]}>.")
        body = " ".join(parts)
        if not body:
            lint.append(Issue("warn", f"Shot {i} has no visible action."))
        m = _FIRST_SENTENCE.match(body)
        first, rest = (m.group(1), m.group(2)) if m else (body, "")
        if i == 1:
            head = "[Shot 1] " + " ".join(p for p in (style and _end(_cap(style)), _cap(first)) if p)
        else:
            head = f"[Shot {i}] At {timestamp(shot.start)}, {TRANSITIONS[shot.transition]} {_low(first)}"
        camera = camera_sentence(shot.camera, i, lint) if shot.camera else ""
        shots.append(" ".join(p for p in (head, camera, rest) if p))
    return shots


DEFAULT_SOUNDSCAPE = "Natural foley and ambient sound that fit the scene."  # without SFX lines H3 still wants sound


def soundscape(scene: Scene, lint: list[Issue]) -> str:
    sfx = [items for shot in scene.shots for items in shot.sfx]
    if sfx:
        sentences = [_end(_cap(oxford(it))) for it in sfx]
        joined = " ".join(sentences)
        if len(sentences) > 4:
            lint.append(Issue("warn", f"overall_soundscape has {len(sentences)} sentences; "
                                      "the guide wants 1–4."))
        if scene.silence:
            lint.append(Issue("warn", "SFX: silence next to other SFX lines is ignored."))
        return joined
    if scene.silence:
        return "N/A"
    lint.append(Issue("info", "No SFX lines, so overall_soundscape asks for natural foley and ambience; SFX: lines "
                              "choose the sounds, SFX: silence means none."))
    return DEFAULT_SOUNDSCAPE


def music(scene: Scene, lint: list[Issue]) -> str:
    if not scene.music or scene.music.strip().rstrip(".").upper() in ("N/A", "NONE"):
        return "N/A"
    if m := MOOD_WORDS.search(scene.music):
        lint.append(Issue("warn", f"MUSIC uses the mood word \"{m.group(1)}\"; the guide wants "
                                  "instrumentation, tempo and dynamics."))
    return _end(_cap(scene.music))


def _fields(scene: Scene, lint: list[Issue], shots: list[str]) -> str:
    return (f"integrated_multimodal_description: {' '.join(shots)}\n\n"
            f"overall_soundscape: {soundscape(scene, lint)}\n\nnon_diegetic_music: {music(scene, lint)}")


def retention(scene: Scene, names, label) -> str:
    """The retention_analysis block when a CAST member says `keep:`: every member, its shots, its marker
    and reason (the default for those without). Empty without a `keep:` line."""
    if not any(m.keep for m in scene.cast):
        return ""
    from orrery.h3_ref import DEFAULT_KEEP

    lines = []
    for m in scene.cast:
        where = ", ".join(f"[Shot {i}]" for i in sorted(names.appears.get(m.name, []))) or "no shot"
        marker, reason = m.keep or DEFAULT_KEEP
        lines.append(f"{label(m)} (appears in {where}): {marker} - {(reason or DEFAULT_KEEP[1]).replace('{who}', m.short)}")
    return "retention_analysis:\n" + "\n".join(lines)


def write_h3_base(scene: Scene, lint: list[Issue]) -> str:
    names = Names(scene.cast)
    shots = render_shots(scene, lint, _Speakers(scene), names, style=scene.style)
    keep = retention(scene, names, lambda m: m.short[0].upper() + m.short[1:])
    return "\n\n".join(p for p in (_alignment(scene), keep, _fields(scene, lint, shots)) if p)


def write_h3_lite(scene: Scene, lint: list[Issue]) -> str:
    """`<Subject N> = description of <Picture i>` lines, then the base fields with every cast
    mention as its label."""
    prose = [it for shot in scene.shots for it in shot.items if isinstance(it, str)]
    labels = Labels(scene.cast, [s for text in prose for s in bracket_sources(text)])
    names = Names(scene.cast, labels, describe=False)
    shots = render_shots(scene, lint, _Speakers(scene, labels, sep=":"), names, labels, style=scene.style)
    definitions = []
    for m in scene.cast:
        subject, phrase = f"<Subject {labels.subjects[m.name]}>", labels.sources_phrase(m)
        noun, detail = m.split_head() if phrase else (m.head, "")
        definitions.append(f"{subject} = {noun}{' of ' + phrase if phrase else ''}{detail}{m.tail}")
        if m.voice:
            definitions.append(f"{labels.label(m.voice)} = the voice of {subject}")
    align = "" if scene.mode == "ref2va" else _alignment(scene)
    keep = retention(scene, names, lambda m: f"<Subject {labels.subjects[m.name]}>")
    if scene.summary.strip():
        lint.append(Issue("warn", "summary: goes into the prompt only in the full format: add full to the @h3 line."))
    return "\n\n".join(p for p in ("\n".join(definitions), align, keep, _fields(scene, lint, shots)) if p)


def write_flat(scene: Scene) -> str:
    if not scene.shots:
        return scene.style
    names = Names(scene.cast)
    prose = " ".join(_sentence_case(_end(names.render(it, 1))) for it in scene.shots[0].items if isinstance(it, str))
    return f"{_cap(scene.style)}, {_low(prose)}" if scene.style else prose


# --- lint that needs the whole scene --------------------------------------------------------

def _scene_lint(src: str, scene: Scene, lint: list[Issue]) -> None:
    n = len(scene.shots)
    if scene.mode not in MODES:
        lint.append(Issue("warn", f"Unknown mode \"{scene.mode}\" ({', '.join(MODE_WORDS)}); compiled like text."))
    _cast_lint(scene, lint)
    if not n:
        lint.append(Issue("error", "No SHOT yet."))
        return
    if not 4 <= scene.duration <= 15:
        lint.append(Issue("warn", f"Duration {scene.duration:.2f} s is outside H3's trained 4–15 s."))

    def mentions(i: int, pattern: str) -> bool:
        return any(re.search(pattern, it if isinstance(it, str) else it.text)
                   for it in scene.shots[i].items)

    if scene.mode == "i2va" and not mentions(0, r"Picture 1"):
        lint.append(Issue("warn", "@h3 image: anchor <Picture 1> in Shot 1, then describe the action."))
    if scene.mode == "fl2va":
        if n > 1:
            lint.append(Issue("warn", "@h3 first-last: the guide favors a single shot so the model can "
                                      "interpolate between the frames."))
        if not mentions(0, r"Picture 1"):
            lint.append(Issue("warn", "@h3 first-last: Shot 1 should start from Picture 1."))
        if not mentions(n - 1, r"Picture 2"):
            lint.append(Issue("warn", "@h3 first-last: the final shot should land on Picture 2."))
    if scene.mode == "l2va" and not mentions(n - 1, r"Picture 1"):
        lint.append(Issue("warn", "@h3 last: the final shot must converge on <Picture 1>."))
    if scene.mode == "t2va" and any(mentions(i, r"Picture \d") for i in range(n)):
        lint.append(Issue("warn", "@h3 text has no reference pictures; drop them or switch mode."))
    if _CLIP_WEIGHT.search(src):
        lint.append(Issue("warn", "CLIP weight syntax like (word:1.2) is inert on H3: its "
                                  "tokenizer disables weights."))


def _cast_lint(scene: Scene, lint: list[Issue]) -> None:
    ref = scene.mode == "ref2va"
    for m in scene.cast:
        lint.extend(Issue("warn", problem) for problem in m.problems)
        for src in m.sources:
            if src.kind != "refmod" and src.index > MAX_SLOTS[src.kind]:
                lint.append(Issue("warn", f"{m.name} uses {src.kind} {src.index}; the Reference to Video node "
                                          f"takes {src.kind} 1–{MAX_SLOTS[src.kind]}."))
        if not ref and (m.voice or any(s.kind != "refmod" for s in m.sources)):
            still = "" if scene.lite else f"; in @h3 {WORD.get(scene.mode, scene.mode)} its name still expands to its description"
            lint.append(Issue("warn", f"{m.name}: image, video and audio references only take effect in "
                                      f"@h3 references{still}."))
        if m.voice and not any(isinstance(it, Voice) and it.name == m.name for s in scene.shots for it in s.items):
            lint.append(Issue("warn", f"{m.name} has a voice reference but never speaks."))
    if not ref and any(s.first_frame or s.last_frame or s.continues for s in scene.shots):
        lint.append(Issue("warn", "Frame anchors (from/to image N, after video N) only take effect in @h3 references."))
    if ref and not scene.lite and not scene.summary:
        lint.append(Issue("warn", "@h3 references reads best with a summary: line (one short paragraph about the "
                                  "target video, using CAST names)."))


def named_members(scene: Scene) -> set[str]:
    """The CAST names this clip's screenplay uses: in its prose, its voices, its sound, its frame
    anchors or its summary."""
    texts = [scene.summary]
    for shot in scene.shots:
        texts += [it if isinstance(it, str) else f"{it.name}: {it.text}" for it in shot.items]
        texts += [part for group in shot.sfx for part in group]
        texts += [anchor[1] for anchor in (shot.first_frame, shot.last_frame) if anchor and anchor[1]]
    return {m.name for m in scene.cast if any(re.search(rf"(?<![\w]){re.escape(m.name)}(?![\w])", t) for t in texts)}


def drop_absent(scene: Scene) -> list[Member]:
    """Leave the cast members this clip does not name (and that are not `global`) out of it: their
    definitions, their references and their RefMods. A defined subject that the screenplay never
    calls for still shows up in H3's clip. Returns the members left out."""
    named = named_members(scene)
    absent = [m for m in scene.cast if not (m.everywhere or m.name in named)]
    scene.cast = [m for m in scene.cast if m.everywhere or m.name in named]
    return absent


def clip_refmods(scene: Scene) -> list[dict]:
    """The RefMods this clip gets: those of its cast (after drop_absent, the members it names and the
    `global` ones), each with its strength and its start (a share of sampling). A RefMod brings
    back what it shows, so a place the clip only leaves for, or a person who is not in it, stays out."""
    out: dict[str, dict] = {}
    for m in scene.cast:
        for src in m.sources:
            if src.kind == "refmod" and src.name not in out:
                dial = scene.dials.get(("refmod", _refmod_key(src.name)), {})
                strength = scene.refmod_strength if src.strength is None else src.strength
                start = scene.refmod_start if src.start is None else src.start
                end = scene.refmod_end if src.end is None else src.end
                out[src.name] = {"name": src.name, "member": m.name, "strength": dial.get("strength", strength),
                                 "from": dial.get("from", start), "to": dial.get("to", end)}
    for (kind, name), dial in scene.dials.items():  # `SET: NAME(…)`: a RefMod no member has (#224)
        if kind == "refmod" and not any(_refmod_key(n) == name for n in out):
            out[name] = {"name": name, "member": None, "strength": dial.get("strength", scene.refmod_strength),
                         "from": dial.get("from", scene.refmod_start), "to": dial.get("to", scene.refmod_end)}
    return list(out.values())


def clip_images(scene: Scene, refs: list[int]) -> list[dict]:
    """The clip's pictures with an `at` or a `from` (`image 1 at 0.5 from 35%`), for Orrery RefMods:
    `ref` is the picture's place among those Reference to Video gets (packed by Orrery Refs when
    `refs` lists the original slots), `image` its slot as written (in the CAST, the text or a frame anchor)."""
    out: dict[int, dict] = {}
    for m in scene.cast:
        for src in m.sources:
            image = refs[src.index - 1] if refs else src.index
            dial = scene.dials.get(("image", image), {})
            dialed = src.strength is not None or src.start is not None or src.end is not None or dial
            if src.kind == "image" and dialed and src.index not in out:
                out[src.index] = {"ref": src.index, "image": image, "member": m.name,
                                  "strength": dial.get("strength", 1.0 if src.strength is None else src.strength),
                                  "from": dial.get("from", 0.0 if src.start is None else src.start),
                                  "to": dial.get("to", 1.0 if src.end is None else src.end)}
    for slot in image_slots(scene):  # an image in the text or a frame anchor, which `SET: image_N(…)` dials (#224)
        image = refs[slot - 1] if refs else slot
        dial = scene.dials.get(("image", image))
        if dial and slot not in out:
            out[slot] = {"ref": slot, "image": image, "member": None, "strength": dial.get("strength", 1.0),
                         "from": dial.get("from", 0.0), "to": dial.get("to", 1.0)}
    return list(out.values())


_IMAGE_BRACKET = re.compile(r"\[image\s+(\d+)\]", re.IGNORECASE)
_IMAGE_ANGLE = re.compile(r"<image\s+(\d+)>", re.IGNORECASE)  # H3's own way to name a reference in the text


def image_slots(scene: Scene) -> list[int]:
    """The reference-image slots a scene uses: CAST sources, frame anchors and [image N] in prose."""
    used = {s.index for m in scene.cast for s in m.sources if s.kind == "image"}
    used |= {a[0] for shot in scene.shots for a in (shot.first_frame, shot.last_frame) if a}
    texts = [scene.summary, *(it for shot in scene.shots for it in shot.items if isinstance(it, str))]
    used |= {int(n) for text in texts for n in _IMAGE_BRACKET.findall(text)}
    return sorted(used)


def name_pictures(scene: Scene, libraries: Mapping[str, Library], lint: list[Issue],
                  reserved: set[int] | frozenset = frozenset()) -> dict[int, dict]:
    """Gives every `image <name>` of the clip's CAST slots of its own, the highest free ones, and returns
    {slot: {file, prompt}}: the file for Orrery Refs to load, the prompt that made it for the language
    model that writes the member's `--…--`. A character's name brings all its pictures (a grid's views),
    one slot each, in the order they were made; the same name twice shares its slots. `reserved`: slots
    taken elsewhere (wired into Orrery Refs, kept by REMEMBER: lines)."""
    from orrery import pictures

    if not any(s.kind == "image" and s.name for m in scene.cast for s in m.sources):
        return {}
    taken = {n for n in image_slots(scene) if n} | set(reserved)
    free = [n for n in range(MAX_SLOTS["image"], 0, -1) if n not in taken]
    given: dict[str, list[int]] = {}
    files: dict[int, dict] = {}
    for m in scene.cast:
        out = []
        for s in m.sources:
            if not (s.kind == "image" and s.name):
                out.append(s)
                continue
            if s.name not in given:
                found = pictures.find(s.name, libraries) or []
                if not found:
                    lint.append(Issue("warn", f"{m.name}: image {s.name} is no picture of the gallery "
                                              "(__pictures/…__ lists them), so it is left out."))
                elif len(found) > len(free):
                    lint.append(Issue("warn", f"{m.name}: image {s.name} has {len(found)} pictures, but only {len(free)} "
                                              f"of the {MAX_SLOTS['image']} image slots are free, so "
                                              f"{len(found) - len(free)} {'is' if len(found) - len(free) == 1 else 'are'} "
                                              "left out."))
                slots = sorted(free[:min(len(found), len(free))])
                free = [n for n in free if n not in slots]
                made, row = pictures.prompt(s.name, libraries), pictures.ids(s.name, libraries)
                files.update({n: {"file": str(f), "prompt": made, "name": s.name, "id": row.get(str(f))}
                              for n, f in zip(slots, found, strict=False)})
                given[s.name] = slots
            out += [replace(s, index=n, name="") for n in given[s.name]]
        m.sources = out
    for name, slots in given.items():  # SET: @HERO(0.5) reached the picture by its name: now by its slots
        if dial := scene.dials.pop(("image", name), None):
            for n in slots:
                scene.dials.setdefault(("image", n), {}).update(dial)
    return files


def pack_images(scene: Scene) -> list[int]:
    """Renumber the images a scene uses to 1, 2, 3 … as Orrery Refs hands them to Reference to Video,
    which counts only the images wired. Returns the original slots in their new order."""
    used = image_slots(scene)
    new = {old: i for i, old in enumerate(used, start=1)}
    bracket = lambda text: _IMAGE_BRACKET.sub(lambda m: f"[image {new[int(m.group(1))]}]", text)
    for m in scene.cast:
        m.sources = [replace(s, index=new[s.index]) if s.kind == "image" else s for s in m.sources]
    for shot in scene.shots:
        shot.first_frame = (new[shot.first_frame[0]], shot.first_frame[1]) if shot.first_frame else None
        shot.last_frame = (new[shot.last_frame[0]], shot.last_frame[1]) if shot.last_frame else None
        shot.items = [bracket(it) if isinstance(it, str) else it for it in shot.items]
    scene.summary = bracket(scene.summary)
    return used


def cast_images(lines: list[str]) -> set[int]:
    """Every picture a CAST block among these lines gives a member (`NAME (image 3): …`)."""
    out, in_cast = set(), False
    for raw in lines:
        line = raw.strip()
        if line == "CAST":
            in_cast = True
        elif _SHOT.match(line):
            in_cast = False
        elif in_cast and (m := MEMBER.match(line)):
            out |= {s.index for s in parse_member(m.group(1), m.group(2), m.group(3)).sources
                    if s.kind == "image" and not s.name}
    return out


def zero_images(scene: Scene) -> set[int]:
    """The pictures this clip has at 0 (`SET: image_1(0)`, or `image 1 at 0` in its CAST)."""
    zero = {n for (kind, n), dial in scene.dials.items() if kind == "image" and dial.get("strength", 1.0) <= 0}
    for m in scene.cast:
        for s in m.sources:
            if s.kind == "image" and s.strength is not None and s.strength <= 0 and "strength" not in scene.dials.get(("image", s.index), {}):
                zero.add(s.index)
    return zero


def withhold_images(scene: Scene, missing: set[int], lint: list[Issue], at_zero: bool = False) -> None:
    """Leave out of this clip the images a SEND: line fills later, or that are at 0: CAST sources and
    frame anchors go, and a [image N] in prose is flagged, since it points at nothing (or keeps it in)."""
    if not missing:
        return
    for m in scene.cast:
        m.sources = [s for s in m.sources if not (s.kind == "image" and s.index in missing)]
    for shot in scene.shots:
        if shot.first_frame and shot.first_frame[0] in missing:
            shot.first_frame = None
        if shot.last_frame and shot.last_frame[0] in missing:
            shot.last_frame = None
    texts = [scene.summary, *(it for shot in scene.shots for it in shot.items if isinstance(it, str))]
    for n in sorted({int(x) for text in texts for x in _IMAGE_BRACKET.findall(text)} & missing):
        lint.append(Issue("warn", f"image {n} is at 0, but [image {n}] in the prose still hands it to H3 in this clip."
                          if at_zero else f"[image {n}] is mentioned before the REMEMBER: line that keeps it has played, "
                                          "so in this clip it points at nothing."))


def render_scene(scene: Scene, target: str, lint: list[Issue]) -> str:
    """The prompt for a parsed scene; again after its prose was rewritten (`> enhance`)."""
    if target == "flat":
        return write_flat(scene)
    if target != "h3-base":
        raise ValueError(f"unknown target {target!r} (h3-base, flat)")
    if scene.lite:
        return write_h3_lite(scene, lint)
    if scene.mode == "ref2va":
        from orrery.h3_ref import write_h3_ref
        return write_h3_ref(scene, lint)
    return write_h3_base(scene, lint)


def compile_scene(src: str, seed: int, libraries: Mapping[str, Library],
                  weights: Mapping[str, float] | None = None, target: str = "h3-base",
                  segment: int = 0, packed: bool = False, held: set[int] | frozenset = frozenset(),
                  cell: int | None = None, standing: set[int] | frozenset = frozenset(),
                  past: Mapping[int, dict] | None = None, film: frozenset[int] | None = None) -> Compiled:
    """`segment` picks a reel's clip (see orrery.reel); plain screenplays ignore it. `packed`: the
    images are renumbered to the ones this clip uses (Orrery Refs hands on only those). `cell`: the
    run of a `: grid` (orrery.batch); None rolls its axes. `standing`: the images wired into Orrery
    Refs: one a REMEMBER: line keeps stays in the clip as wired until those frames exist. `past`: what the
    reel's clips before this one rendered, from their takes (#261; see reel._unroll). `film`: the segments the
    reel's film holds (#415): a clip whose clip before it lacks starts afresh, and the clips it lacks send nothing;
    None (not known) takes the reel as written."""
    from orrery.batch import prepare
    from orrery.dsl import parse, strip_exports, with_inline
    from orrery.reel import build_segment, shared_sends, split_reel

    lint: list[Issue] = []
    src, libraries = with_inline(strip_comments(src), libraries)
    if parse(src).exports:
        lint.append(Issue("warn", "EXPORT: is for text templates (Krea and other image models): a screenplay reads "
                                  "what a picture exported from the gallery ($hero.mood, with $hero = "
                                  "__pictures/…__). The EXPORT: lines are left out."))
        src = strip_exports(src)
    src = bare(src)  # `@JINX` is JINX
    reel = split_reel(src)
    params = parse(src).params
    if reel and params.unique:
        raise ValueError("@unique varies a template across runs; a reel already gives every run a clip of its "
                         "own. Use it in a single clip.")
    src = prepare(src, seed, libraries, cell)
    reel = split_reel(src) if reel else None
    sends: dict[int, dict] = {}
    sent_mods: dict[str, dict] = {}  # RefMods made from the reel's own frames, which Orrery RefMods builds
    if reel:
        scene, picks, path, kept = build_segment(reel, seed, libraries, weights, segment, lint, past, film)
        absent = drop_absent(scene)  # a chunk without a member leaves its definition and its RefMods out
        lint += [Issue("warn", problem) for m in absent for problem in m.problems]
        if reel.send_slots:
            if scene.mode != "ref2va":
                raise ValueError("REMEMBER: hands frames to Reference to Video as reference images, so it needs an "
                                 "@h3 references screenplay.")
            sends = reel.ready(segment, set(held) & set(reel.send_slots), path, film)
            # a sent image that some CAST gives a member goes only where a member of this clip has it (not to a
            # clip without that member, nor to one whose CAST redefines it without the image); one that no CAST
            # names goes along with every clip after it
            named = cast_images(reel.head).union(*(cast_images(b.lines) for b in reel.blocks))
            ours = {s.index for m in scene.cast for s in m.sources if s.kind == "image"}
            sends = {n: send for n, send in sends.items() if n in ours or n not in named}
            withhold_images(scene, set(reel.send_slots) - set(sends) - set(standing), lint)
            for n in sorted(set(standing) & set(reel.send_slots) & ours):
                lint.append(Issue("info", f"image {n} is wired and kept by a REMEMBER: line too: "
                                          + (f"the frames from clip {sends[n]['segment'] + 1} replace the wired picture."
                                             if "segment" in sends.get(n, {}) else "the wired picture until those frames exist.")))
        if reel.send_refmods:
            sent_mods = reel.refmods_ready(segment, path, film)
            late = set(reel.send_refmods) - set(sent_mods)  # its chunk has not played yet: nothing to bring back
            for m in scene.cast:
                m.sources = [s for s in m.sources if not (s.kind == "refmod" and s.name in late)]
        if reel.send_slots or reel.send_refmods:
            # every chunk's first segment: the reel's own path, or the one walked here when jumps wait on rolls
            starts = reel.starts(path if reel.jumps_on_rolls else None)
            lint += [Issue("warn", w) for w in shared_sends(reel, starts)]
            for block, start in zip(reel.blocks, starts, strict=True):
                for send in block.sends:
                    early = [lo for lo, _ in send.segments or []
                             if start is not None and lo <= start and send.target not in held]
                    if early:
                        lint.append(Issue("warn", f"REMEMBER: … as {send.what} lists clip {min(early) + 1}, but its "
                                                  f"frames come from clip {start + 1}: up to clip {start + 1} the clips "
                                                  "go without it."))
    else:
        ex = Expander(seed, libraries, weights, params.rng)
        scene, picks = parse_scene(src, ex, lint), ex.picks
        lint += [Issue("warn", w) for w in ex.warnings]
        absent = drop_absent(scene)
        lint += [Issue("warn", problem) for m in absent for problem in m.problems]
        lint += [Issue("warn", f"{m.name} is in the CAST, but no shot, voice or summary names it, so it is left out "
                               "of the prompt (always keeps a member in).") for m in absent]
    named = name_pictures(scene, libraries, lint, set(standing) | set(sends) | set(reel.send_slots if reel else ()))
    # A picture at 0 leaves the clip: Reference to Video shows its pictures to the text encoder too, so
    # only one it never gets is gone. Not named, and not handed on as a sent image either.
    if zero := zero_images(scene):
        withhold_images(scene, zero, lint, at_zero=True)
        sends = {n: send for n, send in sends.items() if n not in zero}
    refs = pack_images(scene) if packed else []
    if packed:  # sent images reach Orrery Refs whether the prompt names them or not, after the ones it does
        refs += [n for n in sorted(sends) if n not in refs]
    text = render_scene(scene, target, lint)
    if target == "h3-base":
        _scene_lint(src, scene, lint)
    return Compiled(text, picks, lint, scene, " ".join(scene.loras), len(reel.blocks) if reel else 0,
                    segment if reel else 0, reel.segments if reel else 0, refs,
                    sends, reel.send_slots if reel else [],
                    [{**r, "sent": sent_mods[r["name"]]} if r["name"] in sent_mods else r for r in clip_refmods(scene)],
                    clip_images(scene, refs), reel.continues(segment, path, film) if reel else None,
                    bool(reel and reel.blocks[path[segment][0]].test), bool(reel and reel.uses_input), named,
                    path[segment][0] if reel else None, kept if reel else None)
