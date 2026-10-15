import importlib.util
import inspect
import json
import sys
import types
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from orrery.comfy import (
    NODE_CLASS_MAPPINGS,
    OrreryLog,
    OrreryPrompt,
    linked_preset,
    log_outputs,
    run_prompt,
    save_png,
    shape,
    state_token,
)
from orrery.home import Home
from orrery.presets import save_preset

REPO = Path(__file__).resolve().parents[1]
SCENE = "@h3 t2va\nSHOT 5s: static\nA __animal__ sleeps.\nSFX: wind\n"


@pytest.fixture(autouse=True)
def _preview_only_real_images(monkeypatch):
    """Orrery Refs draws a preview of what it hands on; many tests hand it placeholder strings."""
    from orrery import comfy

    real = comfy.stack_preview
    monkeypatch.setattr(comfy, "stack_preview",
                        lambda labelled: real(labelled) if all(hasattr(img, "shape") for _, img in labelled) else None)


def test_prompt_node_expands_plain_templates(home):
    text, picks, seed, *_ = run_prompt("a __animal__", 4, "text", str(home))
    data = json.loads(picks)
    value = data["picks"][0]["value"]
    assert seed == 4 and text in (f"a {value}", f"an {value}")
    assert data["target"] == "text" and data["seed"] == 4
    assert data["picks"][0]["label"] == "__animal__"
    assert data["picks"][0]["keys"] == [f"__animal__={data['picks'][0]['value']}"]
    assert len(data["template"]) == 16


def test_prompt_node_compiles_screenplays_for_h3(home):
    text, picks, *_ = run_prompt(SCENE, 1, "h3-base", str(home))
    assert text.startswith("integrated_multimodal_description: [Shot 1] ")
    assert json.loads(picks)["lint"] == []


def test_prompt_node_flat_target(home):
    text, *_ = run_prompt(SCENE, 1, "flat", str(home))
    assert text.endswith("sleeps.")


def test_prompt_node_names_missing_libraries(home):
    with pytest.raises(ValueError, match="orrery lib gen smell"):
        run_prompt("a __smell__ day", 1, "text", str(home))


def test_state_token_changes_with_libraries_and_weights(home):
    before = state_token(Home(home))
    (home / "library" / "animal.yaml").write_text("- ibex\n")
    after_lib = state_token(Home(home))
    Home(home).save_weights({"__animal__=ibex": 2.0})
    assert len({before, after_lib, state_token(Home(home))}) == 3


def test_log_appends_one_galaxy_line_per_output(home):
    _, picks, *_ = run_prompt("a __animal__", 2, "text", str(home))
    rows = log_outputs(Home(home), picks, ["out/a.png", "out/b.png"])
    lines = (home / "galaxy.jsonl").read_text().splitlines()
    assert len(rows) == len(lines) == 2
    row = json.loads(lines[1])
    assert row["media"] == "out/b.png" and row["seed"] == 2 and row["rating"] is None
    assert row["picks"][0]["label"] == "__animal__" and "ts" in row


def test_a_reels_clip_is_logged_with_its_reel_and_its_scene(home):
    """#298: the Gallery's albums of a reel and of each of its scenes."""
    reel = "@h3 t2va\nSCENE the den\nA __animal__ sleeps.\nSCENE the hunt\nA __animal__ runs."
    _, picks, *_ = run_prompt(reel, 2, "h3-base", str(home), segment=1, chain="reels/fox")
    [row] = log_outputs(Home(home), picks, ["out/clip.mp4"])
    assert (row["segment"], row["chunks"], row["chain"], row["chunk"]) == (1, 2, "reels/fox", 1)
    _, picks, *_ = run_prompt("a __animal__", 2, "text", str(home))
    [row] = log_outputs(Home(home), picks, ["out/a.png"])
    assert not {"segment", "chain", "chunk"} & set(row)


def test_a_templates_take_is_logged_with_its_shoot_and_a_reels_clip_without(home):
    """#321: the Gallery's album of a shoot; a reel's clips have their reel's."""
    outputs = OrreryPrompt().run("a __animal__", 2, "text", home=str(home), shoot="2026-10-05T10:00:00.000Z")
    [row] = log_outputs(Home(home), outputs[1], ["out/a.png"])
    assert row["shoot"] == "2026-10-05T10:00:00.000Z"
    outputs = OrreryPrompt().run("@h3 t2va\nSCENE a\nSHOT 5s\nA fox.", 2, "h3-base", home=str(home), shoot="S")
    [row] = log_outputs(Home(home), outputs[1], ["out/clip.mp4"])
    assert "shoot" not in row
    assert OrreryPrompt.IS_CHANGED("a", 1, "text", shoot="S") != OrreryPrompt.IS_CHANGED("a", 1, "text", shoot="T")


def test_log_without_media_still_records_the_picks(home):
    _, picks, *_ = run_prompt("a __animal__", 2, "text", str(home))
    [row] = log_outputs(Home(home), picks, [])
    assert row["media"] is None


def test_save_png_embeds_the_picks(tmp_path):
    image = np.zeros((8, 12, 3), dtype=np.float32)
    path = tmp_path / "x.png"
    save_png(image, path, '{"seed": 1}')
    with Image.open(path) as img:
        assert img.size == (12, 8)
        assert img.text["orrery"] == '{"seed": 1}'


def test_node_classes_declare_comfy_interfaces():
    assert set(NODE_CLASS_MAPPINGS) == {"OrreryPrompt", "OrreryLog", "OrreryRefs", "OrreryContinue", "OrreryFilm",
                                        "OrreryWrite", "OrreryRefMods", "OrreryAsk"}
    inputs = OrreryPrompt.INPUT_TYPES()["required"]
    assert inputs["target"][0] == ["text", "h3-base", "flat"]
    assert OrreryPrompt.RETURN_NAMES == ("text", "picks", "seed", "width", "height", "length",
                                         "megapixels", "model")  # the model through orrery (#209)
    assert OrreryLog.OUTPUT_NODE is True
    film, cont = NODE_CLASS_MAPPINGS["OrreryFilm"], NODE_CLASS_MAPPINGS["OrreryContinue"]
    assert film.OUTPUT_NODE is True and film.RETURN_TYPES == ("IMAGE", "AUDIO", "VIDEO")
    assert list(cont.INPUT_TYPES()["required"]) == ["picks", "latent"] and cont.RETURN_TYPES == ("CONDITIONING", "LATENT")
    refmods = NODE_CLASS_MAPPINGS["OrreryRefMods"]
    assert list(refmods.INPUT_TYPES()["required"]) == ["conditioning", "picks"] and refmods.RETURN_TYPES == ("CONDITIONING",)


def test_node_pack_imports_from_the_repo_folder(monkeypatch):
    monkeypatch.setattr(sys, "path", [p for p in sys.path if not p.endswith("/src")])
    spec = importlib.util.spec_from_file_location("orrery_pack", REPO / "comfyui" / "__init__.py")
    pack = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pack)
    assert set(pack.NODE_CLASS_MAPPINGS) == {"OrreryPrompt", "OrreryLog", "OrreryRefs", "OrreryContinue", "OrreryFilm",
                                             "OrreryWrite", "OrreryRefMods", "OrreryAsk"}


def test_prompt_node_uses_a_preset_and_remembers_the_template(home):
    from orrery.presets import recall_template, save_preset
    save_preset(Home(home), "forest", "a __animal__ in the forest")
    text, picks, *_ = run_prompt("ignored", 1, "text", str(home), preset="forest")
    assert text.endswith(" in the forest")
    assert recall_template(Home(home), json.loads(picks)["template"]) == "a __animal__ in the forest"


def test_prompt_node_offers_presets_in_a_dropdown(home):
    from orrery.presets import save_preset
    save_preset(Home(home), "forest", "x")
    choices = OrreryPrompt.INPUT_TYPES()["optional"]["preset"][0]
    assert choices[0] == "(none)" and "forest" in choices and "tutorial/01_first_wildcard" in choices


def test_prompt_node_outputs_size_and_h3_length(home):
    *_, width, height, length, _ = run_prompt("a __animal__\n: x8 seed=100 w832 h1216", 1, "text", str(home))
    assert (width, height, length) == (832, 1216, 124)


def test_size_defaults_and_h3_ratio(home):
    assert shape("a fox") == (1024, 1024, 124)
    assert shape("@h3 t2va 16:9\nSHOT 5s\nA fox.") == (1344, 768, 124)
    assert shape("@h3 t2va 9:16\nSHOT 5s\nA fox.") == (768, 1344, 124)
    assert shape("@h3 t2va 21:9\nSHOT 5s\nA fox.")[:2] == (1536, 672)
    assert shape("@h3 t2va 16:9\n: w1280 h720\nSHOT 5s\nA fox.")[:2] == (1280, 720)


CAT, WIDE = (1536, 2048), (2048, 1536)  # a portrait photo (3:4) and a landscape one (4:3)


