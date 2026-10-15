"""Reels: one screenplay, one CHUNK per Motion Context clip. The head is the world and rolls
once; every segment rolls its chunk with its own seed, so a repeated chunk varies; `$x~N` is
x as it was N clips ago. `segment` (from 0) picks the clip to write."""

import re

import pytest

from orrery.h3 import compile_scene
from orrery.library import Entry, Library
from orrery.reel import ReelEnd, reel_path, split_reel

FOX = {"animal": Library("animal", [Entry("fox")])}
MANY = {"animal": Library("animal", [Entry(a) for a in ("fox", "heron", "owl", "lynx", "hare")])}

REEL = """@h3 t2va 16:9
style: live-action, cinematic
LORA: <lora:global:0.5>
$hero = __animal__

CHUNK the salon
LORA: <lora:first:1>
SHOT 5s: push in, slow
A $hero crosses a salon.
SFX: footsteps
HANDOFF: the $hero reaches the staircase

CHUNK
SHOT 4s: static
The $hero climbs the stairs.
SFX: creaking wood
SHOT 2s: cut
A landing with a tall window.
MUSIC: a slow cello line

CHUNK
SHOT 5s
A {red|blue} door opens.
SFX: a latch clicks
"""


def h3(src, seed=1, segment=0, libs=FOX):
    return compile_scene(src, seed, libs, target="h3-base", segment=segment)


def test_each_segment_writes_its_own_chunk():
    a, b = h3(REEL, segment=0), h3(REEL, segment=1)
    assert "crosses a salon" in a.text and "climbs the stairs" not in a.text
    assert "climbs the stairs" in b.text and "crosses a salon" not in b.text
    assert (a.chunks, b.chunks, b.segment) == (3, 3, 1)


def test_bindings_roll_once_for_the_whole_reel():
    for seed in range(6):
        heroes = {tuple(p.value for p in h3(REEL, seed, k, MANY).picks if p.label.startswith("$hero"))
                  for k in range(3)}
        assert len(heroes) == 1


def test_a_handoff_closes_one_chunk_and_opens_the_next():
    assert "The shot ends as the fox reaches the staircase." in h3(REEL, segment=0).text
    assert ("[Shot 1] Live-action, cinematic. The shot opens as the fox reaches the staircase. "
            "The camera holds a static shot. The fox climbs the stairs.") in h3(REEL, segment=1).text
    assert "staircase" not in h3(REEL, segment=2).text


def test_later_chunks_add_the_pinned_context_to_shot_1():
    assert h3(REEL, segment=0).scene.duration == 5
    b = h3(REEL, segment=1)
    assert b.scene.duration == pytest.approx(6 + 22 / 24)
    assert "[Shot 2] At 00:04.917, the camera cuts to a landing" in b.text
    assert h3(REEL.replace("$hero =", "context: 39\n$hero ="), segment=1).scene.duration == pytest.approx(6 + 39 / 24)
    assert h3(REEL.replace("$hero =", "context: 0\n$hero ="), segment=1).scene.duration == 6


def test_loras_are_the_global_ones_plus_the_chunk():
    assert h3(REEL, segment=0).loras == "<lora:global:0.5> <lora:first:1>"
    assert h3(REEL, segment=1).loras == "<lora:global:0.5>"
    assert "lora" not in h3(REEL, segment=0).text


def test_music_belongs_to_its_chunk():
    assert h3(REEL, segment=1).text.endswith("non_diegetic_music: A slow cello line.")
    assert h3(REEL, segment=2).text.endswith("non_diegetic_music: N/A")


def test_picks_belong_to_the_chunk_they_came_from():
    labels = lambda k: {p.label for p in h3(REEL, segment=k).picks}
    assert labels(2) == {"$hero ← __animal__", "{red|blue}"}
    assert labels(0) == {"$hero ← __animal__"}


def test_a_segment_past_the_end_is_a_clear_error():
    with pytest.raises(ValueError, match="3 clips"):
        h3(REEL, segment=3)


def test_plain_scenes_take_loras_and_ignore_the_segment():
    src = "@h3 t2va\nCAST\nMAYA: a woman\nLORA: <lora:a:1>\nSHOT 5s\nMAYA waves.\nSFX: x\n"
    r = h3(src, segment=4)
    assert (r.loras, r.chunks) == ("<lora:a:1>", 0)
    assert not [i for i in r.lint if "CAST" in i.message] and "lora" not in r.text


def test_lora_lines_keep_names_with_double_underscores():
    r = h3("@h3 t2va\nLORA: <lora:bf16__apply_to_fl2va__toward:1.00>\nSHOT 5s\nA.\nSFX: x\n")
    assert r.loras == "<lora:bf16__apply_to_fl2va__toward:1.00>"



# --- repeat and history ------------------------------------------------------------------------

LOOP = """@h3 t2va
$venue = {pool|garage|greenhouse|salt flat}
CHUNK intro
$n = {1|2|3|4|5|6|7|8|9}
SHOT 5s
Intro at the $venue, N$n.
SFX: x
HANDOFF: door $n opens
CHUNK walk repeat 3
$n = {1|2|3|4|5|6|7|8|9}
SHOT 5s
Walk at the $venue, N$n P$n~1 Q$n~2.
SFX: y
HANDOFF: door $n opens
CHUNK outro
SHOT 5s
Outro at the $venue, last P$n~1.
SFX: z
"""


def number(text, tag):
    m = re.search(rf"\b{tag}(\d)", text)
    return m and m.group(1)


def test_repeats_count_as_segments():
    assert split_reel(LOOP).segments == 5
    assert ["Intro" in h3(LOOP, segment=0).text, *("Walk at" in h3(LOOP, segment=k).text for k in (1, 2, 3)),
            "Outro" in h3(LOOP, segment=4).text] == [True] * 5
    with pytest.raises(ValueError, match="5 clips"):
        h3(LOOP, segment=5)


def test_the_world_holds_and_every_segment_rolls_its_chunk_anew():
    for seed in range(1, 6):
        texts = [h3(LOOP, seed, k).text for k in range(5)]
        assert len({re.search(r"at the (\w+ ?\w*),", t).group(1) for t in texts}) == 1
        assert len({number(t, "N") for t in texts[:4]}) > 1, seed


def test_history_looks_back_n_clips_and_clamps_at_the_first():
    for seed in range(1, 6):
        t = [h3(LOOP, seed, k).text for k in range(5)]
        n = [number(x, "N") for x in t]
        assert [number(t[k], "P") for k in (1, 2, 3)] == [n[0], n[1], n[2]]
        assert [number(t[k], "Q") for k in (1, 2, 3)] == [n[0], n[0], n[1]]
        assert number(t[4], "P") == n[3]


def test_a_repetition_opens_with_the_handoff_of_the_clip_before():
    t = [h3(LOOP, 2, k).text for k in range(4)]
    for k in (1, 2, 3):
        assert f"The shot opens as door {number(t[k - 1], 'N')} opens." in t[k]


def test_forever_repeats_without_end_and_chunks_after_it_warn():
    forever = LOOP.replace("repeat 3", "repeat forever")
    assert split_reel(forever).segments is None
    far = h3(forever, segment=57)
    assert "Walk at" in far.text and far.segment == 57
    assert any("never" in i.message for i in far.lint)
    assert h3(forever, 3, 9).text == h3(forever, 3, 9).text


