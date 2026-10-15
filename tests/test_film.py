"""Orrery Film's store: one take per segment of a reel, the tail the next segment continues from,
and the film of them all, in the shape Chain Video keeps, so the readers take either."""

import json
import os

import av
import numpy as np
import pytest

from orrery import chain, film
from orrery.continuum.masked import Tail

SR = 48000


def frames(n, w=64, h=48, shade=0):
    out = np.zeros((n, h, w, 3), dtype=np.uint8)
    out[..., 0] = shade
    out[..., 1] = (np.arange(n) * 4 % 256)[:, None, None]
    return out


def tail(fill=0.0):
    return Tail(np.full((1, 24, 7, 3, 4), fill, np.float32), np.full((1, 32, 2, 37), fill, np.float32), 0.25)


def take(out, segment, n=24, w=64, fill=0.0, continues=-1, test=False, meta=None, seam=None):
    sound = np.sin(np.linspace(0, 400, round(n / 24 * SR), dtype=np.float32))[None].repeat(2, 0) * 0.1
    return film.save_take(out, "h3_context", segment, frames(n, w=w, shade=40 * segment), sound, SR, tail(fill),
                          {"seed": 7, **(meta or {})}, continues, test, seam)


def seam(shade=250, seconds=0.25):
    """The clip before's end as a continued clip decoded it: its last frames bright red, its sound silent."""
    return film.Seam(frames(film.DECODE_BLEND, shade=shade), np.zeros((2, round(seconds * SR)), np.float32))


def active_run(out):
    root = out / "h3_context" / film.STORE
    return root / json.loads((root / "active.json").read_text())["run"]


def reds(path):
    """How red each frame of a video is: the shade a take's frames carry."""
    with av.open(str(path)) as c:
        return np.array([f.to_ndarray(format="rgb24")[..., 0].mean() for f in c.decode(c.streams.video[0])])


def sound_of(path):
    with av.open(str(path)) as c:
        return np.concatenate([f.to_ndarray() for f in c.decode(c.streams.audio[0])], axis=1)


def decoded(path):
    with av.open(str(path)) as c:
        count = sum(1 for _ in c.decode(c.streams.video[0]))
    with av.open(str(path)) as c:
        samples = sum(f.samples for f in c.decode(c.streams.audio[0]))
    return count, samples


def test_a_reel_keeps_one_take_per_segment_and_a_film_of_them_all(tmp_path):
    take(tmp_path, 0, n=24)
    t1 = take(tmp_path, 1, n=48)
    listed = chain.listing(tmp_path, "h3_context")
    assert (listed["width"], listed["height"]) == (64, 48)
    assert [(c["segment"], c["frames"]) for c in listed["clips"]] == [(0, 24), (1, 48)]
    assert chain.clip_file(tmp_path, "h3_context", 1) == t1 / "video.mp4"
    assert json.loads((t1 / "meta.json").read_text())["seed"] == 7
    count, samples = decoded(active_run(tmp_path) / "film.mp4")
    assert count == 72 and abs(samples - 3 * SR) <= 2048  # AAC pads a frame or two
    assert decoded(t1 / "video.mp4")[0] == 48


def test_rendering_a_segment_again_drops_the_ones_after_it(tmp_path):
    first = [take(tmp_path, s) for s in range(3)]
    again = take(tmp_path, 1, n=41)
    assert [(c["segment"], c["frames"]) for c in chain.listing(tmp_path, "h3_context")["clips"]] == [(0, 24), (1, 41)]
    assert again != first[1] and first[1].is_dir() and first[2].is_dir()  # older takes stay on disk
    assert decoded(active_run(tmp_path) / "film.mp4")[0] == 65