def test_a_wired_frame_shapes_the_clip_so_h3_does_not_stretch_it():
    assert shape("@h3 fl2va 16:9 1.032MP\nSHOT 5s\nA.", (CAT, None))[:2] == (864, 1152)  # exactly 3:4, near 1.03 MP
    assert shape("@h3 i2va 16:9\nSHOT 5s\nA.", (CAT, None))[:2] == (768, 1024)  # H3's canvas, in the frame's shape
    assert shape("@h3 l2va\nSHOT 5s\nA.", (None, WIDE))[:2] == (1024, 768)
    assert shape("@h3 fl2va 16:9\nSHOT 5s\nA.", (CAT, WIDE))[:2] == (768, 1024)  # the first frame leads
    assert shape("@h3 i2va 16:9\n: w1280 h720\nSHOT 5s\nA.", (CAT, None))[:2] == (1280, 720)  # written sizes win
    assert shape("@h3 i2va 16:9\nSHOT 5s\nA.")[:2] == (1344, 768)


def test_the_canvas_keeps_a_frame_s_shape_on_the_32_grid():
    from orrery.comfy import fit_canvas
    w, h = fit_canvas(1536 / 2048, 1.032e6)
    assert (w, h) == (864, 1152) and w % 32 == 0 and h % 32 == 0
    w, h = fit_canvas(1290 / 2122, 0.6e6)  # an odd phone shape: as close as the grid gets, area near
    assert abs((w / h) / (1290 / 2122) - 1) < 0.02 and 0.9 <= w * h / 0.6e6 <= 1.1


def test_the_frame_size_is_explained_and_mismatches_are_flagged(home):
    lint = lambda text, sizes: [i for i in json.loads(run_prompt(text, 1, "h3-base", str(home), sizes=sizes)[1])["lint"]
                                if "frame" in i["message"]]
    info = lint("@h3 i2va 16:9\nSHOT 5s\nThe scene begins exactly as in <Picture 1>.", (CAT, None))
    assert [i["severity"] for i in info] == ["info"] and "1536×2048" in info[0]["message"] and "768×1024" in info[0]["message"]
    crop = lint("@h3 fl2va\nSHOT 5s\nFrom <Picture 1> to <Picture 2>.", (CAT, WIDE))
    assert any(i["severity"] == "warn" and "crops" in i["message"] for i in crop)
    stretch = lint("@h3 i2va\n: w1280 h720\nSHOT 5s\nThe scene begins exactly as in <Picture 1>.", (CAT, None))
    assert any(i["severity"] == "warn" and "stretches" in i["message"] for i in stretch)
    assert not lint("@h3 i2va 3:4\nSHOT 5s\nThe scene begins exactly as in <Picture 1>.", (CAT, None))


def test_the_node_takes_the_frames_and_reads_their_size(home):
    import numpy as np
    optional = OrreryPrompt.INPUT_TYPES()["optional"]
    assert optional["first_frame"][0] == "IMAGE" and optional["last_frame"][0] == "IMAGE"
    outputs = OrreryPrompt().run("@h3 i2va 16:9\nSHOT 5s\nThe scene begins exactly as in <Picture 1>.", 1, "h3-base",
                                 home=str(home), first_frame=np.zeros((1, 2048, 1536, 3), dtype=np.float32))
    assert outputs[3:5] == (768, 1024)


def test_each_run_lands_in_the_history_and_in_the_log(home, capsys):
    from orrery import history, uistate
    OrreryPrompt().run("a {red|blue} fox", 7, "text", home=str(home))
    runs = history.read(Home(home))["runs"]
    assert runs[0]["seed"] == 7 and runs[0]["text"] in ("a red fox", "a blue fox")
    out = capsys.readouterr().out
    assert "[orrery] run · seed 7" in out and runs[0]["text"] in out
    uistate.set_flag(Home(home), "log_prompts", False)
    OrreryPrompt().run("a fox", 8, "text", home=str(home))
    assert "seed 8" not in capsys.readouterr().out
    assert history.read(Home(home))["total"] == 2  # the history keeps it all the same


def test_h3_length_is_frames_on_the_17k_plus_5_grid(home):
    assert shape("@h3 t2va\nSHOT 4s: cut\nA.\nSHOT 3s\nB.\nSHOT 4s\nC.")[2] == 277
    assert shape("@h3 t2va\nSHOT 4s\nA.")[2] == 107


def test_prompt_node_records_its_linked_preset_and_whether_it_was_edited(home):
    save_preset(Home(home), "stills/fox", "a __animal__")
    _, clean, *_ = run_prompt("a __animal__", 1, "text", str(home), linked="stills/fox")
    _, edited, *_ = run_prompt("a __animal__ at dusk", 1, "text", str(home), linked="stills/fox")
    _, missing, *_ = run_prompt("a __animal__", 1, "text", str(home), linked="gone/away")
    assert (json.loads(clean)["preset"], json.loads(clean)["edited"]) == ("stills/fox", False)
    assert json.loads(edited)["edited"] is True
    assert json.loads(missing)["preset"] is None
    [row] = log_outputs(Home(home), clean, ["x.png"])
    assert (row["preset"], row["edited"]) == ("stills/fox", False)


def test_the_linked_preset_is_read_from_the_workflow(home):
    info = {"workflow": {"nodes": [{"id": 3, "properties": {}}, {"id": 7, "properties": {"orrery_preset": "krea/x"}}],
                         "definitions": {"subgraphs": [{"nodes": [{"id": 9, "properties": {"orrery_preset": "h3/y"}}]}]}}}
    assert linked_preset(info, "7") == "krea/x"
    assert linked_preset(info, "12:9") == "h3/y"
    assert linked_preset(info, "3") is None
    assert linked_preset(None, "7") is None


class FakeVideo:
    def __init__(self):
        self.saved = None

    def save_to(self, path, metadata=None, **_):
        Path(path).write_bytes(b"video")
        self.saved = (path, metadata)


def test_log_saves_a_video_with_its_picks_and_records_it(home, tmp_path, monkeypatch):
    folder = types.SimpleNamespace(
        get_output_directory=lambda: str(tmp_path),
        get_save_image_path=lambda prefix, out, w=0, h=0: (str(tmp_path), "orrery", 7, "", prefix))
    monkeypatch.setitem(sys.modules, "folder_paths", folder)
    _, picks, *_ = run_prompt("a __animal__", 3, "text", str(home))
    video = FakeVideo()
    ui = OrreryLog().log(picks, video=video, home=str(home))["ui"]
    path, metadata = video.saved
    assert path.endswith("orrery_00007_.mp4") and metadata["orrery"]["seed"] == 3
    assert ui == {"images": [{"filename": "orrery_00007_.mp4", "subfolder": "", "type": "output"}], "animated": (True,)}
    row = json.loads((home / "galaxy.jsonl").read_text().splitlines()[-1])
    assert row["media"] == path
    assert "video" in OrreryLog.INPUT_TYPES()["optional"]


def test_dials_change_a_preset_without_editing_it(home):
    save_preset(Home(home), "stills/fox", "$hero = __animal__\na $hero at dusk")
    text, picks, *_ = run_prompt("$hero = __animal__\na $hero at dusk", 1, "text", str(home),
                                 linked="stills/fox", params='{"hero": "lynx", "gone": "x"}')
    data = json.loads(picks)
    assert text == "a lynx at dusk"
    assert (data["preset"], data["edited"], data["params"]) == ("stills/fox", False, {"hero": "lynx"})
    from orrery.presets import recall_template
    assert recall_template(Home(home), data["template"]) == "$hero = __animal__\na $hero at dusk"
    [row] = log_outputs(Home(home), picks, ["x.png"])
    assert row["params"] == {"hero": "lynx"}


def test_the_node_takes_dials_and_reruns_when_they_change(home):
    assert "params" in OrreryPrompt.INPUT_TYPES()["optional"]
    a = OrreryPrompt.IS_CHANGED("$a = x\n$a", 1, "text", params='{"a": "y"}')
    b = OrreryPrompt.IS_CHANGED("$a = x\n$a", 1, "text", params='{"a": "z"}')
    assert a != b


REEL = """@h3 t2va 16:9
LORA: <lora:all:1>
$hero = __animal__
CHUNK
SHOT 5s
A $hero sleeps.
SFX: wind
CHUNK
LORA: <lora:two:0.5>
SHOT 4s
The $hero wakes.
SFX: birds
"""


def fake_loras(monkeypatch, files):
    module = types.ModuleType("folder_paths")
    module.get_filename_list = lambda kind: list(files) if kind == "loras" else []
    monkeypatch.setitem(sys.modules, "folder_paths", module)