def test_a_property_of_an_earlier_clip_is_read_with_its_history():
    """An endless tour: this clip opens the threshold the last one ended on ($thr~1.open)."""
    from orrery.library import Entry, Library
    libs = {"thr": Library("thr", [Entry("velvet curtains", props=(("open", "the curtains part"),)),
                                   Entry("mirrored doors", props=(("open", "the mirrored doors swing inward"),))])}
    src = ("@h3 t2va 16:9\nCHUNK the tour repeat forever\n$thr = __thr__\nSHOT 5s\n"
           "Opening: $thr~1.open. Ending before $thr.\nSFX: footsteps\n")
    for seg in (1, 2, 3):
        now = compile_scene(src, 5, libs, segment=seg).text
        before = compile_scene(src, 5, libs, segment=seg - 1).text
        ended = "velvet curtains" if "before velvet curtains" in before else "mirrored doors"
        assert ("the curtains part" if ended == "velvet curtains" else "the mirrored doors swing inward") in now


# --- SEND: frames of a clip as reference images for later clips -------------------------------

SEND_REEL = """@h3 ref2va 16:9 lite
style: live-action, cinematic
CAST
GIRL (image 1, image 3): the young woman, in a pink tracksuit

CHUNK the pose repeat 2
SHOT 5s: push in, slow
GIRL stretches on a mat.
SEND: frame 0 to image 3
SEND: frames 2, 5, 34-36 to image 4

CHUNK the walk
SHOT 4s: static
GIRL walks to the window.
"""


def ref2va(src, segment=0):
    return compile_scene(src, 1, {}, target="h3-base", segment=segment, packed=True)


def test_send_lines_belong_to_their_chunk_and_list_frames_in_order():
    from orrery.reel import Send
    reel = split_reel(SEND_REEL)
    assert reel.blocks[0].sends == [Send([[0, 0]], 3), Send([[2, 2], [5, 5], [34, 36]], 4)]
    assert not any("SEND" in line for block in reel.blocks for line in block.lines)
    assert reel.send_slots == [3, 4]


def test_a_sent_image_exists_from_the_segment_after_its_chunk_first_plays():
    reel = split_reel(SEND_REEL)
    assert reel.ready(0) == {}
    first = {3: {"segment": 0, "frames": [[0, 0]]}, 4: {"segment": 0, "frames": [[2, 2], [5, 5], [34, 36]]}}
    assert reel.ready(1) == first  # the chunk's second repetition still sends its first clip
    assert reel.ready(2) == first


def test_before_it_exists_a_sent_image_is_left_out_of_the_clip():
    before = ref2va(SEND_REEL, segment=0)
    assert before.refs == [1]
    assert "<Subject 1> = the young woman of <Picture 1>, in a pink tracksuit" in before.text
    assert "<Picture 2>" not in before.text
    after = ref2va(SEND_REEL, segment=2)
    assert after.refs == [1, 3, 4]  # image 4 is sent but named by nothing: it follows the ones the prompt uses
    assert "<Picture 1> and <Picture 2>" in after.text
    assert after.sends == {3: {"segment": 0, "frames": [[0, 0]]}, 4: {"segment": 0, "frames": [[2, 2], [5, 5], [34, 36]]}}
    assert after.send_slots == [3, 4]


def test_a_frame_anchor_on_a_sent_image_waits_for_it():
    full = SEND_REEL.replace(" lite", " full")
    later = full.replace("SHOT 4s: static", "SHOT 4s: from image 3, static")
    assert "<Picture 2> is the first frame of [Shot 1]" in ref2va(later, segment=2).text
    early = full.replace("SHOT 5s: push in, slow", "SHOT 5s: from image 3, push in, slow")
    assert "first frame" not in ref2va(early, segment=0).text


def test_a_bracket_before_its_image_exists_is_flagged():
    src = SEND_REEL.replace("GIRL stretches on a mat.", "GIRL stretches like in [image 3].")
    lint = [i.message for i in ref2va(src, segment=0).lint]
    assert any("[image 3]" in m and "REMEMBER" in m for m in lint)


@pytest.mark.parametrize("line, words", [
    ("SEND: frames 5-2 to image 3", "5-2"),
    ("SEND: frames a, 2 to image 3", "a"),
    ("SEND: frame 0 to image 10", "1–9"),
    ("SEND: frame 0 to picture 3", "image N"),
    ("SEND: frame to image 3", "frame"),
    ("SEND: frame 0 to refmod", "refmod NAME"),
    ("SEND: every 0 frames to refmod jinx_look", "every 0 frames"),
])
def test_malformed_send_lines_are_clear_errors(line, words):
    with pytest.raises(ValueError, match=re.escape(words)):
        split_reel(SEND_REEL.replace("SEND: frame 0 to image 3", line))


def test_two_sends_to_one_image_warn_and_the_later_takes_over():
    src = SEND_REEL.replace("GIRL walks to the window.", "GIRL walks to the window.\nSEND: frame 9 to image 3")
    assert split_reel(src).ready(3)[3] == {"segment": 2, "frames": [[9, 9]]}
    lint = [i.message for i in ref2va(src, segment=2).lint]
    assert any("image 3" in m and "from clip 4 on" in m and '("frame 9 to image 3" in SCENE 2) takes over' in m
               for m in lint)


MOD_REEL = """@h3 t2va 16:9
CAST
JINX (refmod jinx_look): a young woman
CHUNK the outfit
SHOT 5s: static
JINX shows her outfit and walks out.
SEND: every 10 frames to refmod jinx_look
CHUNK the room
SHOT 5s: static
The empty room.
CHUNK the return
SHOT 5s: static
JINX slides back in.
"""


def test_frames_sent_to_a_refmod_become_it_from_the_clip_after():
    from orrery.reel import Send
    reel = split_reel(MOD_REEL)
    assert reel.blocks[0].sends == [Send([[0, -1]], None, refmod="jinx_look", step=10)]
    assert (reel.send_slots, reel.send_refmods) == ([], ["jinx_look"])
    first, _, back = (compile_scene(MOD_REEL, 1, {}, segment=s) for s in range(3))
    assert first.refmods == []  # its chunk has not played yet: nothing to bring back (and no ref2va needed)
    assert back.refmods == [{"name": "jinx_look", "member": "JINX", "strength": 1.0, "from": 0.0, "to": 1.0,
                             "sent": {"segment": 0, "frames": [[0, -1]], "step": 10}}]
    picked = split_reel(MOD_REEL.replace("every 10 frames", "frames 0, 24-48")).blocks[0].sends[0]
    assert (picked.frames, picked.step) == ([[0, 0], [24, 48]], 1)


def test_two_sends_to_one_refmod_warn_and_the_later_takes_over():
    src = MOD_REEL.replace("The empty room.", "The empty room.\nSEND: frame -1 to refmod jinx_look")
    assert split_reel(src).refmods_ready(2)["jinx_look"] == {"segment": 1, "frames": [[-1, -1]]}
    lint = [i.message for i in compile_scene(src, 1, {}, segment=2).lint]
    assert any("refmod jinx_look is filled by two REMEMBER: lines" in m and '" in SCENE 2) takes over' in m for m in lint)