def test_a_branch_continues_the_scene_it_names_and_a_retake_keeps_the_branches_beside_it(tmp_path):
    take(tmp_path, 0)
    take(tmp_path, 1, fill=0.5)  # scene 2
    take(tmp_path, 2, fill=0.1, continues=1)  # case A, AFTER: 2
    take(tmp_path, 3, fill=0.2, continues=1)  # case B, AFTER: 2
    assert (film.previous_tail(tmp_path, "h3_context", 4, continues=1).video == 0.5).all()
    take(tmp_path, 2, n=30, fill=0.3, continues=1)  # case A again: case B continues scene 2, not case A
    assert [c["frames"] for c in chain.listing(tmp_path, "h3_context")["clips"]] == [24, 24, 30, 24]
    take(tmp_path, 4, n=12, continues=None)  # a test scene: continues no clip
    take(tmp_path, 1, n=36, fill=0.5)  # scene 2 again: every branch of it goes, and what comes after them
    assert [c["frames"] for c in chain.listing(tmp_path, "h3_context")["clips"]] == [24, 36]


def test_test_takes_are_kept_and_the_film_is_joined_without_them(tmp_path):
    first = take(tmp_path, 0, n=24, continues=None, test=True)
    assert film.film_file(first) == first / "video.mp4"  # no film yet: the take stands in
    take(tmp_path, 1, n=30, continues=None, test=True)
    shot = take(tmp_path, 2, n=48, continues=None)
    take(tmp_path, 3, n=12, continues=2)
    assert [c["frames"] for c in chain.listing(tmp_path, "h3_context")["clips"]] == [24, 30, 48, 12]
    assert film.film_file(shot) == active_run(tmp_path) / "film.mp4"
    assert decoded(active_run(tmp_path) / "film.mp4")[0] == 60


def source_video(path, seconds=2, fps=30, w=65, h=49):
    """A test video at another frame rate, odd-sized, its frames numbered by shade, with a tone."""
    with av.open(str(path), "w") as out:
        video = out.add_stream("ffv1", rate=fps)  # lossless, and odd sizes are fine
        video.width, video.height, video.pix_fmt = w, h, "yuv444p"
        audio = out.add_stream("aac", rate=SR)
        for i in range(seconds * fps):
            frame = np.full((h, w, 3), (i * 4) % 256, np.uint8)
            for packet in video.encode(av.VideoFrame.from_ndarray(frame, format="rgb24")):
                out.mux(packet)
        for packet in video.encode(None):
            out.mux(packet)
        tone = (np.sin(np.linspace(0, 600, seconds * SR, dtype=np.float32)) * 0.1)[None]
        film._encode_sound(out, audio, tone, SR)
    return path


def test_the_input_video_is_kept_at_24_fps_as_the_clip_before_clip_1(tmp_path):
    source = source_video(tmp_path / "mine.mkv")
    kept = film.keep_input(source, tmp_path, "h3_context")
    assert kept == chain.clip_file(tmp_path, "h3_context", -1) == tmp_path / "h3_context" / chain.INPUT_FILE
    with av.open(str(kept)) as c:
        stream = c.streams.video[0]
        assert (stream.average_rate, stream.width, stream.height) == (24, 64, 48)  # even-sized for H.264
        assert abs(sum(1 for _ in c.decode(stream)) - 48) <= 1 and c.streams.audio
    written = kept.stat().st_mtime_ns
    assert film.keep_input(source, tmp_path, "h3_context").stat().st_mtime_ns == written  # the same source: kept
    assert chain.clip_file(tmp_path / "elsewhere", "h3_context", -1) is None