def test_the_node_writes_the_chunk_its_segment_asks_for(home, monkeypatch):
    from orrery.comfy import h3_length
    fake_loras(monkeypatch, ["x/all.safetensors", "two.safetensors"])
    text, picks, _, width, height, length, stack, *_ = run_prompt(REEL, 1, "h3-base", str(home), segment=1)
    data = json.loads(picks)
    assert "wakes" in text and "sleeps" not in text
    assert (data["segment"], data["chunks"]) == (1, 2)
    assert (width, height, length) == (1344, 768, h3_length(4 + 22 / 24))
    assert stack == [("x/all.safetensors", 1.0, 1.0, 0.0, 1.0), ("two.safetensors", 0.5, 0.5, 0.0, 1.0)]
    first = run_prompt(REEL, 1, "h3-base", str(home))
    assert first[5] == h3_length(5) and json.loads(first[1])["segment"] == 0
    assert set(json.loads(first[1])["kept"]) == {"bindings", "handoff"}  # what its take keeps for the clips after it (#261)


def test_a_knob_turned_in_the_sidebar_reaches_the_run(home, monkeypatch):
    """#418: the node kept only the bindings' dials, so a run loaded every LoRA at the strength as written."""
    fake_loras(monkeypatch, ["x/all.safetensors", "two.safetensors"])
    params = json.dumps({"~-1|<lora:all:1>": "<lora:all:0>", "~1|<lora:two:0.5>": "<lora:two:0.8>", "hero": "lynx"})
    text, picks, _, _, _, _, stack, *_ = run_prompt(REEL, 1, "h3-base", str(home), params=params, segment=1)
    # the head's turned to 0 (which loras.apply leaves out), the scene's to 0.8
    assert stack == [("x/all.safetensors", 0.0, 0.0, 0.0, 1.0), ("two.safetensors", 0.8, 0.8, 0.0, 1.0)]
    assert "lynx" in text
    assert json.loads(picks)["params"] == json.loads(params)  # a replay turns them again
    from orrery.comfy_write import write_idea
    seen = {}
    monkeypatch.setattr("orrery.writers.request", lambda h, task, source, *a, **k: seen.setdefault("source", source) and None)
    write_idea(Home(home), "continue", REEL, 1, 0, params, lambda: None, lambda: ([], {}))
    assert "<lora:all:0>" in seen["source"] and "<lora:two:0.8>" in seen["source"]  # the writers read the run's template


def test_a_text_templates_lora_line_goes_on_the_model_not_into_the_prompt(home, monkeypatch):
    """#311: a Krea template's LORA: line stayed in the prompt, and the model got no LoRA."""
    fake_loras(monkeypatch, ["girls/nicegirls_krea2.safetensors", "lenovo_krea2.safetensors"])
    template = "LORA: <lora:nicegirls_krea2:1.00><lora:lenovo_krea2:{0.5|0.5}>\n$x = {fox|owl}\nA studio photograph of a $x."
    text, picks, _, _, _, _, stack, *_ = run_prompt(template, 1, "text", str(home))
    assert "LORA" not in text and "lora" not in text and text.startswith("A studio photograph of a ")
    assert stack == [("girls/nicegirls_krea2.safetensors", 1.0, 1.0, 0.0, 1.0), ("lenovo_krea2.safetensors", 0.5, 0.5, 0.0, 1.0)]
    assert json.loads(picks)["lint"] == []


def test_unresolved_loras_are_left_out_and_reported(home, monkeypatch):
    fake_loras(monkeypatch, ["x/all.safetensors"])
    _, picks, _, _, _, _, stack, *_ = run_prompt(REEL, 1, "h3-base", str(home), segment=1)
    assert stack == [("x/all.safetensors", 1.0, 1.0, 0.0, 1.0)]
    assert any("two" in i["message"] for i in json.loads(picks)["lint"])


def test_the_node_counts_segments(home):
    optional = OrreryPrompt.INPUT_TYPES()["optional"]
    assert optional["segment"][0] == "INT" and optional["segment"][1]["control_after_generate"]
    assert "forceInput" not in optional["segment"][1]
    _, picks, *_ = run_prompt(REEL, 1, "h3-base", str(home), segment=1)
    assert json.loads(picks)["segment"] == 1


def test_a_reel_tells_orrery_continue_its_chain_and_context(home):
    _, picks, *_ = run_prompt(REEL, 1, "h3-base", str(home), segment=1)
    assert (json.loads(picks)["chain"], json.loads(picks)["context"]) == ("h3_context", 22)


def test_orrery_continue_pins_22_frames_and_another_context_is_a_warning(home):
    graph = {"9": {"class_type": "OrreryPrompt", "inputs": {}},
             "15": {"class_type": "OrreryContinue", "inputs": {"picks": ["9", 1], "latent": ["3", 1]}}}
    longer = REEL.replace("CHUNK\nSHOT 5s", "context: 39\nCHUNK\nSHOT 5s", 1)
    _, picks, *_ = OrreryPrompt().run(longer, 1, "h3-base", home=str(home), segment=1, prompt=graph, unique_id="9")
    warned = [i for i in json.loads(picks)["lint"] if "Orrery Continue" in i["message"]]
    assert [i["severity"] for i in warned] == ["warn"] and "17 frames (0.7 s) longer" in warned[0]["message"]
    _, picks, *_ = OrreryPrompt().run(longer, 1, "h3-base", home=str(home), segment=1)  # Motion Context takes 39
    assert not [i for i in json.loads(picks)["lint"] if "Orrery Continue" in i["message"]]
    _, picks, *_ = OrreryPrompt().run(REEL, 1, "h3-base", home=str(home), segment=1, prompt=graph, unique_id="9")
    assert not [i for i in json.loads(picks)["lint"] if "Orrery Continue" in i["message"]]


def test_past_the_end_of_a_reel_blocks_the_rest_of_the_graph(home, monkeypatch):
    blocker = types.ModuleType("comfy_execution.graph_utils")

    class ExecutionBlocker:
        def __init__(self, message):
            self.message = message

    blocker.ExecutionBlocker = ExecutionBlocker
    monkeypatch.setitem(sys.modules, "comfy_execution", types.ModuleType("comfy_execution"))
    monkeypatch.setitem(sys.modules, "comfy_execution.graph_utils", blocker)
    outputs = OrreryPrompt().run(REEL, 1, "h3-base", home=str(home), segment=2)
    assert len(outputs) == len(OrreryPrompt.RETURN_TYPES)
    assert all(isinstance(o, ExecutionBlocker) and o.message is None for o in outputs)
    a = OrreryPrompt.IS_CHANGED(REEL, 1, "h3-base", segment=0)
    assert a != OrreryPrompt.IS_CHANGED(REEL, 1, "h3-base", segment=1)


def test_the_node_lets_its_llm_create_missing_libraries(home, monkeypatch):
    from orrery import comfy
    from orrery.llm import FakeBackend
    backend = FakeBackend([json.dumps(["velvet mule", "chrome boot", "paper sandal"])], name="qwen3vl_4b")
    monkeypatch.setattr(comfy, "llm_for", lambda h, clip=None, **_: backend)
    text, picks, *_ = run_prompt("a model in __runway_shoes:3__", 1, "text", str(home))
    assert text.split(" in ")[1] in ("velvet mule", "chrome boot", "paper sandal")
    assert any("Created __runway_shoes__" in i["message"] for i in json.loads(picks)["lint"])


def test_without_an_llm_a_missing_library_still_names_the_fix(home, monkeypatch):
    from orrery import comfy
    monkeypatch.setattr(comfy, "llm_for", lambda h, clip=None, **_: None)
    with pytest.raises(ValueError, match="runway_shoes"):
        run_prompt("a model in __runway_shoes__", 1, "text", str(home))


def test_the_language_model_is_the_one_in_the_settings_never_a_wired_clip():
    """#282: no clip input on the nodes that write; an old workflow's wired clip reaches run() and is ignored."""
    from orrery.comfy_write import OrreryAsk, OrreryWrite

    for node in (OrreryPrompt, OrreryWrite, OrreryAsk):
        assert "clip" not in {**node.INPUT_TYPES()["required"], **node.INPUT_TYPES().get("optional", {})}
    assert "clip" in inspect.signature(OrreryPrompt.run).parameters


def test_the_node_leaves_unloading_to_comfyui(home, monkeypatch):
    """Unloading right after generate frees tensors ComfyUI's CUDA graph still holds: a warning flood."""
    from orrery import comfy
    from orrery.llm import FakeBackend
    backend = FakeBackend([json.dumps(["velvet mule"])])
    backend.release = lambda: pytest.fail("orrery must not unload the model itself")
    monkeypatch.setattr(comfy, "llm_for", lambda h, clip=None, **_: backend)
    run_prompt("a model in __runway_shoes__", 1, "text", str(home))