def test_send_outside_a_reel_or_outside_ref2va_is_an_error():
    plain = "@h3 ref2va 16:9\nSHOT 5s\nA fox.\nSEND: frame 0 to image 3\n"
    with pytest.raises(ValueError, match="inside a SCENE"):
        ref2va(plain)
    t2va = SEND_REEL.replace("@h3 ref2va 16:9 lite", "@h3 t2va 16:9")
    with pytest.raises(ValueError, match="@h3 references"):
        ref2va(t2va)


def test_without_a_cast_a_sent_image_still_reaches_the_refs():
    """ref_1 of every clip after the first is the first clip's frame 0, named in the prompt or not."""
    src = ("@h3 ref2va 2:3\nCHUNK a\nSHOT 5s\nA girl stretches.\nSEND: frame 0 to image 1\n"
           "CHUNK b\nSHOT 5s\nShe walks.\nCHUNK c\nSHOT 5s\nShe turns.\n")
    assert ref2va(src, segment=0).refs == []
    assert ref2va(src, segment=1).refs == [1] and ref2va(src, segment=2).refs == [1]
    assert "<Picture" not in ref2va(src, segment=1).text


def test_negative_frames_count_from_the_end_and_ranges_may_mix_signs():
    from orrery.reel import Send, parse_send
    assert parse_send("frame -1 to image 5") == Send([[-1, -1]], 5)
    assert parse_send("frames -24--1, 10--1, 3 to image 6") == Send([[-24, -1], [10, -1], [3, 3]], 6)
    with pytest.raises(ValueError, match="-1--5"):
        parse_send("frames -1--5 to image 6")


def test_for_segment_takes_numbers_ranges_and_a_plus():
    from orrery.reel import parse_send
    assert parse_send("frame 0 to image 5 for segment 4+").segments == [[4, None]]
    assert parse_send("frame 0 to image 5 for segments 4, 6, 7, 12").segments == [[4, 4], [6, 6], [7, 7], [12, 12]]
    assert parse_send("frame 0 to image 5 for segments 2, 4-8, 12+").segments == [[2, 2], [4, 8], [12, None]]
    assert parse_send("frame 0 to image 5").segments is None
    for bad, words in (("for segment 8-4", "8-4"), ("for segment x", '"x"'), ("for segments", "segment")):
        with pytest.raises(ValueError, match=re.escape(words)):
            parse_send(f"frame 0 to image 5 {bad}")


REANCHOR = """@h3 ref2va 16:9 lite
CAST
GIRL (image 1, image 3): the young dancer
CHUNK the old look repeat 4
SHOT 5s: static
GIRL dances.
SEND: frame 0 to image 3 for segments 1-4
CHUNK the new look
SHOT 5s: static
GIRL changes her outfit.
SEND: frame -1 to image 3 for segment 5+
CHUNK the finale repeat forever
SHOT 5s: static
GIRL bows.
"""


@pytest.mark.parametrize("then, now", [
    ("SEND: frame 0 to image 3", "REMEMBER: first frame as image 3"),
    ("SEND: frame 0 to image 3", "REMEMBER: frame 0 as image 3"),
    ("SEND: frame -1 to image 3", "REMEMBER: last frame as image 3"),
    ("SEND: frame 24 to image 3", "REMEMBER: frame at 1s as image 3"),
    ("SEND: frames 24-48 to image 3", "REMEMBER: frames 1s-2s as image 3"),
    ("SEND: frame 0 to image 3 for segments 1-4", "REMEMBER: first frame as image 3 in clips 2-5"),
    ("SEND: frame 0 to image 3 for segment 2+", "REMEMBER: first frame as image 3 in clips 3+"),
    ("SEND: frame 0 to image 1", "REMEMBER: first frame as @GIRL"),  # the first picture her CAST line gives her
])
def test_remember_keeps_what_send_sent(then, now):
    a, b = split_reel(SEND_REEL), split_reel(SEND_REEL.replace("SEND: frame 0 to image 3", now))
    if then != "SEND: frame 0 to image 3":
        a = split_reel(SEND_REEL.replace("SEND: frame 0 to image 3", then))
    for t in range(6):
        assert b.ready(t) == a.ready(t), (t, now)
    if now.endswith("@GIRL"):
        assert b.blocks[0].sends[0].image == 1


def test_remember_every_nth_frame_of_a_range_as_a_refmod():
    reel = split_reel(SEND_REEL.replace("SEND: frame 0 to image 3", "REMEMBER: every 5th frame of 1s-2s as refmod girl_walk"))
    kept = reel.blocks[0].sends[0]
    assert (kept.frames, kept.step, kept.refmod) == ([[24, 48]], 5, "girl_walk") and reel.send_refmods == ["girl_walk"]
    assert reel.refmods_ready(2)["girl_walk"] == {"segment": 0, "frames": [[24, 48]], "step": 5}


def test_remember_until_a_scene_stops_before_its_first_clip():
    reel = split_reel(SEND_REEL.replace("SEND: frame 0 to image 3", "REMEMBER: first frame as image 3 until the walk"))
    assert [3 in reel.ready(t) for t in range(4)] == [False, True, False, False]  # the walk is clip 3
    with pytest.raises(ValueError, match="no SCENE is called 'the hall'"):
        split_reel(SEND_REEL.replace("SEND: frame 0 to image 3", "REMEMBER: first frame as image 3 until the hall"))


def test_remember_as_a_member_without_a_picture_gives_the_member_a_free_one():
    src = SEND_REEL.replace("in a pink tracksuit\n", "in a pink tracksuit\nDOG: a grey dog\n").replace(
        "SEND: frame 0 to image 3", "REMEMBER: last frame as @DOG").replace("GIRL walks to the window.", "GIRL walks to the window. DOG follows.")
    reel = split_reel(src)
    assert reel.blocks[0].sends[0].image == 2  # images 1, 3 and 4 are taken
    assert any(line.strip() == "DOG (image 2): a grey dog" for line in reel.head)
    walk = ref2va(src, segment=2)
    assert 2 in walk.sends and "<Picture" in walk.text
    with pytest.raises(ValueError, match="CAT is not in a CAST"):
        split_reel(SEND_REEL.replace("SEND: frame 0 to image 3", "REMEMBER: first frame as @CAT"))
    with pytest.raises(ValueError, match="not as \"the moon\""):
        split_reel(SEND_REEL.replace("SEND: frame 0 to image 3", "REMEMBER: first frame as the moon"))