class FakeVAE:
    """Encodes as the H3 VAEs shape it: video 17k+5 frames → 5k+2 slots at /16, audio 800 samples a tick."""

    audio_sample_rate = 32000

    def __init__(self):
        self.seen = []

    def encode(self, x):
        import torch

        self.seen.append(tuple(x.shape))
        if x.ndim == 4:  # frames [T, H, W, 3]
            slots = 2 if x.shape[0] <= 5 else (x.shape[0] - 5) // 17 * 5 + 2
            return torch.ones((1, 24, slots, x.shape[1] // 16, x.shape[2] // 16))
        return torch.ones((1, 32, 2, -(-x.shape[1] // 800)))  # sound [1, samples, channels]


def test_a_scene_after_the_input_video_pins_its_last_frames_and_sound(tmp_path, monkeypatch):
    torch = pytest.importorskip("torch")
    import sys
    import types

    from orrery import comfy_film

    monkeypatch.setitem(sys.modules, "folder_paths", types.SimpleNamespace(get_output_directory=lambda: str(tmp_path)))
    upscale = lambda x, w, h, method, crop: torch.nn.functional.interpolate(x, size=(h, w))
    comfy = types.ModuleType("comfy")
    comfy.utils, comfy.audio = types.SimpleNamespace(common_upscale=upscale), types.SimpleNamespace(resample=lambda w, a, b: w)
    monkeypatch.setitem(sys.modules, "comfy", comfy)
    monkeypatch.setitem(sys.modules, "comfy.utils", comfy.utils)
    monkeypatch.setitem(sys.modules, "comfy.audio", comfy.audio)
    video, audio = torch.zeros((1, 24, 27, 30, 40)), torch.zeros((1, 32, 2, 160))  # this clip: 640×480
    vae, audio_vae = FakeVAE(), FakeVAE()
    with pytest.raises(ValueError, match="video input"):
        comfy_film._input_tail("h3_context", video, audio, vae, audio_vae)
    film.keep_input(source_video(tmp_path / "mine.mkv"), tmp_path, "h3_context")
    with pytest.raises(ValueError, match="audio_vae"):
        comfy_film._input_tail("h3_context", video, audio, vae, None)
    tail = comfy_film._input_tail("h3_context", video, audio, vae, audio_vae)
    assert vae.seen == [(22, 480, 640, 3)]  # its last 22 frames, at this clip's canvas
    assert tuple(tail.video.shape) == (1, 24, 7, 30, 40) and tuple(tail.audio.shape) == (1, 32, 2, 37)


def test_clip_1_again_stays_in_its_run_beside_its_other_takes(tmp_path):
    first = take(tmp_path, 0)
    take(tmp_path, 1)
    before = active_run(tmp_path)
    again = take(tmp_path, 0, n=30)
    assert active_run(tmp_path) == before  # clip 2 continued the first take: it leaves the film
    assert [c["frames"] for c in chain.listing(tmp_path, "h3_context")["clips"]] == [30]
    assert [t["folder"] for t in film.takes(tmp_path, "h3_context")[0]] == [first.name, again.name]
    film.pick_take(tmp_path, "h3_context", 0, first.name)
    assert [c["frames"] for c in chain.listing(tmp_path, "h3_context")["clips"]] == [24, 24]  # #240: its clip 2 comes back


def test_clip_1_in_another_size_starts_a_new_run(tmp_path):
    take(tmp_path, 0)
    before = active_run(tmp_path)
    take(tmp_path, 0, w=96)
    assert active_run(tmp_path) != before and before.is_dir()
    assert len(film.takes(tmp_path, "h3_context")[0]) == 1


def test_a_segment_continues_only_the_one_before_it(tmp_path):
    with pytest.raises(film.FilmError, match="segment 0"):
        take(tmp_path, 1)
    take(tmp_path, 0)
    with pytest.raises(film.FilmError, match="segment 1"):
        film.previous_tail(tmp_path, "h3_context", 2)
    with pytest.raises(film.FilmError, match="64×48"):
        take(tmp_path, 1, w=96)


def test_the_tail_comes_back_as_it_was_stored(tmp_path):
    take(tmp_path, 0, fill=0.5)
    back = film.previous_tail(tmp_path, "h3_context", 1)
    assert back.video.shape == (1, 24, 7, 3, 4) and (back.video == 0.5).all()
    assert back.audio.shape == (1, 32, 2, 37) and back.grid_offset == 0.25


def test_the_readers_follow_the_store_written_last(tmp_path):
    ours = take(tmp_path, 0)
    theirs = tmp_path / "h3_context" / "chain_video" / "run_x"
    (theirs / "clip_00001_x").mkdir(parents=True)
    (theirs / "clip_00001_x" / "video.mp4").write_bytes((ours / "video.mp4").read_bytes())
    (theirs / "clips.json").write_text(json.dumps({"settings": [64, 48, "24", SR, 2],
                                                   "clips": [{"folder": "clip_00001_x", "frames": 24}]}))
    (theirs.parent / "active.json").write_text(json.dumps({"run": "run_x"}))
    clips_json = active_run(tmp_path) / "clips.json"
    os.utime(clips_json, (1, 1))
    assert chain.clip_file(tmp_path, "h3_context", 0) == theirs / "clip_00001_x" / "video.mp4"
    os.utime(theirs / "clips.json", (0, 0))
    os.utime(clips_json, (5, 5))
    assert chain.clip_file(tmp_path, "h3_context", 0) == ours / "video.mp4"


def test_sample_surfing_offers_a_clips_takes_and_picks_one(tmp_path):
    """#206: four takes of clip 2, the best one picked; the film and the next clip follow it."""
    take(tmp_path, 0)
    surf = [take(tmp_path, 1, n=24 + k) for k in range(4)]  # the newest is active, as after a render
    listed = film.takes(tmp_path, "h3_context")
    assert [t["folder"] for t in listed[1]] == [p.name for p in surf] and listed[1][-1]["active"]
    assert len(listed[0]) == 1
    picked = film.pick_take(tmp_path, "h3_context", 1, surf[1].name)
    assert picked == {"folder": surf[1].name, "seed": 7, "take": 0}
    assert [(c["segment"], c["frames"]) for c in chain.listing(tmp_path, "h3_context")["clips"]] == [(0, 24), (1, 25)]
    assert chain.clip_file(tmp_path, "h3_context", 1) == surf[1] / "video.mp4"
    assert decoded(active_run(tmp_path) / "film.mp4")[0] == 49
    assert film.take_file(tmp_path, "h3_context", surf[2].name) == surf[2] / "video.mp4"


def test_a_picked_take_drops_the_clips_that_continued_another_and_hides_their_takes(tmp_path):
    take(tmp_path, 0)
    a, _ = take(tmp_path, 1), take(tmp_path, 1, n=30)  # the second, b, is the active one
    on_b = take(tmp_path, 2)  # made on take b of clip 2
    film.pick_take(tmp_path, "h3_context", 1, a.name)
    assert [c["segment"] for c in chain.listing(tmp_path, "h3_context")["clips"]] == [0, 1]  # clip 3 continued b
    assert 2 not in film.takes(tmp_path, "h3_context")  # nothing of clip 3 fits take a
    with pytest.raises(film.FilmError):  # clip 3 has left the film: none of its takes is offered or picked
        film.pick_take(tmp_path, "h3_context", 2, on_b.name)
    with pytest.raises(film.FilmError):
        film.pick_take(tmp_path, "h3_context", 1, "seg_0001_../../x")


def test_a_take_beside_the_one_in_the_film_is_deleted_and_the_film_stays(tmp_path):
    take(tmp_path, 0)
    a, b = take(tmp_path, 1), take(tmp_path, 1, n=30)
    assert film.delete_take(tmp_path, "h3_context", 1, a.name) == {"folder": b.name}  # beside it: the film stays
    assert not a.exists() and [t["folder"] for t in film.takes(tmp_path, "h3_context")[1]] == [b.name]
    assert [c["frames"] for c in chain.listing(tmp_path, "h3_context")["clips"]] == [24, 30]


def test_deleting_the_take_in_the_film_puts_the_newest_other_in_its_place(tmp_path):
    take(tmp_path, 0)
    a, b, c = take(tmp_path, 1, n=26), take(tmp_path, 1, n=28), take(tmp_path, 1, n=30)
    take(tmp_path, 2)  # made on c
    assert film.delete_take(tmp_path, "h3_context", 1, c.name) == {"folder": b.name, "seed": 7, "take": 0}
    assert not c.exists() and a.is_dir()
    assert [c["frames"] for c in chain.listing(tmp_path, "h3_context")["clips"]] == [24, 28]  # clip 3 continued c
    assert decoded(active_run(tmp_path) / "film.mp4")[0] == 52


def test_deleting_a_clips_last_take_ends_the_film_before_it(tmp_path):
    only = take(tmp_path, 0)
    two = take(tmp_path, 1)
    assert film.delete_take(tmp_path, "h3_context", 1, two.name) == {"folder": None}
    assert [c["frames"] for c in chain.listing(tmp_path, "h3_context")["clips"]] == [24]
    film.delete_take(tmp_path, "h3_context", 0, only.name)
    assert chain.listing(tmp_path, "h3_context")["clips"] == [] and not (active_run(tmp_path) / "film.mp4").exists()
    again = take(tmp_path, 0)  # the run goes on
    assert again.parent == only.parent
    with pytest.raises(film.FilmError):
        film.delete_take(tmp_path, "h3_context", 0, only.name)


def test_a_clips_takes_go_at_once_the_others_or_all_and_another_paths_stay(tmp_path):
    """#234: the takes a clip's strip shows, all but the one in the film, or that one too."""
    first = take(tmp_path, 0)
    other = take(tmp_path, 0, n=26)  # the second take of clip 1, in the film now
    on_other = take(tmp_path, 1)  # clip 2 made on it
    film.pick_take(tmp_path, "h3_context", 0, first.name)  # back to the first: clip 2 leaves the film, its take stays
    a, b = take(tmp_path, 1, n=28), take(tmp_path, 1, n=30)  # two takes of clip 2 on the first
    assert film.delete_takes(tmp_path, "h3_context", 1) == {"deleted": 1, "folder": b.name}
    assert b.is_dir() and not a.exists() and on_other.is_dir()  # another path's take stays
    assert [c["frames"] for c in chain.listing(tmp_path, "h3_context")["clips"]] == [24, 30]
    assert film.delete_takes(tmp_path, "h3_context", 0, keep_film=False) == {"deleted": 2, "folder": None}
    assert not first.exists() and not other.exists() and chain.listing(tmp_path, "h3_context")["clips"] == []
    with pytest.raises(film.FilmError, match="no takes"):
        film.delete_takes(tmp_path, "h3_context", 0)


def test_the_takes_grow_a_tree_and_every_path_comes_back(tmp_path):
    """#240: a take remembers the take last made on it; picking it, or any take of the tree, brings its path back."""
    a = take(tmp_path, 0)
    a1 = take(tmp_path, 1)
    a1x = take(tmp_path, 2)
    b = take(tmp_path, 0, n=26)  # a second clip 1: the film is b alone, a's path waits
    b1 = take(tmp_path, 1, n=28)
    folders = lambda: [c["version"] for c in chain.listing(tmp_path, "h3_context")["clips"]]
    assert folders() == [b.name, b1.name]
    film.pick_take(tmp_path, "h3_context", 0, a.name)
    assert folders() == [a.name, a1.name, a1x.name]  # back along a's path, to its end
    assert film.walk_to(tmp_path, "h3_context", b1.name)["clips"] == 2
    assert folders() == [b.name, b1.name]
    film.walk_to(tmp_path, "h3_context", a1.name)  # a take in the middle: the path to it, and on from it
    assert folders() == [a.name, a1.name, a1x.name]
    assert film.end_film(tmp_path, "h3_context", 1) == {"clips": 2}
    assert folders() == [a.name, a1.name]
    film.walk_to(tmp_path, "h3_context", a.name)  # the memory still knows the way on
    assert folders() == [a.name, a1.name, a1x.name]
    grown = film.tree(tmp_path, "h3_context")
    assert {t["folder"]: t["parent"] for t in grown["takes"]} == {
        a.name: None, b.name: None, a1.name: a.name, b1.name: b.name, a1x.name: a1.name}
    assert grown["path"] == [a.name, a1.name, a1x.name] and grown["last"][a.name] == a1.name


def test_a_clip_that_starts_afresh_knows_the_take_it_came_after(tmp_path):
    a = take(tmp_path, 0)
    fresh = take(tmp_path, 1, continues=None)  # a scene that starts afresh: it continues nothing, but follows a
    meta = json.loads((fresh / "meta.json").read_text())
    assert (meta["after"], meta["follows"]) == (None, a.name)
    assert {t["folder"]: t["parent"] for t in film.tree(tmp_path, "h3_context")["takes"]}[fresh.name] == a.name
    with pytest.raises(film.FilmError, match="no take"):
        film.walk_to(tmp_path, "h3_context", "seg_0001_nothere1")


def test_a_clip_after_a_gap_starts_afresh_and_the_film_cuts_to_it(tmp_path):
    """#415: a clip whose clip before was never rendered is kept at its place; the film joins what it holds."""
    a = take(tmp_path, 0, n=24)
    with pytest.raises(film.FilmError, match="segment 2"):
        take(tmp_path, 3)  # it would continue clip 3, which the film does not hold
    gap = take(tmp_path, 3, n=30, continues=None)  # it starts afresh
    meta = json.loads((gap / "meta.json").read_text())
    assert (meta["continues"], meta["after"], meta["follows"]) == (None, None, None)
    assert film.held(tmp_path, "h3_context") == frozenset({0, 3})
    listed = chain.listing(tmp_path, "h3_context")["clips"]
    assert [(c["segment"], c["frames"]) for c in listed] == [(0, 24), (3, 30)]
    assert chain.clip_file(tmp_path, "h3_context", 1) is None and chain.clip_file(tmp_path, "h3_context", 3) == gap / "video.mp4"
    assert decoded(active_run(tmp_path) / "film.mp4")[0] == 54  # clip 1, then a cut to clip 4
    on = take(tmp_path, 4, n=12, fill=0.4)  # the clip after it continues it as usual
    assert json.loads((on / "meta.json").read_text())["after"] == gap.name
    assert (film.previous_tail(tmp_path, "h3_context", 5).video == 0.4).all()
    assert film.past(tmp_path, "h3_context", 5) == {}  # the gap rolls as before; these takes kept nothing
    assert sorted(film.takes(tmp_path, "h3_context")) == [0, 3, 4]
    grown = film.tree(tmp_path, "h3_context")
    assert grown["path"] == [a.name, None, None, gap.name, on.name]
    assert {t["folder"]: t["parent"] for t in grown["takes"]}[gap.name] is None  # a root of the tree
    mid = take(tmp_path, 1, n=18)  # the gap filled later: it continues clip 1, and the clips after the gap stay
    assert [(c["segment"], c["frames"]) for c in chain.listing(tmp_path, "h3_context")["clips"]] == [(0, 24), (1, 18), (3, 30), (4, 12)]
    assert film.held(tmp_path, "h3_context") == frozenset({0, 1, 3, 4})
    assert decoded(active_run(tmp_path) / "film.mp4")[0] == 84
    film.walk_to(tmp_path, "h3_context", a.name)  # a path from clip 1: a's walked path, the clips after the gap gone
    assert film.held(tmp_path, "h3_context") == frozenset({0, 1})
    assert film.walk_to(tmp_path, "h3_context", on.name)["clips"] == 5  # the root after the gap: the film before it stays
    assert film.tree(tmp_path, "h3_context")["path"] == [a.name, mid.name, None, gap.name, on.name]
    film.pick_take(tmp_path, "h3_context", 3, gap.name)
    assert film.end_film(tmp_path, "h3_context", 3) == {"clips": 4}
    assert film.tree(tmp_path, "h3_context")["path"] == [a.name, mid.name, None, gap.name]
    film.delete_take(tmp_path, "h3_context", 3, gap.name)  # its only take: the film ends before it, and before the gap
    assert film.tree(tmp_path, "h3_context")["path"] == [a.name, mid.name]


def test_an_after_reaches_its_clip_across_clips_never_made(tmp_path):
    """#415: a scene's AFTER: continues its clip though the clips between were never made (it asked for all of them)."""
    a = take(tmp_path, 0, fill=0.3)
    take(tmp_path, 1)
    assert (film.previous_tail(tmp_path, "h3_context", 6, 0).video == 0.3).all()  # clip 7 says AFTER: 1
    on = take(tmp_path, 6, continues=0)
    meta = json.loads((on / "meta.json").read_text())
    assert (meta["continues"], meta["after"]) == (0, a.name)
    assert film.held(tmp_path, "h3_context") == frozenset({0, 1, 6})


def test_a_take_names_the_scene_and_the_template_it_was_made_with(tmp_path):
    """#242: the tree and the takes under a clip tell a take made with another version of its scene."""
    take(tmp_path, 0, meta={"template": "0123456789abcdef", "chunk": 0})
    take(tmp_path, 0, n=26, meta={"template": "fedcba9876543210", "chunk": 0})
    listed = film.takes(tmp_path, "h3_context")[0]
    assert [(t["scene"], t["template"]) for t in listed] == [(0, "0123456789abcdef"), (0, "fedcba9876543210")]
    grown = film.tree(tmp_path, "h3_context")["takes"]
    assert [(t["scene"], t["template"]) for t in grown] == [(0, "0123456789abcdef"), (0, "fedcba9876543210")]


def test_the_past_comes_from_the_takes_on_the_films_path(tmp_path):
    """#261: what the clips before a segment rendered; a take from before takes kept it says nothing."""
    kept = {"bindings": {"hero": {"value": "fox", "fields": {}, "props": {}, "tags": []}}, "handoff": "the fox turns"}
    take(tmp_path, 0, meta={"chunk": 0, "kept": kept})
    take(tmp_path, 1, meta={"chunk": 1})  # an older take: nothing kept
    take(tmp_path, 2, meta={"chunk": 1, "kept": {"bindings": {}, "handoff": None}})
    assert film.past(tmp_path, "h3_context", 2) == {0: {"scene": 0, **kept}}
    assert film.past(tmp_path, "h3_context", 3) == {0: {"scene": 0, **kept}, 2: {"scene": 1, "bindings": {}, "handoff": None}}
    assert film.past(tmp_path, "h3_context", 0) == {} and film.past(tmp_path / "none", "h3_context", 2) == {}


def test_takes_list_in_the_order_they_were_saved_whatever_the_clock_says(tmp_path, monkeypatch):
    """#348: each take has its number in the run; a clock set back between two saves (WSL does) mixed them up. Takes from
    before the numbers come first, by when they were made."""
    from datetime import UTC, datetime, timedelta

    take(tmp_path, 0)
    old = take(tmp_path, 1)
    meta = json.loads((old / "meta.json").read_text())
    meta.pop("made", None)  # saved before takes had numbers
    (old / "meta.json").write_text(json.dumps(meta))
    start = datetime(2026, 10, 5, 12, tzinfo=UTC)

    class Back(datetime):  # every save a second earlier than the one before
        calls = 0

        @classmethod
        def now(cls, tz=None):
            cls.calls += 1
            return start - timedelta(seconds=cls.calls)

    monkeypatch.setattr(film, "datetime", Back)
    saved = [take(tmp_path, 1, n=24 + k) for k in range(3)]
    assert [t["folder"] for t in film.takes(tmp_path, "h3_context")[1]] == [old.name, *(p.name for p in saved)]
    assert [t["folder"] for t in film.tree(tmp_path, "h3_context")["takes"] if t["segment"] == 1] == [old.name, *(p.name for p in saved)]


def test_a_continued_take_ends_the_clip_before_as_its_decode_has_it(tmp_path):
    """#361: H3's VAE decodes a clip's last 5 frames without the blend into what follows, and the end of its sound
    without what follows; the next clip's decode has both, so the film plays them there. The takes stay as they were."""
    take(tmp_path, 0)
    continued = take(tmp_path, 1, seam=seam())
    assert len(reds(continued / "seam.mp4")) == film.DECODE_BLEND
    red = reds(active_run(tmp_path) / "film.mp4")
    assert len(red) == 48 and (red[:19] < 20).all() and (red[19:24] > 230).all() and (abs(red[24:] - 40) < 20).all()
    sound = sound_of(active_run(tmp_path) / "film.mp4")
    level = lambda a, b: np.sqrt(np.mean(np.square(sound[:, round(a * SR):round(b * SR)])))
    assert level(0.3, 0.7) > 0.05 and level(0.8, 0.97) < 0.01  # clip 1's sound, then its last 0.25 s as clip 2 decoded it
    assert (reds(chain.clip_file(tmp_path, "h3_context", 0))[19:] < 20).all()  # the take before keeps its own end


def test_a_seam_joins_only_after_the_take_it_was_decoded_with(tmp_path):
    take(tmp_path, 0)
    take(tmp_path, 1)
    take(tmp_path, 2, continues=0, seam=seam())  # AFTER: scene 1, in the film after scene 2's clip: a cut
    red = reds(active_run(tmp_path) / "film.mp4")
    assert len(red) == 72 and (abs(red[43:48] - 40) < 20).all()


def test_the_seams_sound_goes_over_in_a_straight_crossfade():
    """Both sides decode the same latent there: a straight crossfade keeps the level."""
    before, quarter, fade = np.full((2, SR), 0.5, np.float32), SR // 4, round(film.CROSSFADE * SR)
    film._patch(before, np.zeros((2, quarter), np.float32), SR)
    assert (before[:, :-quarter] == 0.5).all() and (before[:, -quarter + fade:] == 0).all()
    assert np.allclose(before[0, -quarter:-quarter + fade], np.linspace(0.5, 0, fade))


def test_the_level_eases_across_a_seam_as_continuums_seam_guard_does():
    """#362: a step of 6 dB or less comes 1.5 dB closer where the clip begins, and back to it over 60 ms; a bigger step
    is a new sound and stays."""
    t = np.arange(SR, dtype=np.float32) / SR
    tone = lambda a: (np.sin(2 * np.pi * 440 * t) * a)[None].repeat(2, 0)
    db = lambda x: 20 * np.log10(np.sqrt(np.mean(np.square(x))))
    before, after, probe, back = tone(0.1), tone(0.15), round(0.02 * SR), round(film.EASE_AFTER * SR)
    film._ease(before, after, SR)  # 3.5 dB louder after the seam
    assert db(after[:, :probe]) - db(tone(0.15)[:, :probe]) < -1.0 and (after[:, back:] == tone(0.15)[:, back:]).all()
    assert (before[:, :-round(film.EASE_BEFORE * SR)] == tone(0.1)[:, :-round(film.EASE_BEFORE * SR)]).all()
    before, after = tone(0.1), tone(0.5)  # 14 dB
    film._ease(before, after, SR)
    assert (after == tone(0.5)).all() and (before == tone(0.1)).all()


def test_film_takes_the_seam_from_the_continued_clips_decode(tmp_path, monkeypatch):
    """Orrery Film: the decoded frames 17 to 21 of a continued clip (the clip before's last 5, blended into this one)
    and its sound from the middle of the pinned frames to where the clip's own begins."""
    torch = pytest.importorskip("torch")
    import sys
    import types

    from orrery import comfy_film
    from orrery.continuum.masked import Tail as Pinned

    monkeypatch.setitem(sys.modules, "folder_paths", types.SimpleNamespace(get_output_directory=lambda: str(tmp_path)))
    api = types.ModuleType("comfy_api")
    api.latest = types.SimpleNamespace(InputImpl=types.SimpleNamespace(VideoFromFile=str))
    monkeypatch.setitem(sys.modules, "comfy_api", api)
    monkeypatch.setitem(sys.modules, "comfy_api.latest", api.latest)

    class Nested:  # a NestedTensor, as Film reads one
        is_nested = True

        def __init__(self, *parts):
            self.parts = parts

        def unbind(self):
            return self.parts

    rate, n = 32000, 39  # 39 frames: 12 latent slots, 65 ticks
    video, ticks = torch.zeros((1, 24, 12, 2, 4)), torch.zeros((1, 32, 2, 65))
    images = (torch.arange(n, dtype=torch.float32) / 64)[:, None, None, None].expand(n, 32, 64, 3)  # frame i: shade i/64
    wave = torch.arange(round(n / 24 * rate), dtype=torch.float32)[None, None].repeat(1, 2, 1)  # each sample its number
    for segment in (0, 1):
        info = {"segment": segment, "chain": "h3_context", "meta": {}}
        if segment:
            info |= {"continues": 0, "tail": Pinned(video[:, :, :7], ticks[..., :37], 0.0)}
        comfy_film.OrreryFilm().keep({"samples": Nested(video, ticks), comfy_film.KEY: info}, images,
                                     {"waveform": wave, "sample_rate": rate})
    continued = active_run(tmp_path) / json.loads((active_run(tmp_path) / "clips.json").read_text())["clips"][1]["folder"]
    start = round(22 / 24 * rate)
    assert np.array_equal(np.load(continued / "seam.npy"), wave[0, :, start // 2:start].numpy())
    assert np.allclose(reds(continued / "seam.mp4"), np.arange(17, 22) / 64 * 255, atol=3)