def test_the_llm_answers_within_the_max_tokens_setting(home):
    from orrery.comfy import llm_for
    from orrery.home import Home as H
    H(home).save_config({"llm": {"file": "qwen3vl_4b_bf16.safetensors", "max_tokens": 9000}})
    assert llm_for(H(home)).max_length == 9000
    H(home).save_config({"llm": {"file": "qwen3vl_4b_bf16.safetensors"}})
    assert llm_for(H(home)).max_length == 16000


def fake_llm(monkeypatch, reply):
    from orrery import comfy
    from orrery.llm import FakeBackend
    backend = FakeBackend([json.dumps(reply) if not isinstance(reply, str) else reply], name="qwen3vl_4b")
    monkeypatch.setattr(comfy, "llm_for", lambda h, clip=None, **_: backend)
    return backend


def test_the_llm_writes_a_slot_where_it_stands(home, monkeypatch):
    backend = fake_llm(monkeypatch, {"slot 1": "a woman drops her keys"})
    text, *_ = run_prompt("A street at dawn, --what happens next--.", 1, "text", str(home))
    assert text == "A street at dawn, a woman drops her keys."
    assert len(backend.prompts) == 1 and "A street at dawn, [slot 1]." in backend.prompts[0]


def test_a_slot_and_a_missing_library_share_the_one_request(home, monkeypatch):
    backend = fake_llm(monkeypatch, {"mood": ["A hush.", "A storm."], "slot 1": "she runs"})
    text, *_ = run_prompt("__mood__(one sentence) Then --what happens next--.", 1, "text", str(home))
    assert len(backend.prompts) == 1
    assert text.endswith("Then she runs.") and text.split(" Then")[0] in ("A hush.", "A storm.")


def test_the_model_sees_the_clip_it_continues(home, monkeypatch):
    backend = fake_llm(monkeypatch, {"slot 1": "he lets go"})
    frames = [object()] * 6
    reel = "@h3 t2va\nSCENE start\nSHOT 5s: static\nA man holds a rope.\nSFX: wind\nSCENE next\nSHOT 5s: static\n--what happens next--\nSFX: wind"
    run_prompt(reel, 1, "h3-base", str(home), segment=1, frames=frames)
    assert backend.images[0] is frames and "6 images" in backend.prompts[0]


def test_without_scenes_the_node_never_continues_an_old_clip(home, monkeypatch):
    """A segment left at 4 by earlier reels: a template without SCENE lines is one clip on its own (#190)."""
    backend = fake_llm(monkeypatch, {"slot 1": "she waves"})
    _, picks, *_ = run_prompt("@h3 t2va\nSHOT 5s: static\n--what happens--\nSFX: wind", 1, "h3-base", str(home),
                              segment=4, frames=[object()] * 6)
    assert backend.images == [None] and "frames of the previous clip" not in backend.prompts[0]
    assert "segment" not in json.loads(picks)


def test_frames_alone_ask_the_model_nothing(home, monkeypatch):
    backend = fake_llm(monkeypatch, {})
    run_prompt("a quiet street", 1, "text", str(home), frames=[object()])
    assert backend.prompts == []


def test_without_an_llm_a_slot_names_the_fix(home, monkeypatch):
    from orrery import comfy
    monkeypatch.setattr(comfy, "llm_for", lambda h, clip=None, **_: None)
    with pytest.raises(ValueError, match="language model"):
        run_prompt("--what happens next--", 1, "text", str(home))


def test_an_unusable_answer_keeps_the_directions_and_says_so(home, monkeypatch):
    """A failed run would leave a gap in a Motion Context chain; the directions stand in instead."""
    fake_llm(monkeypatch, "I cannot see anything.")
    text, picks, *_ = run_prompt("A street, --a woman drops her keys--.", 1, "text", str(home))
    assert text == "A street, a woman drops her keys."
    assert any(i["severity"] == "warn" and "slot" in i["message"] for i in json.loads(picks)["lint"])


def test_outside_a_chain_the_node_runs_without_a_previous_clip(home):
    optional = OrreryPrompt.INPUT_TYPES()["optional"]
    assert "latent_path" not in optional and optional["chain"][1]["default"] == ""  # the app names it (#197)
    outputs = OrreryPrompt().run("a quiet street", 1, "text", home=str(home), segment=2)
    assert len(outputs) == len(OrreryPrompt.RETURN_TYPES) and outputs[-2] > 0 and outputs[-1] is None  # megapixels, no model


def test_only_slots_in_the_played_chunk_can_go_unanswered(home, monkeypatch):
    fake_llm(monkeypatch, {"mood": ["A hush."], "slot 1": "she runs"})
    reel = """@h3 t2va
CHUNK one
SHOT 5s
__mood__ --what happens next--
SFX: rain
CHUNK two
SHOT 5s
--a later scene--
SFX: rain
"""
    _, picks, *_ = run_prompt(reel, 1, "h3-base", str(home), segment=0)
    assert not [i for i in json.loads(picks)["lint"] if "got no text" in i["message"]]


def test_the_word_count_is_taken_after_the_slots_are_filled(home, monkeypatch):
    fake_llm(monkeypatch, {"slot 1": " ".join(["word"] * 360)})
    src = "@h3 ref2va 16:9\nsummary: A waits.\nCAST\nA (image 1): a man\nSHOT 5s\nA waits. --what happens--\nSFX: wind\n"
    _, picks, *_ = run_prompt(src, 1, "h3-base", str(home))
    assert not [i for i in json.loads(picks)["lint"] if "words" in i["message"]]


def test_the_node_expands_includes_with_their_params(home):
    from orrery.presets import save_preset
    save_preset(Home(home), "parts/hat", "$colour = {red|blue}\na $colour hat")
    text, *_ = run_prompt("A man in\n@include parts/hat\n  colour = green", 1, "text", str(home))
    assert text == "A man in a green hat"


def test_enhance_rewrites_a_text_prompt_and_keeps_the_original(home, monkeypatch):
    backend = fake_llm(monkeypatch, {"rewrite 1": "a fox in a misty field at dusk, low sun, film grain"})
    text, picks, *_ = run_prompt("a fox in a field\n> moody, cinematic", 1, "text", str(home))
    assert text == "a fox in a misty field at dusk, low sun, film grain"
    assert json.loads(picks)["enhanced"] == [{"instruction": "moody, cinematic", "before": "a fox in a field",
                                               "after": text}]
    assert "moody, cinematic" in backend.prompts[0]


def test_a_rewrite_kept_with_use_selected_stands_in_for_its_roll_without_asking(home, monkeypatch):
    """#276: the take picked in the sheet is kept for the instruction and the passage as it rolled; another roll
    is rewritten as before."""
    from orrery.takes import keep_rewrite, rewrite_key

    backend = fake_llm(monkeypatch, {"rewrite 1": "a fox at dusk, rewritten"})
    keep_rewrite(Home(home), rewrite_key("moody", "a fox in a field"), "moody", "the fox you picked, in fog")
    text, picks, *_ = run_prompt("a fox in a field\n> moody", 1, "text", str(home))
    assert text == "the fox you picked, in fog" and backend.prompts == []  # nothing asked
    assert json.loads(picks)["enhanced"] == [{"instruction": "moody", "before": "a fox in a field",
                                               "after": "the fox you picked, in fog", "kept": True}]
    text, *_ = run_prompt("a fox in a meadow\n> moody", 1, "text", str(home))
    assert text == "a fox at dusk, rewritten"  # another passage: the model rewrites it


def test_a_run_s_language_model_work_goes_in_mini_runs_one_task_each(home, monkeypatch):
    """#171: the plan of a run (the library to write, the rewrites, each slot); each mini-run answers one task with
    one request; the render run then takes the answers and asks the model nothing."""
    from orrery import comfy, miniruns
    from orrery.llm import FakeBackend

    def model(reply):
        backend = FakeBackend([json.dumps(reply)], name="qwen3vl_4b")
        monkeypatch.setattr(comfy, "llm_for", lambda h, clip=None, **_: backend)
        return backend

    template = "a fox under a __sky_mood__ sky, --one small object--\n> moody"
    tasks = miniruns.plan(Home(home), template, "text", "", 3)
    assert tasks == [{"task": "library", "what": "sky_mood"}, {"task": "rewrites", "what": ""},
                     {"task": "slot", "what": "one small object"}]
    model({"sky_mood": ["grey", "low"]})
    got = run_prompt(template, 3, "text", str(home), ask=tasks[0])
    assert got["what"] == "sky_mood" and Home(home).libraries()["sky_mood"].meta["pending"]  # written as a run would
    backend = model({"rewrite 1": "a fox, low and moody, under a grey sky, [keep 1]"})
    got = run_prompt(template, 3, "text", str(home), ask=tasks[1])
    assert got == {"task": "rewrites", "written": 1, "of": 1} and len(backend.prompts) == 1
    backend = model({"slot 1": "a brass key"})
    got = run_prompt(template, 3, "text", str(home), ask=tasks[2])
    assert got["text"] == "a brass key" and "a fox, low and moody" in backend.prompts[0]  # the slot sees the rewrite
    backend = model({"slot 1": "never asked"})
    text, picks, *_ = run_prompt(template, 3, "text", str(home))
    assert text == "a fox, low and moody, under a grey sky, a brass key" and backend.prompts == []
    assert json.loads(picks)["enhanced"][0]["asked"] is True
    backend = model({"slot 1": "a coin", "rewrite 1": "a fox at dusk, [keep 1]"})
    text, *_ = run_prompt(template, 4, "text", str(home))  # another seed: asked in the run, as before
    assert len(backend.prompts) == 1