def test_frames_listed_as_a_member_give_her_one_picture_each():
    mine = lambda src: [s for s in split_reel(src).blocks[0].sends if s.member]
    src = SEND_REEL.replace("SEND: frame 0 to image 3", "REMEMBER: frames 0, 50 as @GIRL")
    assert [(s.frames, s.image, s.nth) for s in mine(src)] == [([[0, 0]], 1, 0), ([[50, 50]], 3, 1)]  # her CAST's two
    walk = ref2va(src, segment=2)
    assert {1, 3} <= set(walk.sends)
    dog = SEND_REEL.replace("in a pink tracksuit\n", "in a pink tracksuit\nDOG: a grey dog\n").replace(
        "SEND: frame 0 to image 3", "REMEMBER: frames 0, 50 as @DOG").replace("walks to the window.", "walks to the window. DOG follows.")
    assert [s.image for s in mine(dog)] == [2, 5]  # none in his CAST: free ones (1 and 3 are hers, 4 the SEND's)
    assert any(line.strip() == "DOG (image 2, image 5): a grey dog" for line in split_reel(dog).head)
    assert {2, 5} <= set(ref2va(dog, segment=2).sends)
    kept = mine(SEND_REEL.replace("SEND: frame 0 to image 3", "REMEMBER: frames 0-5, 50 as @GIRL"))
    assert [s.frames for s in kept] == [[[0, 5]], [[50, 50]]]  # a range stays one picture, a batch
    for line, n in (("REMEMBER: frames 0, 50 as image 3", 2), ("REMEMBER: every 10th frame as @GIRL", 2)):
        assert len(split_reel(SEND_REEL.replace("SEND: frame 0 to image 3", line)).blocks[0].sends) == n  # and the SEND


def test_two_lines_as_one_member_share_her_picture_and_the_lint_names_them():
    src = SEND_REEL.replace("SEND: frame 0 to image 3", "REMEMBER: frame 0 as @GIRL\nREMEMBER: frame 50 as @GIRL")
    assert [s.image for s in split_reel(src).blocks[0].sends if s.member] == [1, 1]
    lint = [i.message for i in ref2va(src, segment=1).lint]
    assert any('("frame 0 as @GIRL" in SCENE 1 and "frame 50 as @GIRL" in SCENE 1)' in m
               and '("frame 50 as @GIRL" in SCENE 1) takes over' in m for m in lint)


def test_each_remember_line_knows_its_place_and_what_replaces_it():
    from orrery.reel import remembered

    src = SEND_REEL.replace("SEND: frame 0 to image 3", "REMEMBER: frame 0 as @GIRL\nREMEMBER: frames 10, 50 as @GIRL")
    reel = split_reel(src)
    lines = remembered(reel, reel.starts())
    assert [line["line"] for line in lines] == list(range(len(lines)))
    first, second = lines[0], lines[1]
    assert first["source"] == 0 and first["said"] == "frame 0 as @GIRL"
    assert first["fills"][0]["replaced"] == {"from": 1, "by": 1}
    assert [f["what"] for f in second["fills"]] == ["image 1", "image 3"] and second["fills"][1]["replaced"] is None


def test_a_wired_picture_stands_in_until_the_frames_kept_for_it_exist():
    then, now = (compile_scene(SEND_REEL, 1, {}, target="h3-base", segment=0, packed=True, standing=s) for s in ((), {3}))
    assert then.refs == [1] and now.refs == [1, 3]  # wired: the picture is there before the frames are
    assert any("image 3 is wired and kept by a REMEMBER: line too: the wired picture until" in i.message for i in now.lint)
    later = compile_scene(SEND_REEL, 1, {}, target="h3-base", segment=2, packed=True, standing={3})
    assert 3 in later.sends and any("frames from clip 1 replace the wired picture" in i.message for i in later.lint)


def test_an_image_exists_only_in_the_segments_its_send_lists():
    reel = split_reel(SEND_REEL.replace("SEND: frame 0 to image 3", "SEND: frame 0 to image 3 for segment 2+"))
    assert 3 not in reel.ready(1) and reel.ready(2)[3] == {"segment": 0, "frames": [[0, 0]]}
    picked = split_reel(SEND_REEL.replace("SEND: frame 0 to image 3", "SEND: frame 0 to image 3 for segments 1, 3"))
    assert [3 in picked.ready(t) for t in range(5)] == [False, True, False, True, False]


def test_several_sends_may_fill_one_image_in_different_segments():
    reel = split_reel(REANCHOR)
    assert reel.send_slots == [3]
    assert [reel.ready(t).get(3, {}).get("segment") for t in range(8)] == [None, 0, 0, 0, 0, 4, 4, 4]
    assert reel.ready(6)[3]["frames"] == [[-1, -1]]
    assert ref2va(REANCHOR, segment=0).refs == [1] and ref2va(REANCHOR, segment=6).refs == [1, 3]


def test_two_sends_claiming_one_segment_for_one_image_hand_over_to_the_later():
    clash = REANCHOR.replace("for segments 1-4", "for segments 1-5")
    assert [split_reel(clash).ready(t)[3]["segment"] for t in (4, 5, 6)] == [0, 4, 4]
    lint = [i.message for i in ref2va(clash, segment=5).lint]
    assert any("from clip 6 on" in m and '" in SCENE 2) takes over' in m for m in lint)
    assert not any("takes over" in i.message for i in ref2va(REANCHOR, segment=5).lint)


def test_a_listed_segment_before_the_frame_exists_is_flagged():
    src = SEND_REEL.replace("GIRL walks to the window.", "GIRL walks to the window.\nSEND: frame 0 to image 5 for segment 1+")
    lint = [i.message for i in ref2va(src, segment=0).lint]
    assert any("image 5" in m and "clip 2" in m for m in lint)


def test_a_held_image_exists_from_segment_0_within_its_for_list():
    reel = split_reel(SEND_REEL.replace("SEND: frame 0 to image 3", "SEND: frame 0 to image 3 for segment 2+"))
    assert reel.ready(0, held={3, 4}) == {4: {"held": True}}
    assert reel.ready(2, held={3})[3] == {"held": True}
    held = compile_scene(SEND_REEL, 1, {}, target="h3-base", segment=0, packed=True, held={3})
    assert held.refs == [1, 3] and "<Picture 1> and <Picture 2>" in held.text and held.sends == {3: {"held": True}}


def test_a_field_of_the_reels_head_is_the_same_in_every_clip():
    from orrery.h3 import compile_scene
    from orrery.library import Entry, Library

    libs = {"pose": Library("pose", [Entry("bend", props=(("action", "a {deep|full|slow|wide} backbend"),))])}
    reel = "@h3 t2va\n$p = __pose__\nCHUNK a repeat 4\nSHOT 5s: static\nShe holds $p.action."
    shown = {compile_scene(reel, 9, libs, segment=k).scene.shots[0].items[0].split(" holds ")[1] for k in range(4)}
    assert len(shown) == 1



# --- GOTO (docs/plan-dsl-2.md, phase 8) ------------------------------------------------------

GOTO_REEL = """@h3 t2va
CHUNK the gate
SHOT 5s: static
The keeper opens the gate.
CHUNK the stairs
SHOT 5s: tracking
The keeper climbs.
HANDOFF: the keeper reaches the landing
CHUNK the lamp
SHOT 5s: push in
The keeper lights the lamp.
HANDOFF: the beam sweeps the sea
GOTO: the stairs ×2
"""


def test_goto_loops_back_n_times_then_goes_on():
    reel = split_reel(GOTO_REEL)
    assert [b for b, _ in reel.walk()[0]] == [0, 1, 2, 1, 2, 1, 2] and reel.segments == 7
    assert split_reel(GOTO_REEL.replace("GOTO: the stairs ×2", "GOTO: 2 x1")).segments == 5  # a number, an x
    endless = split_reel(GOTO_REEL.replace(" ×2", ""))
    assert endless.segments is None and [b for b, _ in endless.walk(upto=6)[0]] == [0, 1, 2, 1, 2, 1]
    with pytest.raises(ValueError, match="no SCENE is called 'the cellar'"):
        split_reel(GOTO_REEL.replace("the stairs ×2", "the cellar"))


FILM_WORDS = {"@h3 t2va": "@h3 text", "CHUNK": "SCENE", "HANDOFF:": "END ON:", "GOTO:": "CUT TO:"}


def film(src: str) -> str:
    for old, new in FILM_WORDS.items():
        src = src.replace(old, new)
    return src


def test_the_film_words_compile_what_the_earlier_words_compile():
    for reel in (REEL, GOTO_REEL):
        assert split_reel(film(reel)).walk() == split_reel(reel).walk()
        for segment in range(3 if reel is REEL else 7):
            then, now = (compile_scene(src, 5, MANY, target="h3-base", segment=segment) for src in (reel, film(reel)))
            assert (now.text, now.picks, now.lint) == (then.text, then.picks, then.lint)


@pytest.mark.parametrize("then, now", [("CHUNK the turn repeat 3", "SCENE the turn ×3"),
                                       ("CHUNK the turn repeat 3", "SCENE the turn x3"),
                                       ("CHUNK the turn repeat forever", "SCENE the turn forever"),
                                       ("CHUNK repeat 2", "SCENE ×2")])
def test_a_scene_repeats_n_times_or_forever(then, now):
    blocks = [split_reel(f"@h3 t2va\n{head}\nSHOT 5s\nA fox.\n").blocks for head in (then, now)]
    assert [(b.title, b.repeat) for b in blocks[1]] == [(b.title, b.repeat) for b in blocks[0]]
    assert [(b.title, b.repeat) for b in split_reel("@h3 text\nSCENE the 4x4 room\nSHOT 5s\nA fox.\n").blocks] == [
        ("the 4x4 room", 1)]  # an x inside the title is no repeat


BRANCHES = """@h3 references 16:9 lite
CAST
GIRL (image 1, image 3): the young woman
SCENE the room
$light = {dawn|noon|dusk|night}
SHOT 5s: static
GIRL waits in the $light light.
END ON: the girl looks at the door
SCENE the door
$light = {dawn|noon|dusk|night}
SHOT 5s: static
GIRL opens the door in the $light light.
SEND: frame 0 to image 3
END ON: the door stands open
SCENE case A
AFTER: the door
SHOT 5s: static
GIRL steps out, as before $light~1.
SEND: frame 0 to image 4
END ON: case A ends
SCENE case B
AFTER: 2
SHOT 5s: static
GIRL steps out, as before $light~1.
"""


def test_scenes_after_one_scene_each_continue_its_clip():
    reel = split_reel(BRANCHES)
    path, _ = reel.walk()
    assert [reel.before(t, path) for t in range(4)] == [None, 0, 1, 1] and reel.chain(3, path) == [1, 0]
    a, b, door = (compile_scene(BRANCHES, 4, {}, target="h3-base", segment=t) for t in (2, 3, 1))
    light = re.search(r"in the (\w+) light", door.text).group(1)
    for clip in (a, b):  # both open on the door's END ON:, and $light~1 is the door's light
        assert "opens as the door stands open" in clip.text and f"as before {light}" in clip.text
    assert "case A ends" not in b.text
    assert 3 in reel.ready(3, path=path) and 4 not in reel.ready(3, path=path)  # case A's send stays in case A's branch


def test_a_test_scene_starts_afresh_and_its_memory_reaches_the_clips_after_it():
    tested = BRANCHES.replace("SCENE case B\nAFTER: 2", "SCENE case B (test)")
    reel = split_reel(tested)
    path, _ = reel.walk()
    assert reel.blocks[3].test and reel.blocks[3].title == "case B" and reel.before(3, path) is None
    assert set(reel.ready(3, path=path)) == {3, 4}  # what the door and case A sent, in the order they played
    then, now = (compile_scene(src, 4, {}, target="h3-base", segment=3) for src in (BRANCHES, tested))
    assert "opens as" in then.text and "opens as" not in now.text
    assert now.scene.duration == 5 and then.scene.duration > 5  # no pinned context
    assert (now.continues, now.test, then.continues, then.test) == (None, True, 1, False)


def test_a_clip_whose_clip_before_is_not_in_the_film_starts_afresh():
    """#415: a scene rolled before the clip it continues was made opens as the first clip does: no END ON: before
    it, no pinned context in its length, and what clips not in the film would send is left out."""
    src = """@h3 references 16:9 lite
CAST
GIRL (image 1, image 3): the young woman
SCENE the forest
SHOT 5s: static
GIRL stands in a forest.
SEND: frame 0 to image 3
END ON: the girl stops by a tree
SCENE the beach
SHOT 5s: static
GIRL walks on a beach.
SEND: frame 0 to image 3
END ON: the girl sits down
SCENE the end
SHOT 5s: static
GIRL waves.
"""
    known = compile_scene(src, 1, {}, target="h3-base", segment=2)  # the film not known (the CLI): as written
    held = compile_scene(src, 1, {}, target="h3-base", segment=2, film=frozenset({0, 1}))
    gap = compile_scene(src, 1, {}, target="h3-base", segment=2, film=frozenset({0}))
    alone = compile_scene(src, 1, {}, target="h3-base", segment=2, film=frozenset())
    for clip in (known, held):
        assert clip.continues == 1 and "The shot opens as the girl sits down" in clip.text and clip.scene.duration > 5
        assert clip.sends[3]["segment"] == 1  # the beach's frames, sent last
    for clip in (gap, alone):
        assert clip.continues is None and "opens as" not in clip.text and clip.scene.duration == 5
    assert gap.sends[3]["segment"] == 0  # the beach was never made: the forest's frames, which are in the film
    assert 3 not in alone.sends  # nothing in the film sends anything
    first = compile_scene(src, 1, {}, target="h3-base", segment=0, film=frozenset())
    assert first.continues is None and "opens as" not in first.text  # the first clip, as ever
    after = src.replace("SCENE the end\n", "SCENE the end\nAFTER: the forest\n")
    branch = compile_scene(after, 1, {}, target="h3-base", segment=2, film=frozenset({1}))
    assert branch.continues is None and "opens as" not in branch.text  # AFTER: a scene whose clip is not in the film


def test_scenes_after_test_scenes_continue_the_film_and_remember_the_tests():
    src = """@h3 references 16:9 lite
CAST
GIRL (image 1, image 3): the young woman
SCENE the forest (test) ×2
SHOT 5s: static
A forest.
SEND: frame 0 to image 3
END ON: the forest is still
SCENE the beach (test)
AFTER: the forest
SHOT 5s: static
A beach.
SCENE the walk
SHOT 5s: static
GIRL walks.
END ON: the girl stops
SCENE the end
SHOT 5s: static
GIRL waves.
"""
    reel = split_reel(src)
    path, _ = reel.walk()
    assert [(b.title, b.test, b.repeat) for b in reel.blocks[:2]] == [("the forest", True, 2), ("the beach", True, 1)]
    assert [reel.before(t, path) for t in range(5)] == [None, 0, 1, None, 3]  # a test repeats and AFTER: as any
    assert 3 in reel.ready(3, path=path) and 3 in reel.ready(4, path=path)
    walk = compile_scene(src, 1, {}, target="h3-base", segment=3)
    assert "opens as" not in walk.text and walk.continues is None and not walk.test