def test_orrery_ask_answers_one_task_in_its_ui_output(home, monkeypatch):
    """#171, #178: the node of a mini-run: a take at the line (sampled anew for the takes it has) and a slot."""
    from orrery import comfy
    from orrery.comfy_write import OrreryAsk
    from orrery.llm import FakeBackend

    seeds = []
    backend = FakeBackend([json.dumps(["a brass key"])], name="qwen3vl_4b")
    monkeypatch.setattr(comfy, "llm_for", lambda h, clip=None, seed=0, **_: seeds.append(seed) or backend)
    template = "A fox with --one small object--."
    out = OrreryAsk().ask("takes", "", template, 7, args=json.dumps({"kind": "slot", "what": "one small object",
                                                                     "have": ["a coin"], "n": 1}), home=str(home))
    assert json.loads(out["ui"]["orrery_ask"][0]) == {"takes": ["a brass key"]} and seeds == [8]
    assert "- a coin" in backend.prompts[-1]
    for asked in (3, 4):  # #330: the panel's runs so far, so a take it already has does not stall the seed
        OrreryAsk().ask("takes", "", template, 7, args=json.dumps({"kind": "slot", "what": "one small object",
                                                                  "have": ["a coin"], "n": 1, "asked": asked}), home=str(home))
    assert seeds[-2:] == [10, 11]
    backend.replies = [json.dumps({"slot 1": "a brass key"})]
    got = json.loads(OrreryAsk().ask("slot", "one small object", template, 7, home=str(home))["ui"]["orrery_ask"][0])
    assert got["text"] == "a brass key"
    got = json.loads(OrreryAsk().ask("slot", "no such slot", template, 7, home=str(home))["ui"]["orrery_ask"][0])
    assert "no such slot" in got["error"]


def test_enhance_rewrites_shot_prose_but_not_dialogue(home, monkeypatch):
    backend = fake_llm(monkeypatch, {"rewrite 1": "FOX crouches low in the wet grass, ears flat.", "slot 1": "it rains"})
    src = ("@h3 t2va 16:9\nCAST\nFOX: a red fox\nSHOT 5s\n> make it eerie\nFOX waits.\n"
           "FOX (low voice): Not yet.\nThen --what the sky does--.\nSFX: wind\n")
    text, *_ = run_prompt(src, 1, "h3-base", str(home))
    assert len(backend.prompts) == 1 and "Not yet" not in backend.prompts[0].split("Passages to rewrite")[1]
    assert "crouches low in the wet grass" in text and "Not yet." in text and "Then it rains." in text


def test_without_its_libraries_enhance_waits_for_the_next_run(home, monkeypatch):
    fake_llm(monkeypatch, {"mood": ["A hush."]})
    _, picks, *_ = run_prompt("__mood__ over a field\n> moody", 1, "text", str(home))
    assert any("enhance" in i["message"] for i in json.loads(picks)["lint"])



def test_an_endpoint_writes_the_libraries_first_then_slots_and_enhance_in_the_same_run(home, monkeypatch, fake_api):
    """An API can be asked more than once a run (#165): each library apart, then the slots on the compiled prompt."""
    from orrery import comfy
    from orrery.llm import OpenAIBackend
    backend = OpenAIBackend(fake_api.url, "gpt-5.4-mini")
    monkeypatch.setattr(comfy, "llm_for", lambda h, clip=None, **_: backend)
    fake_api.answer = lambda body: (json.dumps(["A hush."]) if body["messages"][0]["content"].startswith("You write wildcard")
                                    else json.dumps({"slot 1": "she runs", "rewrite 1": "A hush falls. Then [keep 1]."}))
    text, picks, *_ = run_prompt("__mood__(one sentence) Then --what happens next--.\n> moody", 1, "text", str(home))
    prompts = [r["messages"][0]["content"] for r in fake_api.requests]
    assert len(prompts) == 2 and "A hush. Then [slot 1]" in prompts[1]  # the compiled prompt, the library rolled
    assert text == "A hush falls. Then she runs."
    assert not any("next run" in i["message"] for i in json.loads(picks)["lint"])

REF_REEL = "@h3 ref2va 16:9\nsummary: A waits.\nCAST\nA (image 3): a woman\nSHOT 5s\nA waits.\nSFX: wind\n"


def test_orrery_refs_hands_on_only_the_images_the_clip_uses():
    from orrery.comfy import OrreryRefs
    imgs = {f"image_{i}": f"img{i}" for i in range(1, 8)}
    out = OrreryRefs().route(json.dumps({"refs": [3, 6]}), **imgs)
    assert out[:3] == ("img3", "img6", None) and len(out) == 10
    assert OrreryRefs().route(json.dumps({}), **imgs)[:2] == ("img1", "img2")  # nothing packed: as wired
    with pytest.raises(ValueError, match="image_6"):
        OrreryRefs().route(json.dumps({"refs": [3, 6]}), image_3="img3")


def test_the_node_packs_labels_when_orrery_refs_reads_its_picks(home):
    graph = {"9": {"class_type": "OrreryPrompt", "inputs": {}},
             "12": {"class_type": "OrreryRefs", "inputs": {"picks": ["9", 1], "image_3": ["5", 0]}},
             "20": {"class_type": "MiniMaxH3ReferenceToVideo",
                    "inputs": {"prompt": ["9", 0], "ref_images.ref_image_0": ["12", 0]}}}
    text, picks, *_ = OrreryPrompt().run(REF_REEL, 1, "h3-base", home=str(home), prompt=graph, unique_id="9")
    assert "<Picture 1>" in text and json.loads(picks)["refs"] == [3]
    assert not [i for i in json.loads(picks)["lint"] if "reference image" in i["message"]]


def test_the_node_warns_when_fewer_references_are_wired_than_the_screenplay_uses(home):
    graph = {"9": {"class_type": "OrreryPrompt", "inputs": {}},
             "20": {"class_type": "MiniMaxH3ReferenceToVideo",
                    "inputs": {"prompt": ["15", 0], "ref_images.ref_image_0": ["5", 0]}},
             "15": {"class_type": "Text Concatenate", "inputs": {"text_a": ["9", 0]}}}
    text, picks, *_ = OrreryPrompt().run(REF_REEL, 1, "h3-base", home=str(home), prompt=graph, unique_id="9")
    assert "<Picture 3>" in text
    assert any("3 reference images" in i["message"] for i in json.loads(picks)["lint"])


def test_megapixels_in_the_header_set_the_canvas_by_area():
    w, h, _ = shape("@h3 ref2va 16:9 0.6MP\nSHOT 5s\nA fox.")
    assert (w, h) == (1024, 576) and w % 32 == 0 and h % 32 == 0
    w, h, _ = shape("@h3 t2va 9:16 1mp\nSHOT 5s\nA fox.")
    assert abs(w * h / 1e6 - 1.0) < 0.05 and h > w
    assert shape("@h3 t2va 0.5MP\nSHOT 5s\nA fox.")[:2] == (704, 704)  # no ratio: square
    assert shape("@h3 t2va 16:9 0.6MP\n: w1216 h832\nSHOT 5s\nA fox.")[:2] == (1216, 832)


def test_the_node_puts_out_megapixels(home):
    assert OrreryPrompt.RETURN_NAMES[-2] == "megapixels" and OrreryPrompt.RETURN_TYPES[-2] == "FLOAT"
    outputs = OrreryPrompt().run("@h3 t2va 16:9 0.6MP\nSHOT 5s\nA fox runs.\nSFX: wind", 1, "h3-base", home=str(home))
    assert outputs[-2] == 0.6 and json.loads(outputs[1])["megapixels"] == 0.6
    outputs = OrreryPrompt().run("@h3 t2va 9:16\nSHOT 5s\nA fox runs.\nSFX: wind", 1, "h3-base", home=str(home))
    assert outputs[-2] == round(768 * 1344 / 1e6, 3)