def test_after_names_a_scene_that_played_and_a_repeat_continues_itself():
    with pytest.raises(ValueError, match="no SCENE is called 'the hall'"):
        split_reel(BRANCHES.replace("AFTER: 2", "AFTER: the hall"))
    with pytest.raises(ValueError, match="cannot continue itself"):
        split_reel(BRANCHES.replace("AFTER: 2", "AFTER: case B"))
    later = BRANCHES.replace("AFTER: the door", "AFTER: case B")
    with pytest.raises(ValueError, match="has not played before clip 3"):
        compile_scene(later, 4, {}, target="h3-base", segment=2)
    twice = split_reel(BRANCHES.replace("SCENE case B", "SCENE case B ×2"))
    assert [twice.before(t, twice.walk()[0]) for t in (3, 4)] == [1, 3]
    assert any("AFTER: only works inside a SCENE" in i.message
               for i in compile_scene("@h3 text\nAFTER: 2\nSHOT 5s\nA fox.", 1, {}).lint)


def test_start_with_opens_a_scene_in_its_own_words_and_the_next_still_opens_on_its_end():
    src = film(GOTO_REEL).replace("SCENE the stairs\n", "SCENE the stairs\nSTART WITH: the door bursts open\n")
    stairs, lamp = (compile_scene(src, 1, {}, target="h3-base", segment=t).text for t in (1, 2))
    assert "The shot opens as the door bursts open" in stairs and "opens as the keeper" not in stairs
    assert "The shot opens as the keeper reaches the landing" in lamp
    first = compile_scene(src.replace("SCENE the gate\n", "SCENE the gate\nSTART WITH: dawn breaks\n"), 1, {}, target="h3-base")
    assert "The shot opens as dawn breaks" in first.text  # the first clip too
    assert any("START WITH: only works inside a SCENE" in i.message
               for i in compile_scene("@h3 text\nSTART WITH: x\nSHOT 5s\nA fox.", 1, {}).lint)


def test_a_cut_with_a_chance_holds_that_often_and_each_seed_its_own_way():
    story = film(GOTO_REEL).replace("CUT TO: the stairs ×2", "CUT TO: the stairs (50%) ×3")
    reel = split_reel(story)
    assert reel.jumps_on_rolls and reel.blocks[2].gotos[0].chance == 0.5 and reel.segments is None
    lengths = [len(reel_path(reel, seed, {}, None)[0]) for seed in range(200)]
    assert set(lengths) <= {3, 5, 7, 9} and lengths.count(3) in range(70, 131)  # no jump about every other seed
    assert lengths == [len(reel_path(reel, seed, {}, None)[0]) for seed in range(200)]  # the same seed, the same story
    either = story.replace("CUT TO: the stairs (50%) ×3", "CUT TO: the gate (30%)\nCUT TO: the stairs (100%) ×1")
    firsts = {reel_path(split_reel(either), seed, {}, None)[0][3][0] for seed in range(40)}
    assert firsts == {0, 1}  # tried in order: the gate when its 30% holds, else the stairs


def test_a_cut_on_if_takes_the_path_the_condition_took():
    story = GOTO_REEL.replace("CHUNK the lamp\n", "CHUNK the lamp\n$w = {rain|clear}\n").replace(
        "GOTO: the stairs ×2", "? $w[rain]: GOTO: the stairs ×3")
    worded = film(story).replace("? $w[rain]: CUT TO:", "IF $w is rain: CUT TO:")
    assert split_reel(worded).jumps_on_rolls and split_reel(worded).blocks[2].gotos[0].conditional
    for seed in range(20):
        assert reel_path(split_reel(worded), seed, {}, None) == reel_path(split_reel(story), seed, {}, None)


HISTORY = """@h3 text
SCENE the room
$light = {dawn|noon|dusk|night|storm}
SHOT 5s
In the $light light.
SCENE the stairs ×2
$light = {dawn|noon|dusk|night|storm}
SHOT 5s
Now $light, then $light[-1], before $light[-2], in the room $light["the room"], on the stairs $light["the stairs"].
"""


def test_history_in_brackets_is_the_value_clips_back_or_when_a_scene_last_played():
    for seed in range(8):
        lights = [re.search(r"Now (\w+)", c.text) or re.search(r"In the (\w+)", c.text)
                  for c in (compile_scene(HISTORY, seed, {}, target="h3-base", segment=t) for t in range(3))]
        room, first, second = (m.group(1) for m in lights)
        clip = compile_scene(HISTORY, seed, {}, target="h3-base", segment=2).text
        assert f"Now {second}, then {first}, before {room}, in the room {room}, on the stairs {first}" in clip
        tilde = HISTORY.replace("$light[-1]", "$light~1").replace("$light[-2]", "$light~2")
        assert compile_scene(tilde, seed, {}, target="h3-base", segment=2).text == clip


def test_history_of_a_scene_that_has_not_played_is_this_clips_value_with_a_warning():
    clip = compile_scene(HISTORY, 3, {}, target="h3-base", segment=1)
    now = re.search(r"Now (\w+)", clip.text).group(1)
    assert f"on the stairs {now}" in clip.text
    assert any('$light["the stairs"]: SCENE the stairs has not played before this clip' in i.message for i in clip.lint)
    hall = compile_scene(HISTORY.replace('"the room"', '"the hall"'), 3, {}, target="h3-base", segment=1)
    assert any("no SCENE is called 'the hall'" in i.message for i in hall.lint)


def test_a_chance_on_a_cut_moves_no_pick():
    rolls = GOTO_REEL.replace("The keeper climbs.", "The keeper climbs in {rain|fog|snow}.")
    chance = film(rolls).replace("CUT TO: the stairs ×2", "CUT TO: the stairs (100%) ×2")
    for segment in range(7):
        then, now = (compile_scene(src, 9, {}, target="h3-base", segment=segment) for src in (rolls, chance))
        assert (now.text, now.picks) == (then.text, then.picks)


INPUT_REEL = """@h3 references 16:9 lite
CAST
@GIRL: the young woman
@ROOM: the bedroom
REMEMBER: frame at 1s as @GIRL
REMEMBER: every 10th frame as refmod room_today
END ON: the girl sits down on the bed
SCENE the bed
AFTER: the input video
SHOT 5s: static
@GIRL lies back on the bed in @ROOM.
SCENE the window
SHOT 5s: static
@GIRL stands at the window.
"""


def test_the_head_remembers_the_input_video_for_every_clip():
    reel = split_reel(INPUT_REEL)
    assert reel.uses_input and [s.frames for s in reel.head_sends] == [[[24, 24]], [[0, -1]]]
    assert reel.send_slots == [1] and reel.send_refmods == ["room_today"]
    assert any(line.strip() == "GIRL (image 1): the young woman" for line in reel.head)  # her picture now
    for t in (0, 1):
        assert reel.ready(t) == {1: {"segment": -1, "frames": [[24, 24]]}}
        assert reel.refmods_ready(t) == {"room_today": {"segment": -1, "frames": [[0, -1]], "step": 10}}


def test_a_scene_after_the_input_video_continues_it_and_opens_on_the_heads_end():
    reel = split_reel(INPUT_REEL)
    path, _ = reel.walk()
    assert [reel.before(t, path) for t in (0, 1)] == [-1, 0] and reel.chain(0, path) == []
    bed, window = (compile_scene(INPUT_REEL, 1, {}, target="h3-base", segment=t) for t in (0, 1))
    assert bed.continues == -1 and "The shot opens as the girl sits down on the bed" in bed.text
    assert bed.scene.duration > 5  # the input video's last frames are pinned in front of it
    assert window.continues == 0 and 1 in bed.sends and 1 in window.sends
    fresh = compile_scene(INPUT_REEL.replace("AFTER: the input video\n", ""), 1, {}, target="h3-base")
    assert fresh.continues is None and "opens as" not in fresh.text and fresh.scene.duration == 5
    titled = compile_scene(INPUT_REEL.replace("SCENE the window", "SCENE the input video"), 1, {}, target="h3-base")
    assert any("titled the input video" in i.message for i in titled.lint)


def test_a_jump_opens_on_the_handoff_before_it_and_its_line_stays_out_of_the_prose():
    clip = compile_scene(GOTO_REEL, 1, {}, target="h3-base", segment=3)  # the stairs again, after the lamp
    assert "The keeper climbs" in clip.text and "beam sweeps the sea" in clip.text and "GOTO" not in clip.text
    with pytest.raises(ReelEnd):
        compile_scene(GOTO_REEL, 1, {}, segment=7)


def test_a_goto_that_waits_on_a_roll_makes_each_seed_its_own_story():
    story = GOTO_REEL.replace("CHUNK the lamp\n", "CHUNK the lamp\n$w = {rain|clear}\n").replace(
        "GOTO: the stairs ×2", "? $w[rain]: GOTO: the stairs ×3")
    reel = split_reel(story)
    assert reel.jumps_on_rolls and reel.segments is None
    lengths = {len(reel_path(reel, seed, {}, None)[0]) for seed in range(40)}
    assert lengths <= {3, 5, 7, 9} and len(lengths) > 1  # every rain sends the keeper back, at most three times
    seed = next(s for s in range(40) if len(reel_path(reel, s, {}, None)[0]) == 5)
    assert compile_scene(story, seed, {}, segment=4).text and pytest.raises(ReelEnd, compile_scene, story, seed, {}, segment=5)


def test_several_gotos_the_first_that_holds_and_has_jumps_left():
    reel = split_reel(GOTO_REEL.replace("GOTO: the stairs ×2", "GOTO: the gate ×1\nGOTO: the stairs ×1"))
    assert [b for b, _ in reel.walk()[0]] == [0, 1, 2, 0, 1, 2, 1, 2]


def test_a_chunk_every_goto_jumps_past_is_flagged():
    src = GOTO_REEL.replace("GOTO: the stairs ×2", "GOTO: the gate") + "CHUNK the cellar\nSHOT 5s: static\nDark.\n"
    lint = [i.message for i in compile_scene(src, 1, {}, segment=0).lint]
    assert any("SCENE 4" in m and "never plays" in m for m in lint)


LEAVES = """@h3 ref2va 2:3
CAST
EMMA (refmod emma_canon): a young woman in a red coat
GARDEN (global): a small walled garden
CHUNK
SHOT 5s: static
EMMA waves and walks out of the frame.
HANDOFF: only the room is left
CHUNK
SHOT 5s: static
Nothing happens in the empty room.
HANDOFF: only the room is left
CHUNK
SHOT 5s: static
EMMA slides back into the frame, laughing.
"""


def test_a_chunk_without_a_member_leaves_its_definition_and_its_refmod_out():
    clips = [ref2va(LEAVES, segment=s) for s in range(3)]
    assert ["a young woman in a red coat" in c.text for c in clips] == [True, False, True]
    assert [[m["name"] for m in c.refmods] for c in clips] == [["emma_canon"], [], ["emma_canon"]]
    assert all("a small walled garden" in c.text for c in clips)  # global: in every clip


def test_a_sent_image_of_a_member_not_in_the_chunk_stays_out():
    src = LEAVES.replace("EMMA (refmod emma_canon)", "EMMA (image 3)").replace(
        "HANDOFF: only the room is left\nCHUNK\nSHOT 5s: static\nNothing", "HANDOFF: only the room is left\nSEND: frame 0 to image 3\nCHUNK\nSHOT 5s: static\nNothing", 1)
    clips = [ref2va(src, segment=s) for s in range(3)]
    assert [sorted(c.sends) for c in clips] == [[], [], [3]] and [c.refs for c in clips] == [[], [], [3]]


def test_a_sent_image_stays_out_where_the_chunks_cast_redefines_its_member_without_it():
    src = LEAVES.replace("EMMA (refmod emma_canon)", "EMMA (refmod emma_canon, image 3)").replace(
        "HANDOFF: only the room is left\nCHUNK", "HANDOFF: only the room is left\nSEND: frame 0 to image 3\n"
        "SEND: frame 0 to image 5\nCHUNK", 1).replace(
        "CHUNK\nSHOT 5s: static\nEMMA slides back",
        "CHUNK\nCAST\nEMMA (refmod emma_canon): a young woman in a red coat\nSHOT 5s: static\nEMMA slides back")
    back = ref2va(src, segment=2)
    assert sorted(back.sends) == [5] and back.refs == [5]  # image 3 is EMMA's no more; image 5 is nobody's: it goes along
    assert ref2va(src.replace("CAST\nEMMA (refmod emma_canon): a young woman in a red coat\n", ""), segment=2).refs == [3, 5]


def test_a_chunks_own_cast_replaces_the_member_for_that_clip():
    src = LEAVES.replace("CHUNK\nSHOT 5s: static\nEMMA slides back", (
        "CHUNK\nCAST\nEMMA (refmod emma_canon at 0.3, image 1 at 0.5): a young woman in a red coat\n"
        "SHOT 5s: static\nEMMA slides back"))
    first, _, back = (ref2va(src, segment=s) for s in range(3))
    assert [m["strength"] for m in first.refmods] == [1.0] and [m["strength"] for m in back.refmods] == [0.3]
    assert back.scene.cast[0].name == "EMMA"  # in her place: still <Subject 1>
    assert back.images == [{"ref": 1, "image": 1, "member": "EMMA", "strength": 0.5, "from": 0.0, "to": 1.0}]
    assert not any("twice" in i.message for i in back.lint)



def test_set_lines_turn_the_dials_in_the_head_and_per_chunk():
    src = LEAVES.replace("CAST\nEMMA (refmod emma_canon)", "SET: emma_canon(0.8)\nCAST\nEMMA (refmod emma_canon_Video, image 1)").replace(
        "EMMA slides back", "SET: image_1(0.5,0.35)\nSET: emma_canon_Video(0.4, 20%)\nEMMA slides back")
    first, _, back = (ref2va(src, segment=s) for s in range(3))
    assert [(m["strength"], m["from"]) for m in first.refmods] == [(0.8, 0.0)] and first.images == []
    assert [(m["strength"], m["from"]) for m in back.refmods] == [(0.4, 0.2)]
    assert back.images == [{"ref": 1, "image": 1, "member": "EMMA", "strength": 0.5, "from": 0.35, "to": 1.0}]
    assert "SET" not in back.text  # never prose