def test_a_reel_tells_the_app_which_segment_runs(home, monkeypatch):
    sent = []
    server = types.ModuleType("server")
    server.PromptServer = types.SimpleNamespace(instance=types.SimpleNamespace(send_sync=lambda e, d: sent.append((e, d))))
    monkeypatch.setitem(sys.modules, "server", server)
    reel = "@h3 t2va\nCHUNK a\nSHOT 5s\nA fox.\nCHUNK b repeat 2\nSHOT 5s\nThe fox again."
    OrreryPrompt().run(reel, 1, "h3-base", home=str(home), segment=2, unique_id="427")
    assert sent == [("orrery.segment", {"node": "427", "prompt_id": None, "segment": 2, "end": False, "seed": 1, "take": 0, "roll": ""})]
    sent.clear()
    OrreryPrompt().run("@h3 t2va\nSHOT 5s\nA fox.", 1, "h3-base", home=str(home), unique_id="427", take=3)
    assert sent == [("orrery.segment", {"node": "427", "prompt_id": None, "segment": -1, "end": False, "seed": 1, "take": 3, "roll": ""})]
    sent.clear()  # not a reel: segment -1, its result a take under the prompt (#211)
    OrreryPrompt().run("A fox, {seen from the side|seen from the front}.\n@grid {seen from the side|seen from the front}", 1, "text",
                       home=str(home), unique_id="427", sweep="1|sweeps/fox 2026-10-05 10.00")
    assert sent[0][1]["roll"] == "sweeps/fox 2026-10-05 10.00"  # a grid's run: its Roll's folder, so its views are one take (#320)
    sent.clear()
    blocker = types.ModuleType("comfy_execution.graph_utils")
    blocker.ExecutionBlocker = lambda v: v
    monkeypatch.setitem(sys.modules, "comfy_execution", types.ModuleType("comfy_execution"))
    monkeypatch.setitem(sys.modules, "comfy_execution.graph_utils", blocker)
    OrreryPrompt().run(reel, 1, "h3-base", home=str(home), segment=3, unique_id="427")
    assert sent == [("orrery.segment", {"node": "427", "prompt_id": None, "segment": 3, "end": True, "seed": None, "take": 0, "roll": ""})]


def test_comments_neither_roll_nor_ask_for_libraries(home):
    src = "# Quickstart: __no_such_library__ would be written by the language model\n@h3 t2va 16:9 0.6MP\nSHOT 5s\nA fox runs.\nSFX: wind"
    outputs = OrreryPrompt().run(src, 1, "h3-base", home=str(home))
    data = json.loads(outputs[1])
    assert "Quickstart" not in outputs[0] and (outputs[3], outputs[4]) == (1024, 576) and data["megapixels"] == 0.6


# --- SEND: frames of a clip as reference images for later clips -------------------------------

SEND_REEL = """@h3 ref2va 16:9 lite
CAST
GIRL (image 1, image 3): the young woman, in a pink tracksuit
CHUNK the pose
SHOT 5s: push in, slow
GIRL stretches on a mat.
SEND: frame 0 to image 3
SEND: frames 2, 5, 34-36 to image 4
CHUNK the walk
SHOT 4s: static
GIRL walks to the window.
"""
REFS_GRAPH = {"9": {"class_type": "OrreryPrompt", "inputs": {}},
              "12": {"class_type": "OrreryRefs", "inputs": {"picks": ["9", 1], "image_1": ["5", 0]}},
              "20": {"class_type": "MiniMaxH3ReferenceToVideo",
                     "inputs": {"prompt": ["9", 0], "ref_images.ref_image_0": ["12", 0], "ref_images.ref_image_1": ["12", 1]}}}


def test_the_picks_tell_orrery_refs_what_is_sent_and_from_which_chain(home):
    _, picks, *_ = OrreryPrompt().run(SEND_REEL, 1, "h3-base", home=str(home), segment=0,
                                      chain="reels/one", prompt=REFS_GRAPH, unique_id="9")
    data = json.loads(picks)
    assert data["refs"] == [1] and data["sends"] == {"chain": "reels/one", "home": str(home), "slots": [3, 4], "ready": {}}
    _, picks, *_ = OrreryPrompt().run(SEND_REEL, 1, "h3-base", home=str(home), segment=1,
                                      chain="reels/one", prompt=REFS_GRAPH, unique_id="9")
    data = json.loads(picks)
    assert data["refs"] == [1, 3, 4]
    assert data["sends"]["ready"] == {"3": {"segment": 0, "frames": [[0, 0]]},
                                      "4": {"segment": 0, "frames": [[2, 2], [5, 5], [34, 36]]}}


def test_a_reel_that_sends_needs_orrery_refs(home):
    graph = {"9": {"class_type": "OrreryPrompt", "inputs": {}}}
    with pytest.raises(ValueError, match="Orrery Refs"):
        OrreryPrompt().run(SEND_REEL, 1, "h3-base", home=str(home), prompt=graph, unique_id="9")


def send_chain(tmp_path, monkeypatch, clips=2, dropped=()):
    """A Chain Video with `clips` clips under a fake ComfyUI output folder; frames() returns a marker."""
    run = tmp_path / "h3_context" / "chain_video" / "run_1"
    folders = [f"clip_{i:05d}" for i in range(1, clips + 1)]
    run.mkdir(parents=True)
    for folder in folders:
        (run / folder).mkdir()
        (run / folder / "video.mp4").write_bytes(b"")
    (run.parent / "active.json").write_text(json.dumps({"run": "run_1"}))
    (run / "clips.json").write_text(json.dumps({"clips": [{"folder": f} for f in folders]}))
    monkeypatch.setitem(sys.modules, "folder_paths", types.SimpleNamespace(get_output_directory=lambda: str(tmp_path)))
    from orrery import chain as ch

    class Batch:
        def __init__(self, path, wanted):
            self.label, self.shape = f"{Path(path).parent.name}:{wanted}", (len(wanted), 8, 8, 3)

    monkeypatch.setattr(ch, "frames", lambda path, wanted, step=1: (Batch(path, wanted), list(dropped)))
    from orrery import anchors
    saved = []
    monkeypatch.setattr(anchors, "save", lambda home, n, frames: saved.append((str(home.root), n, frames.label)))
    return saved


def sends(ready, slots=(3, 4), refs=(1, 3), home="/nowhere"):
    return json.dumps({"refs": list(refs), "sends": {"chain": "h3_context", "home": home, "slots": list(slots),
                                                     "ready": ready}})


def test_orrery_refs_fills_a_sent_image_with_its_frames(tmp_path, monkeypatch):
    from orrery.comfy import OrreryRefs
    send_chain(tmp_path, monkeypatch)
    out = OrreryRefs().route(sends({"3": {"segment": 1, "frames": [[0, 0]]}}), image_1="img1")
    assert out[0] == "img1" and out[1].label == "clip_00002:[[0, 0]]" and out[2] is None


def test_the_graph_says_which_images_are_wired_into_orrery_refs():
    from orrery.comfy import wiring
    graph = {"1": {"class_type": "OrreryPrompt", "inputs": {}},
             "12": {"class_type": "OrreryRefs", "inputs": {"picks": ["1", 1], "image_1": ["5", 0], "image_3": ["6", 0],
                                                           "keep_sent": False}}}
    assert wiring(graph, "1") == (True, None, False, frozenset({1, 3}))


def test_a_slot_both_wired_and_sent_is_the_wired_picture_until_the_frames_exist(tmp_path, monkeypatch, capsys):
    from orrery.comfy import OrreryRefs
    send_chain(tmp_path, monkeypatch)
    out = OrreryRefs().route(sends({}, refs=[1, 3]), image_1="img1", image_3="img3")
    assert out[:2] == ("img1", "img3") and "the wired picture until those frames exist" in capsys.readouterr().out
    out = OrreryRefs().route(sends({"3": {"segment": 1, "frames": [[0, 0]]}}), image_1="img1", image_3="img3")
    assert out[1].label == "clip_00002:[[0, 0]]" and "frames from clip 2 replace the wired picture" in capsys.readouterr().out


def test_orrery_refs_reads_what_the_head_remembers_from_the_input_video(tmp_path, monkeypatch):
    from orrery.comfy import OrreryRefs
    send_chain(tmp_path, monkeypatch)
    with pytest.raises(ValueError, match="remembered from the input video"):
        OrreryRefs().route(sends({"3": {"segment": -1, "frames": [[24, 24]]}}), image_1="img1")
    (tmp_path / "h3_context" / "orrery_input.mp4").write_bytes(b"")
    out = OrreryRefs().route(sends({"3": {"segment": -1, "frames": [[24, 24]]}}), image_1="img1")
    assert out[1].label == "h3_context:[[24, 24]]"


def test_a_reel_that_reads_the_input_video_needs_one_wired(home, monkeypatch, tmp_path):
    monkeypatch.setitem(sys.modules, "folder_paths", types.SimpleNamespace(get_output_directory=lambda: str(tmp_path)))
    reel = "@h3 text\nEND ON: she sits down\nSCENE a\nAFTER: the input video\nSHOT 5s\nShe stands up."
    with pytest.raises(ValueError, match="video input"):
        OrreryPrompt().run(reel, 5, "h3-base", home=str(home))
    _, picks, *_ = OrreryPrompt().run(reel.replace("AFTER: the input video\n", ""), 5, "h3-base", home=str(home))
    assert "input" not in json.loads(picks)