def test_a_picture_at_0_leaves_the_clip_so_not_even_the_text_encoder_sees_it():
    # Reference to Video shows its pictures to the text encoder too: at 0 Orrery Refs must not hand it on
    sent = LEAVES.replace("EMMA (refmod emma_canon)", "EMMA (refmod emma_canon, image 3)").replace(
        "HANDOFF: only the room is left\nCHUNK", "HANDOFF: only the room is left\nSEND: frame 0 to image 3\nCHUNK", 1)
    assert ref2va(sent, segment=2).refs == [3]
    back = ref2va(sent.replace("EMMA slides back", "SET: image_3(0)\nEMMA slides back"), segment=2)
    assert back.refs == [] and back.sends == {} and back.images == [] and "<Picture" not in back.text
    assert [m["name"] for m in back.refmods] == ["emma_canon"]  # the RefMod stays
    assert ref2va(sent.replace("image 3)", "image 3 at 0)"), segment=2).refs == []  # the CAST's own dial
    wired = ref2va(LEAVES.replace("EMMA (refmod emma_canon)", "EMMA (image 1)").replace(
        "EMMA slides back", "SET: image_1(0)\nEMMA slides back"), segment=2)
    assert wired.refs == [] and "<Picture" not in wired.text


def test_a_dial_can_stop_before_sampling_does():
    src = LEAVES.replace("EMMA (refmod emma_canon)", "EMMA (refmod emma_canon from 10% to 50%, image 1 to 30%)").replace(
        "EMMA slides back", "SET: emma_canon(1, 0%, 20%)\nEMMA slides back")
    first, _, back = (ref2va(src, segment=s) for s in range(3))
    assert [(m["from"], m["to"]) for m in first.refmods] == [(0.1, 0.5)]
    assert [(m["from"], m["to"]) for m in back.refmods] == [(0.0, 0.2)]  # SET wins over the CAST
    assert [(p["from"], p["to"]) for p in back.images] == [(0.0, 0.3)]
    head = ref2va(LEAVES.replace("CAST\n", "refmods: to 40%\nCAST\n", 1), segment=0)
    assert [m["to"] for m in head.refmods] == [0.4]
    wrong = ref2va(LEAVES.replace("EMMA (refmod emma_canon)", "EMMA (refmod emma_canon from 50% to 20%)"), segment=0)
    assert any("stops before it starts" in i.message for i in wrong.lint) and wrong.refmods[0]["to"] == 1.0


def test_a_set_line_written_wrong_or_naming_nothing_is_lint():
    lint = lambda line: [i.message for i in ref2va(LEAVES.replace("EMMA slides back", f"{line}\nEMMA slides back"), segment=2).lint]
    assert any("is not name(strength, start)" in m for m in lint("SET: image_1 at 0.5"))
    assert any("SET: image_4: the clip hands no image 4 to H3" in m for m in lint("SET: image_4(0.5)"))
    assert any("takes numbers" in m for m in lint("SET: emma_canon(half)"))


def _lib(name, *values):
    return Library(name, [Entry(v) for v in values])


PAST_REEL = """@h3 t2va
$hero = __animal__
SCENE one
$look = __style__
SHOT 5s: static
A $hero in $look.
END ON: the $hero turns to __style__
SCENE two
SHOT 5s: static
The $hero again, once in $look~1.
"""


def test_a_clip_reads_its_past_as_its_takes_rendered_it():
    """#261: the head's bindings, $x~N and the END ON: of the clip before come from its take, not a new roll
    with libraries changed since; without a take they roll as before."""
    then = {"animal": _lib("animal", "fox"), "style": _lib("style", "linocut")}
    now = {"animal": _lib("animal", "badger"), "style": _lib("style", "oil")}
    first = compile_scene(PAST_REEL, 3, then, segment=0)
    assert first.kept["bindings"]["hero"]["value"] == "fox" and first.kept["handoff"] == "the fox turns to linocut"
    past = {0: {"scene": first.chunk, **first.kept}}
    rolled = compile_scene(PAST_REEL, 3, now, segment=1)  # no takes: the past rolls again, as before
    assert "badger" in rolled.text and "oil" in rolled.text and "fox" not in rolled.text
    kept = compile_scene(PAST_REEL, 3, now, segment=1, past=past)
    assert "The fox again, once in linocut" in kept.text and "turns to linocut" in kept.text and "badger" not in kept.text
    assert any(i.severity == "info" and "$hero stays 'fox'" in i.message for i in kept.lint)
    assert compile_scene(PAST_REEL, 3, then, segment=1, past=past).text == compile_scene(PAST_REEL, 3, then, segment=1).text  # nothing changed: as before


def test_the_walk_follows_the_scenes_the_takes_played():
    """#261: a CUT TO: that hangs on a roll goes where the film went, whatever it would roll now."""
    from orrery.reel import _unroll

    src = ("@h3 t2va\nSCENE start\n$c = {50% contact}\nSHOT 5s: static\nA room.\nIF $c is contact: CUT TO: contact\n"
           "CUT TO: walk\nSCENE walk\nSHOT 5s: static\nA walk.\nCUT TO: end\nSCENE contact\nSHOT 5s: static\nA contact.\n"
           "SCENE end\nSHOT 5s: static\nThe end.\n")
    reel = split_reel(src)
    for seed in range(8):
        rolled = _unroll(reel, seed, {}, None, 1)[3][0][1][0]  # the scene clip 2 plays at this seed
        other = 2 if rolled == 1 else 1
        record = {"scene": 0, "bindings": {}, "handoff": None}
        path = _unroll(reel, seed, {}, None, 2, past={0: record, 1: {"scene": other, "bindings": {}, "handoff": None}})[3][0]
        assert path[1][0] == other  # the take played the other scene: the walk follows it


def test_an_end_on_under_if_is_the_scene_s_end_on():
    """#347: an IF line is decided before its END ON: is read, so a scene that chooses its take by a binding ends as the
    chosen take does, and the next clip opens there."""
    reel = ("@h3 t2va 16:9\n$take = {1|2}\nSCENE one\nSHOT 5s: static\nA fox wakes.\nSCENE river\n"
            "IF $take is 1: SHOT 5s: static\nIF $take is 1: The fox drinks.\nIF $take is 1: END ON: the fox looks up\n"
            "IF $take is 2: SHOT 5s: pan left\nIF $take is 2: The fox sleeps.\nIF $take is 2: END ON: the fox curls up\n"
            "SCENE three\nSHOT 5s: static\nSnow falls.")
    seen = set()
    for seed in range(8):
        river, three = (compile_scene(reel, seed, {}, {}, segment=s) for s in (1, 2))
        assert not [i for i in river.lint if "END ON" in i.message]
        drinks = "The fox drinks." in river.text
        end = "the fox looks up" if drinks else "the fox curls up"
        assert f"The shot ends as {end}" in river.text and f"The shot opens as {end}" in three.text
        seen.add(drinks)
    assert seen == {True, False}  # both takes came