def test_orrery_refs_says_when_the_chain_lacks_the_sending_clip(tmp_path, monkeypatch):
    from orrery.comfy import OrreryRefs
    send_chain(tmp_path, monkeypatch, clips=1)
    with pytest.raises(ValueError, match="has no clip 5"):
        OrreryRefs().route(sends({"3": {"segment": 4, "frames": [[0, 0]]}}), image_1="img1")


def test_orrery_refs_warns_about_dropped_frames_and_batches_for_reference_to_video(tmp_path, monkeypatch, capsys):
    from orrery.comfy import OrreryRefs
    send_chain(tmp_path, monkeypatch, dropped=[60])
    graph = {"12": {"class_type": "OrreryRefs", "inputs": {}},
             "20": {"class_type": "MiniMaxH3ReferenceToVideo", "inputs": {"ref_images.ref_image_1": ["12", 1]}}}
    OrreryRefs().route(sends({"3": {"segment": 0, "frames": [[2, 2], [5, 5], [60, 60]]}}), prompt=graph, unique_id="12",
                       image_1="img1")
    said = capsys.readouterr().out
    assert "60" in said and "not in clip 1" in said
    assert "reads only the first" in said


def test_an_empty_ref_blocks_a_preview_but_stays_none_for_reference_to_video(monkeypatch):
    """Segment 0 of a reel that sends has nothing on the sent refs yet: Reference to Video skips None,
    but Preview Image would crash on it, so outputs only nodes other than it read are blocked instead."""
    from orrery.comfy import OrreryRefs
    blocker = types.ModuleType("comfy_execution.graph_utils")

    class ExecutionBlocker:
        def __init__(self, message):
            self.message = message

    blocker.ExecutionBlocker = ExecutionBlocker
    monkeypatch.setitem(sys.modules, "comfy_execution", types.ModuleType("comfy_execution"))
    monkeypatch.setitem(sys.modules, "comfy_execution.graph_utils", blocker)
    graph = {"12": {"class_type": "OrreryRefs", "inputs": {}},
             "20": {"class_type": "MiniMaxH3ReferenceToVideo", "inputs": {"ref_images.ref_image_0": ["12", 0],
                                                                         "ref_images.ref_image_1": ["12", 1]}},
             "30": {"class_type": "PreviewImage", "inputs": {"images": ["12", 1]}},
             "31": {"class_type": "PreviewImage", "inputs": {"images": ["12", 2]}}}
    out = OrreryRefs().route(sends({}, refs=[1]), prompt=graph, unique_id="12", image_1="img1")
    assert out[0] == "img1"
    assert out[1] is None  # Reference to Video reads it (and a preview too): None, which it skips
    assert isinstance(out[2], ExecutionBlocker) and out[2].message is None  # only a preview: blocked
    assert out[3] is None  # read by nothing


def test_the_preview_output_shows_every_ref_of_the_clip_labelled(monkeypatch):
    """ref_N go to Reference to Video, which needs None for an empty one; previews take `preview` instead."""
    from orrery import comfy
    from orrery.comfy import OrreryRefs
    assert OrreryRefs.RETURN_NAMES[-1] == "preview" and len(OrreryRefs.RETURN_TYPES) == 10
    blocker = types.ModuleType("comfy_execution.graph_utils")

    class ExecutionBlocker:
        def __init__(self, message):
            self.message = message

    blocker.ExecutionBlocker = ExecutionBlocker
    monkeypatch.setitem(sys.modules, "comfy_execution", types.ModuleType("comfy_execution"))
    monkeypatch.setitem(sys.modules, "comfy_execution.graph_utils", blocker)
    monkeypatch.setattr(comfy, "stack_preview", lambda labelled: ("stacked", tuple(labelled)))
    graph = {"12": {"class_type": "OrreryRefs", "inputs": {}},
             "30": {"class_type": "PreviewImage", "inputs": {"images": ["12", 9]}}}
    out = OrreryRefs().route(json.dumps({"refs": [3, 6]}), prompt=graph, unique_id="12", image_3="img3", image_6="img6")
    assert out[9] == ("stacked", (("ref_1", "img3"), ("ref_2", "img6")))
    empty = OrreryRefs().route(json.dumps({"refs": []}), prompt=graph, unique_id="12")
    assert empty[9] == ("stacked", ())  # a grey "no refs" frame, so the preview never shows an older clip's refs


def test_orrery_refs_always_runs_so_a_new_chain_is_never_hidden_by_the_cache():
    from orrery.comfy import OrreryRefs
    assert OrreryRefs.IS_CHANGED(picks="x") != OrreryRefs.IS_CHANGED(picks="x")  # NaN: ComfyUI never reuses it


def test_a_fetched_sent_image_is_kept_as_the_anchor_of_its_image(tmp_path, monkeypatch):
    from orrery.comfy import OrreryRefs
    saved = send_chain(tmp_path, monkeypatch)
    OrreryRefs().route(sends({"3": {"segment": 1, "frames": [[0, 0]]}}, home=str(tmp_path)), image_1="img1")
    assert saved == [(str(tmp_path), 3, "clip_00002:[[0, 0]]")]


def test_a_held_image_comes_from_its_anchor_not_the_chain(tmp_path, monkeypatch):
    from orrery import anchors, comfy
    from orrery.comfy import OrreryRefs
    saved = send_chain(tmp_path, monkeypatch, clips=0)
    monkeypatch.setattr(anchors, "load", lambda home, n: f"anchor{n}@{home.root.name}" if n == 3 else None)
    monkeypatch.setattr(comfy, "to_image", lambda array: array)
    out = OrreryRefs().route(sends({"3": {"held": True}}, home=str(tmp_path)), image_1="img1")
    assert out[1] == f"anchor3@{tmp_path.name}" and saved == []  # held: no chain read, nothing overwritten
    with pytest.raises(ValueError, match="image 4"):
        OrreryRefs().route(sends({"4": {"held": True}}, refs=(1, 4), home=str(tmp_path)), image_1="img1")


def test_keep_sent_on_orrery_refs_holds_the_stored_anchors_from_segment_0(home, monkeypatch):
    from orrery import anchors
    monkeypatch.setattr(anchors, "stored", lambda h: {3})
    graph = {**REFS_GRAPH, "12": {"class_type": "OrreryRefs", "inputs": {"picks": ["9", 1], "image_1": ["5", 0],
                                                                         "keep_sent": True}}}
    _, picks, *_ = OrreryPrompt().run(SEND_REEL, 1, "h3-base", home=str(home), segment=0, prompt=graph, unique_id="9")
    data = json.loads(picks)
    assert data["refs"] == [1, 3] and data["sends"]["ready"] == {"3": {"held": True}}
    assert data["sends"]["home"] == str(home)
    _, picks, *_ = OrreryPrompt().run(SEND_REEL, 1, "h3-base", home=str(home), segment=0, prompt=REFS_GRAPH, unique_id="9")
    assert json.loads(picks)["sends"]["ready"] == {}


def test_the_preview_frames_carry_their_ref_in_white_with_a_black_edge():
    from orrery.comfy import preview_frames
    blue = np.zeros((1, 64, 64, 3), dtype=np.float32)
    blue[..., 2] = 1.0
    red = np.zeros((2, 96, 160, 3), dtype=np.float32)
    red[..., 0] = 1.0
    frames = preview_frames([("ref_1", blue), ("ref_2", red)])
    assert frames.shape == (3, 512, 853, 3)
    corner = frames[0, :70, :260]
    assert (corner >= 0.99).all(axis=-1).any() and (corner <= 0.01).all(axis=-1).any()  # white text, black edge
    empty = preview_frames([])
    assert empty.shape[0] == 1 and abs(float(empty[0, -1, -1, 0]) - 0.5) < 0.01


# --- LoRA sweeps -------------------------------------------------------------------------------

SWEEP = "a cat on a roof <lora:a:0.5,1.0:solo><lora:b:0.7:solo>"


def test_a_sweep_run_writes_its_tags_records_them_and_names_its_galaxy_folder(home):
    text, picks, seed, *_ = OrreryPrompt().run(SWEEP, 5, "text", home=str(home), sweep="1|sweeps/a 2026-10-01 14.03")
    data = json.loads(picks)
    assert text == "a cat on a roof <lora:a:1>" and seed == 5
    assert {"label": "<lora:a>", "value": "1", "keys": ["<lora:a>=1"]} in data["picks"]
    assert {"label": "<lora:b>", "value": "off", "keys": ["<lora:b>=off"]} in data["picks"]
    assert data["folder"] == "sweeps/a 2026-10-01 14.03" and data["sweep"] == {"run": 1, "runs": 3}


def test_run_without_roll_takes_the_first_and_says_how_many_there_are(home):
    text, picks, *_ = OrreryPrompt().run(SWEEP, 5, "text", home=str(home))
    assert text == "a cat on a roof <lora:a:0.5>"
    assert any("3 runs" in i["message"] and "Roll" in i["message"] for i in json.loads(picks)["lint"])
    with pytest.raises(ValueError, match="run 7"):
        OrreryPrompt().run(SWEEP, 5, "text", home=str(home), sweep="7|x")


GRID = "a __animal__ in __style__\n: grid __style__"


def test_a_grid_runs_one_cell_per_sweep_run_and_multiplies_with_a_lora_sweep(home):
    texts = [OrreryPrompt().run(GRID, 5, "text", home=str(home), sweep=f"{i}|g")[0] for i in range(2)]
    animal = texts[0].split()[1]
    assert texts == [f"a {animal} in linocut", f"a {animal} in gouache"]
    both = GRID.replace("__style__\n", "__style__ @x(0.5,1.0)\n")
    runs = [OrreryPrompt().run(both, 5, "text", home=str(home), sweep=f"{i}|g") for i in range(4)]
    assert [r[0].split(" in ")[1] for r in runs] == ["linocut <lora:x:0.5>", "gouache <lora:x:0.5>",
                                                     "linocut <lora:x:1>", "gouache <lora:x:1>"]
    assert json.loads(runs[3][1])["sweep"] == {"run": 3, "runs": 4}
    lint = json.loads(OrreryPrompt().run(both, 5, "text", home=str(home))[1])["lint"]
    assert any("LoRA sweep and grid: 4 runs (2 × 2)" in i["message"] for i in lint)
    with pytest.raises(ValueError, match="run 4"):
        OrreryPrompt().run(both, 5, "text", home=str(home), sweep="4|g")


def test_a_grid_in_a_reel_runs_its_cells_on_one_clip(home):
    reel = "@h3 text\nSCENE a\nSHOT 5s\nA fox.\nSCENE b\nSHOT 5s\nA heron in __style__.\n: grid __style__"
    texts = [OrreryPrompt().run(reel, 5, "h3-base", home=str(home), segment=1, sweep=f"{i}|g")[0] for i in range(2)]
    assert "in linocut" in texts[0] and "in gouache" in texts[1]
    lint = json.loads(OrreryPrompt().run(reel, 5, "h3-base", home=str(home), segment=1)[1])["lint"]
    assert any("Grid: 2 runs" in i["message"] and "on this clip" in i["message"] for i in lint)


def test_a_sweep_in_a_library_entry_warns_in_the_node(home):
    (home / "library" / "sets.yaml").write_text("- <lora:ink:0.5,1.0>\n")
    text, picks, *_ = OrreryPrompt().run("a fox __sets__", 5, "text", home=str(home))
    assert text == "a fox <lora:ink:0.5>"
    assert any("is a sweep" in i["message"] and i["severity"] == "warn" for i in json.loads(picks)["lint"])


def test_a_run_records_its_dice_for_history_and_galaxy(home):
    from orrery import history
    from orrery.home import Home

    assert json.loads(OrreryPrompt().run("a __animal__", 5, "text", home=str(home))[1])["rng"] == 2
    assert json.loads(OrreryPrompt().run("@rng 1\na __animal__", 5, "text", home=str(home))[1])["rng"] == 1
    assert [r["rng"] for r in history.read(Home(home))["runs"]] == [1, 2]  # newest first
    h3 = json.loads(OrreryPrompt().run("@h3 t2va full\nSHOT 5s: static\nA fox.", 5, "h3-base", home=str(home))[1])
    assert h3["format"] == "full" and history.read(Home(home))["runs"][0]["format"] == "full"
    assert json.loads(OrreryPrompt().run("@h3 t2va\nSHOT 5s: static\nA fox.", 5, "h3-base", home=str(home))[1])["format"] == "lite"


def test_size_comes_from_the_size_directive(home):
    from orrery.comfy import shape

    assert shape("@h3 t2va 16:9\n@size 832x1216\nSHOT 5s\nA.")[:2] == (832, 1216)
    assert shape("@h3 t2va 16:9\n: w832 h1216\nSHOT 5s\nA.")[:2] == (832, 1216)


def test_the_node_runs_a_template_with_its_own_library_without_a_language_model(home):
    text, picks, *_ = OrreryPrompt().run("@lib mood\n  calm\n  tense\nA __mood__ __animal__.", 3, "text", home=str(home))
    assert text.split()[1] in ("calm", "tense") and not [i for i in json.loads(picks)["lint"] if i["severity"] != "info"]


def test_every_sweep_run_is_a_new_run_for_comfyui():
    a = OrreryPrompt.IS_CHANGED(SWEEP, 5, "text", sweep="0|x")
    assert a != OrreryPrompt.IS_CHANGED(SWEEP, 5, "text", sweep="1|x")


def test_a_logged_sweep_output_lands_in_its_folder(home, tmp_path):
    from orrery.comfy import log_outputs
    _, picks, *_ = OrreryPrompt().run(SWEEP, 5, "text", home=str(home), sweep="2|sweeps/a 2026-10-01 14.03")
    [row] = log_outputs(Home(home), picks, [str(tmp_path / "x.png")])
    assert row["folder"] == "sweeps/a 2026-10-01 14.03"
    data = json.loads(picks)
    data["folder"] = "../escape"
    [row] = log_outputs(Home(home), json.dumps(data), [str(tmp_path / "y.png")])
    assert "folder" not in row


REFMOD_SCENE = """@h3 ref2va 16:9
CAST
SALON (refmod salon_canon at 0.5): a grand salon
SHOT 5s
The camera crosses SALON.
"""


def test_the_picks_carry_the_clips_refmods_and_lint_asks_for_orrery_refmods(home):
    _, picks, *_ = run_prompt(REFMOD_SCENE, 1, "h3-base", str(home))
    data = json.loads(picks)
    assert data["refmods"] == [{"name": "salon_canon", "member": "SALON", "strength": 0.5, "from": 0.0, "to": 1.0}]
    assert not any("Orrery RefMods" in i["message"] for i in data["lint"])
    _, picks, *_ = run_prompt(REFMOD_SCENE, 1, "h3-base", str(home), refmodded=False)
    assert any("Orrery RefMods" in i["message"] for i in json.loads(picks)["lint"])


def test_the_picks_carry_picture_strengths(home):
    src = REFMOD_SCENE.replace("SALON (refmod salon_canon at 0.5)", "SALON (image 1 at 0.5)")
    _, picks, *_ = run_prompt(src, 1, "h3-base", str(home), refmodded=False)
    data = json.loads(picks)
    assert data["images"] == [{"ref": 1, "image": 1, "member": "SALON", "strength": 0.5, "from": 0.0, "to": 1.0}]
    assert any("picture strengths (image 1 at 0.5)" in i["message"] for i in data["lint"])


def test_a_slot_sees_the_pictures_it_names_and_one_from_image_output_waits(home, monkeypatch):
    """#174: the picture wired into first_frame goes to the model as Picture 1; an EXPORT slot from image output
    stays a slot (the Gallery writes it, #175); one outside EXPORT: says so."""
    import importlib.util
    import sys
    import types

    import numpy as np

    from orrery import comfy

    if importlib.util.find_spec("torch") is None:  # CI has no torch: the batch stays numpy, its shape is what counts
        monkeypatch.setitem(sys.modules, "torch", types.SimpleNamespace(from_numpy=lambda a: a))

    class Seen:
        def __init__(self):
            self.prompts, self.images = [], []

        def complete(self, prompt, images=None):
            self.prompts.append(prompt)
            self.images.append(images)
            return json.dumps({"slot 1": "a brass key"})

    seen = Seen()
    monkeypatch.setattr(comfy, "llm_for", lambda h, clip=None, **_: seen)
    template = "A fox holding --the object in image first_frame, one phrase--.\nEXPORT: sheet = --a character sheet from image output--"
    text, picks, *_ = run_prompt(template, 1, "text", str(home), pictures={"first_frame": np.zeros((1, 8, 8, 3), np.float32)})
    assert "a brass key" in text and "the object in Picture 1, one phrase" in seen.prompts[0]
    assert tuple(seen.images[0].shape) == (1, 512, 512, 3)  # a text encoder: one batch, fitted into a square
    data = json.loads(picks)
    assert data["exports"]["sheet"] == "--a character sheet from image output--"
    assert not any("image output" in i["message"] for i in data["lint"])
    _, picks, *_ = run_prompt("A fox --from image output--.", 1, "text", str(home))
    assert any("stands in an EXPORT: line" in i["message"] for i in json.loads(picks)["lint"])
    _, picks, *_ = run_prompt("A fox holding --the object in image first_frame--.", 1, "text", str(home))
    assert any("nothing is wired into the Orrery Prompt's first_frame" in i["message"] for i in json.loads(picks)["lint"])
