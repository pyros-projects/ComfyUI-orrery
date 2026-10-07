import asyncio
import json
import re
from pathlib import Path

import pytest
from PIL import Image

from orrery import webapi
from orrery.galaxy import row_id
from orrery.home import Home
from orrery.presets import load_preset, preset_meta, remember_template, save_preset, template_hash
from orrery.webapi import ROUTES, ApiError, call, register

CARD = {"name", "folder", "title", "note", "tags", "builtin", "hash", "outputs", "thumb", "kind", "sub", "modified"}


def api(home, fn, **args):
    return call(fn, {"home": str(home), **args})


def ok(home, fn, **args):
    status, body = api(home, fn, **args)
    assert status == 200, body
    return body


def log_row(home, tmp_path, template_text, seed=1, name="a.png", keys=("__animal__=fox",), **extra):
    path = tmp_path / name
    Image.new("RGB", (64, 96), "teal").save(path)
    r = {"ts": f"2026-09-24T00:00:0{seed}+00:00", "media": str(path), "seed": seed, "target": "text",
         "template": remember_template(Home(home), template_text), "text": "a fox", "rating": None,
         "picks": [{"label": "__animal__", "value": "fox", "keys": list(keys)}], **extra}
    with (home / "galaxy.jsonl").open("a") as f:
        f.write(json.dumps(r) + "\n")
    return row_id(r)


def log_clip(home, tmp_path, template_text, seed=1, **extra):
    """A logged clip: its file is a few bytes, enough for the gallery to call it a video."""
    path = tmp_path / f"{seed}.mp4"
    path.write_bytes(b"\0" * 16)
    r = {"ts": f"2026-09-24T00:00:0{seed}+00:00", "media": str(path), "seed": seed, "target": "h3-base",
         "template": remember_template(Home(home), template_text), "text": "a fox", "rating": None, "picks": [], **extra}
    with (home / "galaxy.jsonl").open("a") as f:
        f.write(json.dumps(r) + "\n")
    return row_id(r)


# --- plumbing -------------------------------------------------------------------------------

def test_routes_cover_the_contract():
    paths = {(m, p) for m, p, _ in ROUTES}
    assert paths == {
        ("GET", "/orrery/completions"), ("GET", "/orrery/presets"), ("GET", "/orrery/preset"),
        ("POST", "/orrery/preset/save"), ("POST", "/orrery/preset/delete"),
        ("POST", "/orrery/preset/rename"), ("POST", "/orrery/preset/meta"),
        ("POST", "/orrery/favorite"), ("POST", "/orrery/recent"), ("POST", "/orrery/ui"), ("GET", "/orrery/template"),
        ("GET", "/orrery/libraries"), ("GET", "/orrery/library"), ("POST", "/orrery/library/save"),
        ("POST", "/orrery/library/own"), ("POST", "/orrery/library/delete"), ("POST", "/orrery/library/rename"), ("POST", "/orrery/galaxy/capture"),
        ("GET", "/orrery/galaxy"), ("POST", "/orrery/galaxy/rate"),
        ("GET", "/orrery/galaxy/thumb"), ("GET", "/orrery/galaxy/media"), ("POST", "/orrery/roll"),
        ("GET", "/orrery/galaxy/view"), ("GET", "/orrery/presets/grep"), ("POST", "/orrery/reset"), ("POST", "/orrery/galaxy/delete"), ("POST", "/orrery/galaxy/export"),
        ("POST", "/orrery/galaxy/collect"), ("POST", "/orrery/galaxy/circle"), ("POST", "/orrery/galaxy/uncollect"), ("POST", "/orrery/galaxy/collection/add"),
        ("POST", "/orrery/galaxy/collection/rename"), ("POST", "/orrery/galaxy/collection/delete"),
        ("POST", "/orrery/frequency"), ("GET", "/orrery/llm"), ("POST", "/orrery/llm"),
        ("POST", "/orrery/llm/check"), ("POST", "/orrery/llm/libraries"), ("POST", "/orrery/write"), ("POST", "/orrery/write/place"), ("POST", "/orrery/llm/takes"), ("POST", "/orrery/llm/keep"), ("POST", "/orrery/llm/plan"), ("POST", "/orrery/galaxy/takes"), ("POST", "/orrery/galaxy/write"),
        ("POST", "/orrery/library/accept"), ("POST", "/orrery/library/add"), ("POST", "/orrery/library/discard"),
        ("GET", "/orrery/home"), ("POST", "/orrery/home"),
        ("GET", "/orrery/chain"), ("GET", "/orrery/chain/thumb"), ("POST", "/orrery/chain/move"), ("POST", "/orrery/chain/pick"), ("POST", "/orrery/chain/delete"), ("POST", "/orrery/chain/clear"), ("GET", "/orrery/chain/tree"), ("POST", "/orrery/chain/walk"), ("POST", "/orrery/chain/end"),
        ("GET", "/orrery/chain/video"),
        ("GET", "/orrery/anchor"), ("GET", "/orrery/anchors"),
        ("GET", "/orrery/history"),
        ("GET", "/orrery/writers"),
        ("POST", "/orrery/writers"),
        ("POST", "/orrery/plan"),
        ("POST", "/orrery/reel"),
        ("POST", "/orrery/remembered"), ("POST", "/orrery/annotate"), ("GET", "/orrery/pictures"),
    }


def test_call_maps_api_errors_and_crashes_to_json(home):
    def boom(h, args):
        raise ApiError(409, "taken", exists=True)

    def crash(h, args):
        raise RuntimeError("disk on fire")

    assert api(home, boom) == (409, {"error": "taken", "exists": True})
    status, body = api(home, crash)
    assert status == 500 and "disk on fire" in body["error"]


def test_call_uses_the_home_argument(home, tmp_path):
    other = tmp_path / "elsewhere"
    status, _ = call(webapi.favorite, {"home": str(other), "name": "a", "on": True})
    assert status == 200 and (other / "ui.json").exists()


class FakeRoutes:
    def __init__(self):
        self.handlers = {}

    def route(self, method, path):
        def attach(fn):
            self.handlers[(method, path)] = fn
            return fn
        return attach


class FakeWeb:
    @staticmethod
    def json_response(data, status=200):
        return ("json", status, data)

    @staticmethod
    def FileResponse(path):
        return ("file", path)


class FakeRequest:
    def __init__(self, query=None, body=None, broken=False):
        self.query, self._body, self._broken = query or {}, body, broken

    async def json(self):
        if self._broken:
            raise ValueError("Expecting value")
        return self._body


def test_register_attaches_every_route_through_one_adapter(home, tmp_path):
    routes = FakeRoutes()
    register(routes, FakeWeb)
    assert set(routes.handlers) == {(m, p) for m, p, _ in ROUTES}

    def hit(method, path, **request):
        return asyncio.run(routes.handlers[(method, path)](FakeRequest(**request)))

    q = {"home": str(home)}
    assert hit("POST", "/orrery/favorite", query=q, body={"name": "a", "on": True}) == \
        ("json", 200, {"favorites": ["a"]})
    kind, status, body = hit("GET", "/orrery/presets", query=q)
    assert (kind, status) == ("json", 200) and body["favorites"] == [] and body["quickstart"] is True
    assert hit("POST", "/orrery/ui", query=q, body={"quickstart": False}) == \
        ("json", 200, {"quickstart": False, "dividers": True, "timeline": True, "log_prompts": True, "surf_numbered": True, "preview_light": True, "clip_min": 360, "take_min": 54, "anchor_h": 72, "preview_fps": 12, "preview_edge": 1024,
                     "annotations_show": "appended", "picture_slots": "gallery"})
    assert hit("GET", "/orrery/presets", query=q)[2]["quickstart"] is False
    assert hit("GET", "/orrery/preset", query={**q, "name": "nope"})[1] == 404
    assert hit("POST", "/orrery/recent", query=q, broken=True)[1] == 400
    assert hit("POST", "/orrery/recent", query=q, body=["a"])[1] == 400
    rid = log_row(home, tmp_path, "a __animal__")
    assert hit("GET", "/orrery/galaxy/media", query={**q, "id": rid}) == ("file", tmp_path / "a.png")


# --- presets --------------------------------------------------------------------------------

def test_presets_list_cards_with_outputs_favorites_and_recents(home, tmp_path):
    save_preset(Home(home), "stills/mine", "a __animal__")
    first = log_row(home, tmp_path, "a __animal__", seed=1, name="1.png")
    newest = log_row(home, tmp_path, "a __animal__", seed=2, name="2.png")
    ok(home, webapi.favorite, name="stills/mine", on=True)
    ok(home, webapi.recent, name="tutorial/01_first_wildcard")
    data = ok(home, webapi.presets)
    cards = {c["name"]: c for c in data["presets"]}
    mine, lesson = cards["stills/mine"], cards["tutorial/01_first_wildcard"]
    assert set(mine) == CARD
    assert (mine["folder"], mine["builtin"], mine["outputs"], mine["thumb"]) == ("stills", False, 2, newest)
    assert mine["hash"] == template_hash("a __animal__") and first != newest
    assert lesson["builtin"] and lesson["note"] and lesson["title"].startswith("01")
    assert (lesson["outputs"], lesson["thumb"]) == (0, None)
    assert data["favorites"] == ["stills/mine"] and data["recent"] == ["tutorial/01_first_wildcard"]


def test_top_level_presets_have_an_empty_folder_and_a_default_title(home):
    save_preset(Home(home), "night_walk", "x")
    card = ok(home, webapi.preset, name="night_walk")
    assert (card["folder"], card["title"], card["text"]) == ("", "night walk", "x")


def test_missing_preset_is_404(home):
    assert api(home, webapi.preset, name="nope")[0] == 404
    assert api(home, webapi.preset, name="///")[0] == 400


def test_save_creates_then_refuses_to_clobber(home):
    card = ok(home, webapi.preset_save, name="Stills/Night Walk", text="a __animal__",
              title="Night walk", tags=["moody", "Moody"], note="why")
    assert card["name"] == "stills/night_walk" and card["tags"] == ["moody"]
    status, body = api(home, webapi.preset_save, name="stills/night_walk", text="other")
    assert status == 409 and body["exists"] is True
    assert load_preset(Home(home), "stills/night_walk") == "a __animal__"


def test_overwrite_keeps_title_tags_and_note(home):
    ok(home, webapi.preset_save, name="a", text="one", title="A", tags=["x"], note="n")
    card = ok(home, webapi.preset_save, name="a", text="two", overwrite=True)
    assert (card["text"], card["title"], card["tags"], card["note"]) == ("two", "A", ["x"], "n")


def test_saving_under_a_builtin_name_makes_a_shadowing_copy(home):
    card = ok(home, webapi.preset_save, name="tutorial/01_first_wildcard", text="mine")
    assert not card["builtin"] and card["text"] == "mine"
    assert "lesson" in preset_meta(Home(home), "tutorial/01_first_wildcard")


def test_bad_names_are_400(home):
    assert api(home, webapi.preset_save, name="", text="x")[0] == 400
    assert api(home, webapi.preset_save, name="a/", text="x")[0] == 400


def test_delete_rename_and_meta_guard_builtins(home):
    lesson = "tutorial/01_first_wildcard"
    for fn, extra in ((webapi.preset_delete, {}), (webapi.preset_rename, {"to": "x"}),
                      (webapi.preset_meta, {"title": "x"})):
        assert api(home, fn, name=lesson, **extra)[0] == 403
        assert api(home, fn, name="missing", **extra)[0] == 404


def test_delete_forgets_the_preset_in_ui_state(home):
    ok(home, webapi.preset_save, name="a", text="x")
    ok(home, webapi.favorite, name="a", on=True)
    assert ok(home, webapi.preset_delete, name="a") == {"ok": True}
    assert ok(home, webapi.presets)["favorites"] == []


def test_rename_moves_the_file_and_the_ui_state(home):
    ok(home, webapi.preset_save, name="a", text="x")
    ok(home, webapi.recent, name="a")
    ok(home, webapi.preset_save, name="b", text="y")
    assert api(home, webapi.preset_rename, name="a", to="b")[0] == 409
    card = ok(home, webapi.preset_rename, name="a", to="stills/c")
    assert card["name"] == "stills/c" and card["text"] == "x"
    assert ok(home, webapi.presets)["recent"] == ["stills/c"]


def test_meta_sets_and_clears_fields(home):
    ok(home, webapi.preset_save, name="a", text="x", note="old")
    card = ok(home, webapi.preset_meta, name="a", title="New", tags=["b", "a"], note="")
    assert (card["title"], card["tags"], card["note"]) == ("New", ["a", "b"], "")


def test_recent_is_newest_first(home):
    ok(home, webapi.recent, name="a")
    assert ok(home, webapi.recent, name="b") == {"recent": ["b", "a"]}


def test_template_by_hash_from_the_store_or_a_preset(home):
    digest = remember_template(Home(home), "stored text")
    assert ok(home, webapi.template, hash=digest) == {"hash": digest, "text": "stored text"}
    lesson = load_preset(Home(home), "tutorial/01_first_wildcard")
    assert ok(home, webapi.template, hash=template_hash(lesson))["text"] == lesson
    assert api(home, webapi.template, hash="0" * 16)[0] == 404
    assert api(home, webapi.template, hash="../x")[0] == 400


# --- libraries ------------------------------------------------------------------------------

def libs(home):
    """Every library with its entries, as the tab opens them one by one."""
    return {head["name"]: ok(home, webapi.library, name=head["name"]) for head in ok(home, webapi.libraries)["libraries"]}


def test_the_list_carries_no_entries_and_searches_them_on_the_server(home):
    """#152: a home of 109,722 entries sent them all (30 MB) whenever the tab opened."""
    (home / "library" / "big.yaml").write_text("entries: [" + ", ".join(f"thing {i}" for i in range(5000)) + ", a lone heron]\n")
    heads = {h["name"]: h for h in ok(home, webapi.libraries)["libraries"]}
    assert heads["big"] == {"name": "big", "source": "user", "count": 5001, "tags": [], "pending": False,
                            "pending_count": 0, "directions": ""}
    assert all("entries" not in h for h in heads.values())
    found = {h["name"] for h in ok(home, webapi.libraries, q="Lone Heron")["libraries"]}
    assert found == {"big"}
    assert "big" in {h["name"] for h in ok(home, webapi.libraries, q="bi")["libraries"]}  # the name counts too
    assert len(ok(home, webapi.library, name="big")["entries"]) == 5001
    assert api(home, webapi.library, name="missing")[0] == 404


def test_libraries_carry_source_tags_and_learned_weights(home):
    (home / "library" / "gen.yaml").write_text("meta: {generated_by: Qwen3.5-4B}\nentries: [fog]\n")
    Home(home).save_weights({"__animal__=fox": 1.5})
    by = libs(home)
    assert (by["animal"]["source"], by["creature"]["source"], by["gen"]["source"]) == ("user", "builtin", "llm")
    fox = by["animal"]["entries"][0]
    assert fox == {"value": "fox", "tags": [], "weight": 1.0, "props": {}, "learned": 1.5}
    assert "deep_sea" in by["creature"]["tags"]


def test_library_save_creates_edits_and_validates(home):
    lib = ok(home, webapi.library_save, name="Weather 2",
             entries=[{"value": " fog ", "tags": ["Cold"], "weight": 2}, {"value": "rain"}])
    assert lib["name"] == "weather_2" and lib["source"] == "user"
    assert lib["entries"][0] == {"value": "fog", "tags": ["cold"], "weight": 2.0, "props": {}, "learned": 1.0}
    assert api(home, webapi.library_save, name="w", entries=[{"value": "a"}, {"value": "A"}])[0] == 400
    assert api(home, webapi.library_save, name="w", entries=[{"value": " "}])[0] == 400
    assert api(home, webapi.library_save, name="w", entries=[{"value": "a", "weight": -1}])[0] == 400
    assert api(home, webapi.library_save, name="!!", entries=[])[0] == 400


def test_library_save_accepts_an_empty_new_library(home):
    lib = ok(home, webapi.library_save, name="fresh", entries=[])
    assert (lib["name"], lib["entries"], lib["source"]) == ("fresh", [], "user")
    assert "fresh" in libs(home)


def test_library_save_refuses_builtins_until_owned(home):
    assert api(home, webapi.library_save, name="creature", entries=[{"value": "x"}])[0] == 403
    owned = ok(home, webapi.library_own, name="creature")
    assert owned["source"] == "user" and (home / "library" / "creature.yaml").exists()
    assert "builtin" not in (home / "library" / "creature.yaml").read_text()
    assert ok(home, webapi.library_save, name="creature", entries=[{"value": "x"}])["entries"][0]["value"] == "x"
    assert api(home, webapi.library_own, name="missing")[0] == 404


def test_library_save_moves_learned_weights_for_renames_and_keeps_meta(home):
    (home / "library" / "gen.yaml").write_text("meta: {generated_by: Qwen3.5-4B}\nentries: [fog]\n")
    Home(home).save_weights({"__gen__=fog": 1.5})
    lib = ok(home, webapi.library_save, name="gen", entries=[{"value": "mist"}], renames={"fog": "mist"})
    assert lib["source"] == "llm" and lib["entries"][0]["learned"] == 1.5
    assert Home(home).weights() == {"__gen__=mist": 1.5}


def test_library_delete_guards_builtins(home):
    assert api(home, webapi.library_delete, name="creature")[0] == 403
    assert api(home, webapi.library_delete, name="missing")[0] == 404
    assert ok(home, webapi.library_delete, name="style") == {"ok": True}
    assert "style" not in libs(home)


# --- galaxy ---------------------------------------------------------------------------------

def test_galaxy_rows_name_their_preset_and_filter_by_template(home, tmp_path):
    lesson = load_preset(Home(home), "tutorial/01_first_wildcard")
    a = log_row(home, tmp_path, lesson, seed=1, name="1.png")
    log_row(home, tmp_path, "something else", seed=2, name="2.png")
    rows = ok(home, webapi.galaxy)["rows"]
    assert [r["seed"] for r in rows] == [2, 1]
    assert set(rows[0]) == {"id", "ts", "seed", "target", "template", "text", "picks", "rating", "exports",
                            "media_name", "kind", "preset", "params", "collections", "album"}
    assert rows[1]["preset"] == "tutorial/01_first_wildcard" and rows[0]["preset"] is None
    assert rows[1]["media_name"] == "1.png" and rows[1]["kind"] == "image"
    only = ok(home, webapi.galaxy, template=template_hash(lesson))["rows"]
    assert [r["id"] for r in only] == [a]
    assert len(ok(home, webapi.galaxy, limit="1")["rows"]) == 1
    Home(home).save_weights({"__animal__=fox": 1.2})
    assert ok(home, webapi.galaxy)["weights"] == {"__animal__=fox": 1.2}
    assert api(home, webapi.galaxy, limit="many")[0] == 400


def test_galaxy_prefers_a_user_preset_over_a_builtin_with_the_same_text(home, tmp_path):
    lesson = load_preset(Home(home), "tutorial/01_first_wildcard")
    save_preset(Home(home), "stills/copy", lesson)
    log_row(home, tmp_path, lesson)
    assert ok(home, webapi.galaxy)["rows"][0]["preset"] == "stills/copy"


def test_rate_returns_the_row_and_its_weights(home, tmp_path):
    rid = log_row(home, tmp_path, "a __animal__")
    body = ok(home, webapi.galaxy_rate, id=rid, rating="love")
    assert body["row"]["rating"] == "love" and body["row"]["id"] == rid
    assert body["weights"] == {"__animal__=fox": 1.5}
    assert api(home, webapi.galaxy_rate, id=rid, rating="meh")[0] == 400
    assert api(home, webapi.galaxy_rate, id="000000000000", rating="love")[0] == 404


def test_the_gallery_view_shows_a_place_of_its_tree_as_cards_with_albums(home, tmp_path):
    lone = log_row(home, tmp_path, "a __animal__", seed=1, name="1.png")
    s1 = log_row(home, tmp_path, "a __animal__", seed=2, name="2.png", folder="sweeps/$view 2026-10-04 16.28")
    s2 = log_row(home, tmp_path, "a __animal__", seed=3, name="3.png", folder="sweeps/$view 2026-10-04 16.28")
    clip = log_clip(home, tmp_path, "a __animal__", seed=4, chunks=2, segment=0, chain="reels/fox", chunk=0)
    body = ok(home, webapi.galaxy_view)
    assert [(c["kind"], c.get("key") or c["id"]) for c in body["cards"]] == [
        ("row", clip), ("album", "sweep:sweeps/$view 2026-10-04 16.28"), ("row", lone)]
    album = body["cards"][1]
    assert (album["title"], album["count"], album["ids"], album["preset"]) == ("$view 2026-10-04 16.28", 2, [s2, s1], None)
    assert [r["id"] for r in body["rows"]] == [clip, lone] and body["count"] == 4
    tree = body["tree"]
    assert (tree["total"], tree["images"], tree["videos"]) == (4, 3, 1)
    assert tree["days"] == [{"day": "2026-09-24", "total": 4, "images": 3, "videos": 1}]
    assert tree["collections"] == [] and sum(tree["templates"].values()) == 4
    assert [c["id"] for c in ok(home, webapi.galaxy_view, view="videos")["cards"]] == [clip]
    assert ok(home, webapi.galaxy_view, view="images", day="2026-09-25")["cards"] == []
    assert len(ok(home, webapi.galaxy_view, view="images", day="2026-09-24")["cards"]) == 2
    assert [c["id"] for c in ok(home, webapi.galaxy_view, album="sweep:sweeps/$view 2026-10-04 16.28")["cards"]] == [s2, s1]
    assert len(ok(home, webapi.galaxy_view, flat="1")["cards"]) == 4  # a filter on: the outputs themselves
    for bad in ({"view": "audio"}, {"day": "today"}, {"album": "box:1"}, {"collection": "a//b"}, {"limit": "0"}):
        assert api(home, webapi.galaxy_view, **bad)[0] == 400


def test_a_reels_scenes_are_named_by_their_scene_lines(home, tmp_path):
    reel = "@h3 t2va\nSCENE the den\nA fox sleeps.\nSCENE the hunt\nA fox runs."
    ids = [log_clip(home, tmp_path, reel, seed=s, chunks=2, segment=s, chain="reels/fox", chunk=c)
           for s, c in ((1, 0), (2, 0), (3, 1), (4, 1))]
    [top] = ok(home, webapi.galaxy_view)["cards"]
    assert (top["type"], top["title"], top["count"]) == ("reel", "reels/fox", 4)
    scenes = ok(home, webapi.galaxy_view, album="reel:reels/fox")["cards"]
    assert [(c["title"], c["chunk"], c["ids"]) for c in scenes] == [("the hunt", 1, ids[3:1:-1]), ("the den", 0, ids[1::-1])]


def test_galaxy_collect_delete_and_export_check_their_input(home, tmp_path):
    a = log_row(home, tmp_path, "a __animal__")
    for bad in ({}, {"ids": "x"}, {"ids": []}, {"ids": [1]}):
        assert api(home, webapi.galaxy_collect, path="x", **bad)[0] == 400
    assert api(home, webapi.galaxy_collect, ids=["000000000000"], path="x")[0] == 404
    assert api(home, webapi.galaxy_collect, ids=[a], path="../x")[0] == 400
    assert api(home, webapi.galaxy_export, ids=[a], name="../x")[0] == 400
    out = ok(home, webapi.galaxy_export, ids=[a], name="set")
    assert out == {"path": str(home / "export" / "set"), "exported": 1, "skipped": 0}
    assert (home / "export" / "set" / "a.txt").read_text() == "a fox\n"
    assert ok(home, webapi.galaxy_delete, ids=[a]) == {"deleted": 1}
    assert (home / "trash" / "a.png").exists()
    assert api(home, webapi.galaxy_delete, ids=[a])[0] == 404


def test_galaxy_collections_are_filled_emptied_added_renamed_and_deleted(home, tmp_path):
    a = log_row(home, tmp_path, "a __animal__", seed=1, name="1.png")
    b = log_row(home, tmp_path, "a __animal__", seed=2, name="2.png")
    assert ok(home, webapi.galaxy_collection_add, path="keep")["collections"] == [{"path": "keep", "count": 0}]
    assert api(home, webapi.galaxy_collection_add, path="keep")[0] == 409
    assert api(home, webapi.galaxy_collection_add, path="")[0] == 400
    body = ok(home, webapi.galaxy_collect, ids=[a, b], path="foxes/snow")
    assert body["collected"] == 2 and {"path": "foxes/snow", "count": 2} in body["collections"]
    ok(home, webapi.galaxy_collect, ids=[a], path="keep")
    shown = ok(home, webapi.galaxy_view, collection="foxes/snow")
    assert [c["id"] for c in shown["cards"]] == [b, a] and shown["rows"][1]["collections"] == ["foxes/snow", "keep"]
    assert ok(home, webapi.galaxy_uncollect, ids=[a], path="foxes/snow")["removed"] == 1
    assert [c["id"] for c in ok(home, webapi.galaxy_view, collection="foxes/snow")["cards"]] == [b]
    body = ok(home, webapi.galaxy_collection_rename, path="foxes", to="keep/foxes")
    assert [c["path"] for c in body["collections"]] == ["keep", "keep/foxes", "keep/foxes/snow"]
    assert api(home, webapi.galaxy_collection_rename, path="keep", to="keep/foxes/x")[0] == 400
    assert api(home, webapi.galaxy_collection_rename, path="nope", to="x")[0] == 404
    body = ok(home, webapi.galaxy_collection_delete, path="keep")
    assert body["path"] == "" and [c["path"] for c in body["collections"]] == ["foxes", "foxes/snow"]
    assert [c["id"] for c in ok(home, webapi.galaxy_view, collection="foxes/snow")["cards"]] == [b]
    assert api(home, webapi.galaxy_collection_delete, path="keep")[0] == 404


def test_thumb_and_media_return_files(home, tmp_path):
    rid = log_row(home, tmp_path, "a __animal__")
    assert isinstance(ok(home, webapi.galaxy_thumb, id=rid), Path)
    assert ok(home, webapi.galaxy_media, id=rid).name == "a.png"
    assert api(home, webapi.galaxy_thumb, id="nope")[0] == 404


# --- roll -----------------------------------------------------------------------------------

def test_roll_expands_consecutive_seeds(home):
    rolls = ok(home, webapi.roll, template="a __animal__", seed=7)["rolls"]
    assert [r["seed"] for r in rolls] == [7, 8, 9]
    assert set(rolls[0]) == {"seed", "text", "picks", "lint"}
    assert rolls[0]["picks"][0]["keys"][0].startswith("__animal__=") and rolls[0]["lint"] == []


def test_roll_compiles_screenplays_with_lint(home):
    rolls = ok(home, webapi.roll, template="@h3 t2va\nSHOT 2s\nA __animal__.\n", seed=1, n=1,
               target="h3-base")["rolls"]
    assert len(rolls) == 1 and rolls[0]["text"].startswith("integrated_multimodal_description")
    assert any("4–15" in i["message"] for i in rolls[0]["lint"])


def test_roll_shows_every_chunk_of_a_reel_at_one_seed(home):
    reel = "@h3 t2va\n$hero = __animal__\nCHUNK\nSHOT 5s\nA $hero.\nSFX: x\nCHUNK\nSHOT 5s\nThe $hero naps.\nSFX: y\n"
    rolls = ok(home, webapi.roll, template=reel, seed=4, target="h3-base")["rolls"]
    assert [(r["seed"], r["segment"]) for r in rolls] == [(4, 0), (4, 1)]
    assert "naps" in rolls[1]["text"] and "naps" not in rolls[0]["text"]


def test_roll_warns_about_loras_it_cannot_find(home, monkeypatch):
    import sys
    import types
    module = types.ModuleType("folder_paths")
    module.get_filename_list = lambda kind: ["x/all.safetensors"] if kind == "loras" else []
    monkeypatch.setitem(sys.modules, "folder_paths", module)
    text = "@h3 t2va\nLORA: <lora:all:1> <lora:gone:1>\nSHOT 5s\nA.\nSFX: x\n"
    [roll] = ok(home, webapi.roll, template=text, seed=1, n=1, target="h3-base")["rolls"]
    assert [i["message"] for i in roll["lint"] if "lora" in i["message"].lower()] == [
        next(i["message"] for i in roll["lint"] if "gone" in i["message"])]


def test_roll_pages_through_the_clips_of_a_forever_loop(home):
    reel = "@h3 t2va\nCHUNK a\nSHOT 5s\nA.\nSFX: x\nCHUNK b repeat forever\nSHOT 5s\nB.\nSFX: y\n"
    rolls = ok(home, webapi.roll, template=reel, seed=2, target="h3-base", start=10)["rolls"]
    assert [r["segment"] for r in rolls] == list(range(10, 10 + webapi.ROLL_CLIPS))


def freq_table(body):
    return {entry["label"]: {v["value"]: v["count"] for v in entry["values"]} for entry in body["labels"]}


def test_frequency_counts_every_value_over_many_seeds(home):
    body = ok(home, webapi.frequency, template="a __animal__ in {mist|snow:3}", seed=1, n=200)
    table = freq_table(body)
    assert body["runs"] == 200
    assert set(table["__animal__"]) == {"fox", "heron", "owl"} and sum(table["__animal__"].values()) == 200
    assert 120 < table["{mist|snow}"]["snow"] < 180
    counts = [v["count"] for v in body["labels"][0]["values"]]
    assert counts == sorted(counts, reverse=True)


def test_frequency_counts_multi_picks_value_by_value_and_applies_dials(home):
    body = ok(home, webapi.frequency, template="$a = __animal__\n{2$$__style__} $a", seed=1, n=50,
              params={"a": "lynx"})
    table = freq_table(body)
    assert sum(table["__style__ ×2"].values()) == 100 and "$a ← __animal__" not in table


def test_frequency_across_the_clips_of_a_reel(home):
    reel = "@h3 t2va\n$w = {pool|garage}\nCHUNK a\nSHOT 5s\nA.\nSFX: x\nCHUNK b repeat forever\n$n = {1|2|3}\nSHOT 5s\nB $n.\nSFX: y\n"
    body = ok(home, webapi.frequency, template=reel, seed=3, n=40, target="h3-base", across="clips")
    table = freq_table(body)
    assert body["runs"] == 40 and len(table["{pool|garage}"]) == 1
    assert sum(table["{1|2|3}"].values()) == 39


def test_a_count_loads_the_libraries_once_however_many_rolls(home, monkeypatch):
    from orrery.home import Home
    loads, real = [], Home.libraries
    monkeypatch.setattr(Home, "libraries", lambda self: loads.append(1) or real(self))
    counts = []
    for fn, n in ((webapi.frequency, 5), (webapi.frequency, 50), (webapi.roll, 1), (webapi.roll, 6)):
        loads.clear()
        ok(home, fn, template="a __animal__", seed=1, n=n)
        counts.append(len(loads))
    assert counts == [1, 1, 1, 1]


def test_frequency_counts_lint_and_caps_the_runs(home):
    body = ok(home, webapi.frequency, template="@h3 t2va\nSHOT 2s\nA.\nSFX: x\n", seed=1, n=5000, target="h3-base")
    assert body["runs"] == webapi.MAX_FREQUENCY
    assert any("4–15" in m["message"] and m["count"] == body["runs"] for m in body["lint"])
    status, _ = api(home, webapi.frequency, template="a", seed=1, across="clips")
    assert status == 400


def test_llm_settings_list_text_encoders_and_are_saved(home, monkeypatch):
    import sys
    import types
    module = types.ModuleType("folder_paths")
    module.get_filename_list = lambda kind: ["qwen3vl_4b_bf16.safetensors", "qwen3vl_32b_minimax_h3_int8_convrot.safetensors"] if kind == "text_encoders" else []
    module.get_full_path = lambda kind, name: None
    monkeypatch.setitem(sys.modules, "folder_paths", module)
    body = ok(home, webapi.llm_settings)
    assert (body["file"], body["entries"]) == (None, 12)
    assert [(f["name"], f["can_write"]) for f in body["files"]] == [
        ("qwen3vl_4b_bf16.safetensors", True), ("qwen3vl_32b_minimax_h3_int8_convrot.safetensors", False)]
    assert body["max_tokens"] == 16000
    ok(home, webapi.llm_save, file="qwen3vl_4b_bf16.safetensors", entries=20, max_tokens=4000)
    body = ok(home, webapi.llm_settings)
    assert (body["file"], body["entries"], body["max_tokens"]) == ("qwen3vl_4b_bf16.safetensors", 20, 4000)
    status, _ = api(home, webapi.llm_save, file="qwen3vl_32b_minimax_h3_int8_convrot.safetensors")
    assert status == 400



def test_an_api_endpoint_is_saved_only_once_it_answers_and_its_key_never_comes_back(home, fake_api):
    fake_api.key = "sk-right-0042"
    status, body = api(home, webapi.llm_save, source="api", base_url=fake_api.url, model="gpt-5.4-mini", key="sk-wrong")
    assert status == 400 and "refused the key" in body["error"] and not (home / ".env").exists()
    body = ok(home, webapi.llm_save, source="api", base_url=fake_api.url, model="gpt-5.4-mini", key="sk-right-0042")
    assert body["active"] == {"kind": "api", "name": "gpt-5.4-mini"}
    assert body["api"]["key"] == "…0042" and body["api"]["key_from"] == "file" and "sk-right" not in json.dumps(body)
    assert "sk-right" not in (home / "orrery.yaml").read_text() and "sk-right-0042" in (home / ".env").read_text()
    body = ok(home, webapi.llm_save, source="api", model="gpt-6-luna")  # the stored key and URL stay
    assert body["api"]["model"] == "gpt-6-luna" and body["api"]["base_url"] == fake_api.url
    asked = len(fake_api.requests)  # #212: a setting saved on its own asks the endpoint nothing
    assert ok(home, webapi.llm_save, source="api", entries=30)["entries"] == 30 and len(fake_api.requests) == asked
    assert ok(home, webapi.llm_save, source="comfy")["active"] is None


def test_the_check_offers_the_endpoints_chat_models(home, fake_api):
    body = ok(home, webapi.llm_check, base_url=fake_api.url, model="gpt-6-luna", key="sk-any")
    assert body["ok"] and body["models"] == ["gpt-5.4-mini", "gpt-6-luna"]


def test_the_write_menu_asks_the_endpoint_outside_the_queue(home, fake_api, tmp_path, monkeypatch):
    status, body = api(home, webapi.write_idea, task="describe", template="a cat")
    assert status == 400 and "queue" in body["error"]
    Home(home).save_config({"llm": {"source": "api", "api": {"base_url": fake_api.url, "model": "gpt-5.4-mini"}}})
    fake_api.answer = lambda body: "A tabby cat asleep on a sunlit windowsill."
    picture = tmp_path / "cat.png"
    Image.new("RGB", (64, 48), "orange").save(picture)
    monkeypatch.setattr(webapi, "_input_picture", lambda name: picture if name else None)
    body = ok(home, webapi.write_idea, task="describe", template="a cat", seed=3, frames={"first_frame": "cat.png"})
    assert body["text"] == "A tabby cat asleep on a sunlit windowsill." and body["template"].startswith("A tabby cat")
    content = fake_api.requests[-1]["messages"][0]["content"]
    assert content[0]["type"] == "image_url" and fake_api.requests[-1]["temperature"] == 0.8  # the writers' own
    fake_api.answer = lambda body: "A cat curled on a red cushion."
    body = ok(home, webapi.write_idea, task="describe", template="a cat", steer="cosier")
    assert body["text"] == "A cat curled on a red cushion."  # no picture wired: written from the prompt (#334)
    said = fake_api.requests[-1]["messages"][0]["content"]
    said = said if isinstance(said, str) else said[-1]["text"]
    assert "No pictures came along this time" in said and "The direction, which outweighs everything above: cosier." in said


def test_write_now_writes_the_templates_open_libraries(home, fake_api):
    status, _ = api(home, webapi.write_libraries, template="a __runway_shoes__")
    assert status == 400
    Home(home).save_config({"llm": {"source": "api", "api": {"base_url": fake_api.url, "model": "gpt-5.4-mini"},
                                    "entries": 3}})
    fake_api.answer = lambda body: json.dumps(["velvet mule", "chrome boot", "paper sandal"])
    body = ok(home, webapi.write_libraries, template="# __not_this__\na $x in __runway_shoes__\n$x = {__animal:4__}",
              params={"x": "__runway_hats__"})
    assert sorted(body["asked"]) == ["runway_hats", "runway_shoes"] and len(fake_api.requests) == 2  # the dial wins
    assert {"runway_shoes", "runway_hats"} <= set(Home(home).libraries()) and len(body["notes"]) == 2
    assert ok(home, webapi.write_libraries, template="a __runway_shoes__") == {"asked": [], "notes": []}

def test_llm_made_libraries_are_accepted_or_discarded(home):
    lib = home / "library"
    (lib / "runway_shoes.yaml").write_text("meta: {generated_by: qwen, pending: true, directions: short}\nentries: [mule, boot]\n")
    (lib / "animal.yaml").write_text("meta: {pending_entries: [lynx]}\nentries: [fox, heron, owl, lynx]\n")
    listed = {l["name"]: l for l in ok(home, webapi.libraries)["libraries"]}
    assert listed["runway_shoes"]["pending"] and listed["runway_shoes"]["directions"] == "short"
    assert listed["animal"]["pending_count"] == 1 and not listed["animal"]["pending"]
    assert ok(home, webapi.library, name="animal")["pending_entries"] == ["lynx"]
    ok(home, webapi.library_accept, name="runway_shoes")
    ok(home, webapi.library_discard, name="animal")
    listed = libs(home)
    assert not listed["runway_shoes"]["pending"] and listed["runway_shoes"]["directions"] == "short"
    assert [e["value"] for e in listed["animal"]["entries"]] == ["fox", "heron", "owl"] and listed["animal"]["pending_entries"] == []
    (lib / "shoes2.yaml").write_text("meta: {pending: true}\nentries: [clog]\n")
    ok(home, webapi.library_discard, name="shoes2")
    assert not (lib / "shoes2.yaml").exists()


def test_folder_and_text_libraries_through_the_api(home):
    lib = home / "library"
    (lib / "film").mkdir()
    (lib / "film" / "genre.txt").write_text("noir\nwestern\n")
    listed = libs(home)
    assert listed["film/genre"]["source"] == "user" and [e["value"] for e in listed["film/genre"]["entries"]] == ["noir", "western"]
    ok(home, webapi.library_save, name="film/genre", entries=[{"value": "noir", "tags": ["dark"]}, {"value": "western"}])
    assert (lib / "film" / "genre.yaml").exists() and not (lib / "film" / "genre.txt").exists()
    ok(home, webapi.library_save, name="Film/New Moods", entries=[{"value": "tense"}])
    assert (lib / "film" / "new_moods.yaml").exists()
    (lib / "film" / "old.txt").write_text("x\n")
    ok(home, webapi.library_delete, name="film/old")
    assert not (lib / "film" / "old.txt").exists()
    status, _ = api(home, webapi.library_save, name="../escape", entries=[{"value": "x"}])
    assert status == 400 or not (home.parent / "escape.yaml").exists()


def test_the_home_folder_is_read_and_set_through_the_api(home, monkeypatch, tmp_path):
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "config"))
    body = ok(home, webapi.home_settings)
    assert body["source"] == "env" and body["setting"] == ""
    monkeypatch.delenv("ORRERY_HOME")
    body = ok(home, webapi.home_save, path=str(tmp_path / "elsewhere"))
    assert (body["home"], body["source"], body["setting"]) == (str(tmp_path / "elsewhere"), "setting", str(tmp_path / "elsewhere"))
    status, _ = api(home, webapi.home_save, path="relative/path")
    assert status == 400


def test_roll_applies_dials(home):
    rolls = ok(home, webapi.roll, template="$hero = __animal__\na $hero", seed=1, n=2, params={"hero": "lynx"})["rolls"]
    assert [r["text"] for r in rolls] == ["a lynx", "a lynx"]


def test_galaxy_rows_carry_their_dials(home, tmp_path):
    log_row(home, tmp_path, "$hero = __animal__\na $hero", params={"hero": "lynx"})
    [row] = ok(home, webapi.galaxy)["rows"]
    assert row["params"] == {"hero": "lynx"}


@pytest.mark.parametrize("args", [{"template": "a __smell__", "seed": 1},
                                  {"template": "x", "seed": "soon"},
                                  {"template": "x", "seed": 1, "target": "poster"}])
def test_roll_rejects_bad_input(home, args):
    status, body = api(home, webapi.roll, **args)
    assert status == 400 and body["error"]


def test_a_recorded_preset_keeps_its_outputs_after_the_text_changes(home, tmp_path):
    h = Home(home)
    save_preset(h, "stills/fox", "a __animal__")
    kept = log_row(home, tmp_path, "a __animal__", seed=1, name="a.png", preset="stills/fox", edited=False)
    variant = log_row(home, tmp_path, "a __animal__ at night", seed=2, name="b.png", preset="stills/fox", edited=True)
    save_preset(h, "stills/fox", "a __animal__ in fog", overwrite=True)
    card = next(c for c in ok(home, webapi.presets)["presets"] if c["name"] == "stills/fox")
    assert (card["outputs"], card["thumb"]) == (1, kept)
    rows = {r["id"]: r for r in ok(home, webapi.galaxy)["rows"]}
    assert rows[kept]["preset"] == "stills/fox" and rows[variant]["preset"] is None
    assert [r["id"] for r in ok(home, webapi.galaxy, preset="stills/fox")["rows"]] == [kept]


def test_a_recorded_preset_that_no_longer_exists_falls_back_to_the_hash(home, tmp_path):
    save_preset(Home(home), "stills/owl", "an owl")
    rid = log_row(home, tmp_path, "an owl", preset="gone/away", edited=False)
    assert {r["id"]: r for r in ok(home, webapi.galaxy)["rows"]}[rid]["preset"] == "stills/owl"


def test_cards_preview_and_count_only_outputs_with_a_file(home, tmp_path):
    save_preset(Home(home), "stills/owl", "an owl")
    shown = log_row(home, tmp_path, "an owl", seed=1)
    log_row(home, tmp_path, "an owl", seed=2, name="b.png", media=None)
    card = next(c for c in ok(home, webapi.presets)["presets"] if c["name"] == "stills/owl")
    assert (card["outputs"], card["thumb"]) == (1, shown)


def test_properties_travel_through_the_libraries_tab(home):
    """The tab saves the whole list; properties it did not send back would be lost on the first edit."""
    lib = ok(home, webapi.library_save, name="people",
             entries=[{"value": "Mara", "props": {"Gender": "female", "age": "30s"}}, {"value": "Tomas"}])
    assert lib["entries"][0]["props"] == {"age": "30s", "gender": "female"} and lib["entries"][1]["props"] == {}
    assert api(home, webapi.library_save, name="people",
               entries=[{"value": "Mara", "props": {"a key!": "female"}}])[0] == 400
    lib = ok(home, webapi.library_save, name="rainfall",
             entries=[{"value": "snow", "props": {"sfx": "footsteps  crunch in snow"}}])
    assert lib["entries"][0]["props"] == {"sfx": "footsteps crunch in snow"}


def test_renaming_through_the_tab_reports_what_followed(home):
    ok(home, webapi.library_save, name="film_moods", entries=[{"value": "a hush"}])
    out = ok(home, webapi.library_rename, name="film_moods", to="film/moods")
    assert out == {"name": "film/moods", "weights": 0, "libraries": [], "presets": []}
    assert api(home, webapi.library_rename, name="camera", to="cam")[0] == 400


def test_outputs_of_ordinary_save_nodes_reach_the_galaxy(home, tmp_path, monkeypatch):
    """Generate without Orrery Log: the node remembers its picks per prompt; the browser reports the files."""
    from orrery import runs
    out = tmp_path / "output"
    (out / "video").mkdir(parents=True)
    (out / "video" / "clip_00001_.mp4").write_bytes(b"x")
    monkeypatch.setattr(webapi, "_output_dir", lambda: out)
    runs.remember("p1", "9", json.dumps({"seed": 7, "text": "a fox", "picks": [], "template": "abc"}))
    media = [{"filename": "clip_00001_.mp4", "subfolder": "video", "type": "output"},
             {"filename": "preview.png", "subfolder": "", "type": "temp"}]
    assert ok(home, webapi.galaxy_capture, prompt_id="p1", node="9", media=media) == {"logged": 1}
    rows = [json.loads(line) for line in (home / "galaxy.jsonl").read_text().splitlines()]
    assert rows[-1]["media"] == str(out / "video" / "clip_00001_.mp4") and rows[-1]["seed"] == 7
    assert api(home, webapi.galaxy_capture, prompt_id="nope", node="9", media=media)[0] == 404
    bad = [{"filename": "../../etc/passwd", "subfolder": "", "type": "output"}]
    assert ok(home, webapi.galaxy_capture, prompt_id="p1", node="9", media=bad) == {"logged": 0}


# --- the timeline: the chain's clips and the sent frames ----------------------------------------

def fake_chain(output, folder="h3_context", clips=2):
    import av
    run = output / folder / "chain_video" / "run_1"
    run.mkdir(parents=True)
    folders = []
    for i in range(1, clips + 1):
        folder = run / f"clip_{i:05d}_abc"
        folder.mkdir()
        with av.open(str(folder / "video.mp4"), "w") as out:
            stream = out.add_stream("mpeg4", rate=24)
            stream.width, stream.height, stream.pix_fmt = 64, 48, "yuv420p"
            for _ in range(24):
                for packet in stream.encode(av.VideoFrame.from_image(Image.new("RGB", (64, 48), (40 * i, 0, 0)))):
                    out.mux(packet)
            for packet in stream.encode():
                out.mux(packet)
        folders.append({"folder": folder.name, "frames": 24})
    (run.parent / "active.json").write_text(json.dumps({"run": "run_1"}))
    (run / "clips.json").write_text(json.dumps({"settings": [64, 48, "24", 48000, 2], "clips": folders}))


def test_the_chain_lists_its_clips_by_segment_and_serves_them(home, tmp_path, monkeypatch):
    out = tmp_path / "out"
    fake_chain(out)
    monkeypatch.setattr(webapi, "_output_dir", lambda: out)
    body = ok(home, webapi.chain)
    assert body == {"chain": "h3_context", "width": 64, "height": 48,  # Chain Video keeps one size per chain
                    "clips": [{"segment": 0, "frames": 24, "version": "clip_00001_abc"},
                              {"segment": 1, "frames": 24, "version": "clip_00002_abc"}], "takes": {}}
    assert ok(home, webapi.chain_video, segment="1").name == "video.mp4"
    thumb = ok(home, webapi.chain_thumb, segment="0")
    assert thumb.suffix == ".webp" and thumb.is_file()
    assert api(home, webapi.chain_video, segment="5")[0] == 404
    assert ok(home, webapi.chain, chain="nowhere") == {"chain": "nowhere", "width": None, "height": None, "clips": [], "takes": {}}
    assert api(home, webapi.chain, chain="../../etc")[0] in (400, 200)


def test_an_unsaved_reels_folder_moves_to_its_presets_name(home, tmp_path, monkeypatch):
    """Saved as a preset after three clips, the reel goes on with clip 4 (#197)."""
    out = tmp_path / "out"
    fake_chain(out, "reels/untitled/2026-10-03 23-15")
    monkeypatch.setattr(webapi, "_output_dir", lambda: out)
    body = ok(home, webapi.chain_move, **{"from": "reels/untitled/2026-10-03 23-15", "to": "reels/h3/night_watch"})
    assert body == {"moved": True, "chain": "reels/h3/night_watch"}
    assert (out / "reels/h3/night_watch/chain_video").is_dir() and not (out / "reels/untitled/2026-10-03 23-15").exists()
    assert len(ok(home, webapi.chain, chain="reels/h3/night_watch")["clips"]) == 2
    fake_chain(out, "reels/untitled/second")
    body = ok(home, webapi.chain_move, **{"from": "reels/untitled/second", "to": "reels/h3/night_watch"})
    assert body["moved"] is False and body["chain"] == "reels/untitled/second" and "already holds" in body["reason"]
    assert ok(home, webapi.chain_move, **{"from": "reels/untitled/none", "to": "reels/new"}) == {"moved": False, "chain": "reels/new"}
    for bad in ({"from": "", "to": "reels/x"}, {"from": "h3_context", "to": "reels/x"}, {"from": "reels/../..", "to": "reels/x"}):
        assert api(home, webapi.chain_move, **bad)[0] == 400


def test_an_anchor_is_served_by_image_number(home):
    import numpy as np

    from orrery import anchors
    anchors.save(Home(home), 3, np.zeros((2, 8, 8, 3), dtype=np.float32))
    assert ok(home, webapi.anchor, image="3").name == "0000.png"
    assert api(home, webapi.anchor, image="4")[0] == 404
    assert api(home, webapi.anchor, image="x")[0] == 400
    assert ok(home, webapi.anchors_stored) == {"images": [3]}  # the ones keep_sent would hold (#371)


def test_the_editor_switches_travel_with_the_presets_and_are_saved(home):
    assert ok(home, webapi.presets)["dividers"] is True and ok(home, webapi.presets)["timeline"] is True
    assert ok(home, webapi.ui_save, timeline=False) == {"quickstart": True, "dividers": True, "timeline": False, "log_prompts": True,
                                                         "surf_numbered": True, "preview_light": True, "clip_min": 360, "take_min": 54, "anchor_h": 72, "preview_fps": 12, "preview_edge": 1024,
                                                         "annotations_show": "appended", "picture_slots": "gallery"}
    assert ok(home, webapi.ui_save, clip_min=480)["clip_min"] == 480 and ok(home, webapi.presets)["clip_min"] == 480
    assert ok(home, webapi.presets)["timeline"] is False
    assert ok(home, webapi.ui_save, annotations_show="hover")["annotations_show"] == "hover"  # #203
    assert ok(home, webapi.presets)["annotations_show"] == "hover"
    assert api(home, webapi.ui_save, annotations_show="sideways")[0] == 400


def test_the_history_lists_runs_newest_first_and_searches(home):
    from orrery import history
    for seed, text in ((1, "a heron at dawn"), (2, "a fox in the snow"), (3, "a heron at dusk")):
        history.record(Home(home), {"seed": seed, "target": "text", "template": "0123456789abcdef", "text": text,
                                    "picks": [], "params": {}})
    body = ok(home, webapi.history_runs)
    assert body["total"] == 3 and [r["seed"] for r in body["runs"]] == [3, 2, 1]
    assert [r["seed"] for r in ok(home, webapi.history_runs, q="heron", limit="1")["runs"]] == [3]
    assert ok(home, webapi.history_runs, q="heron", offset="1")["runs"][0]["seed"] == 1


def test_generate_plans_a_lora_sweep_times_a_grid(home):
    body = ok(home, webapi.generate_plan, template="a __animal__ at {dawn|noon} @x(0.5,1.0)\n@grid __animal__ × {dawn|noon}")
    assert body == {"runs": 12, "formula": "2 × grid 3 × 2", "first": "x"}
    assert ok(home, webapi.generate_plan, template="a __animal__ at {dawn|noon}\n@grid {dawn|noon}") == \
        {"runs": 2, "formula": "grid 2", "first": "{dawn|noon}"}
    assert ok(home, webapi.generate_plan, template="a __animal__")["runs"] == 0
    status, body = api(home, webapi.generate_plan, template="a __animal__\n@grid __style__")
    assert status == 400 and "doesn't use it" in body["error"]


def test_the_app_gets_the_path_a_reel_takes_at_its_seed(home):
    loop = "@h3 t2va\nCHUNK a\nSHOT 5s\nA.\nCHUNK b\nSHOT 5s\nB.\nGOTO: a ×1"
    assert ok(home, webapi.reel_walk, template=loop, seed=3) == {"path": [0, 1, 0, 1], "ended": True}
    endless = ok(home, webapi.reel_walk, template=loop.replace(" ×1", ""), seed=3)
    assert endless["ended"] is False and endless["path"][:5] == [0, 1, 0, 1, 0]
    assert ok(home, webapi.reel_walk, template="a fox", seed=1) == {"path": [], "ended": True}


def test_the_app_learns_where_each_remember_line_goes(home):
    reel = ("@h3 references\nCAST\n@WOMAN: a woman\nSCENE a\nSHOT 5s\nREMEMBER: frame 0 as @WOMAN\n"
            "REMEMBER: frame 50 as @WOMAN\n@WOMAN waves.\nSCENE b\nSHOT 5s\n@WOMAN sits.")
    lines = ok(home, webapi.reel_remembered, template=reel, seed=0)["lines"]
    assert [(line["line"], line["source"], [f["what"] for f in line["fills"]]) for line in lines] == \
        [(0, 0, ["image 1"]), (1, 0, ["image 1"])]
    assert lines[0]["fills"][0]["replaced"] == {"from": 1, "by": 1} and lines[1]["fills"][0]["replaced"] is None
    assert ok(home, webapi.reel_remembered, template="a fox", seed=0) == {"lines": []}
    status, body = api(home, webapi.reel_remembered, template=reel.replace("as @WOMAN", "as @CAT", 1))
    assert status == 400 and "CAT is not in a CAST" in body["error"]


def test_the_writer_texts_are_read_edited_and_reset(home):
    body = ok(home, webapi.writer_texts)
    assert set(body) == {"continue", "story", "story_scenes", "story_keyframes", "describe", "describe_shot", "describe_shot_into"} and body["continue"]["edited"] is False
    edited = ok(home, webapi.writer_save, name="story", text="Write {seconds} seconds.")
    assert edited["edited"] is True and edited["text"].startswith("Write {seconds}")
    assert ok(home, webapi.writer_save, name="story", text=None)["edited"] is False
    assert api(home, webapi.writer_save, name="nope", text="x")[0] == 400


def test_annotate_says_what_each_line_gives_at_a_seed(home):
    """#163: bindings as they rolled, exports, a grid's cells, where a CAST member's pictures go."""
    text = "$a = __animal__\n$plain = a grey wall\nEXPORT: mood = {calm|grim}\n@grid {dawn|noon}\nA $a at {dawn|noon}."
    out = ok(home, webapi.annotate, template=text, seed=3, target="text")
    assert out["bindings"]["a"] in ("fox", "heron", "owl") and out["bindings"]["plain"] == "a grey wall"
    assert out["exports"]["mood"] in ("calm", "grim") and out["grid"] == "2 runs: dawn · noon"
    screenplay = "@h3 references\nCAST\n@HERO (image 2): a tall man\n@DOG: a dog\nSHOT 5s: static\n@HERO walks @DOG."
    out = ok(home, webapi.annotate, template=screenplay.replace("SHOT 5s", "SET: @HERO(0.6, 35%)\nSHOT 5s"), seed=1,
             target="h3-base")
    assert out["cast"] == {"HERO": "image 2", "DOG": "no picture in this clip"}
    assert out["members"]["HERO"] == {"who": "a tall man", "pictures": [{"image": 2, "strength": 0.6, "from": 0.35, "to": 1.0}],
                                      "refmods": [], "voice": ""}  # the hover's record (#147)
    assert ok(home, webapi.annotate, template="A __missing_lib__.", seed=1, target="text")["bindings"] == {}  # never fails
    held = ok(home, webapi.annotate, template="$a = __animal__\nEXPORT: mood = __moods__\nA $a.", seed=3, target="text")
    assert held["bindings"]["a"] in ("fox", "heron", "owl") and held["exports"]["mood"] == "__moods__"  # one missing library


def test_a_clips_takes_are_listed_served_picked_and_deleted(home, tmp_path, monkeypatch):
    """Sample surfing (#206) through the routes: the takes of clip 2, one of them picked, one deleted (#214); clip 1's
    one take is listed too, as its strip shows every clip's takes from the first (#319)."""
    import numpy as np

    from orrery import film
    from orrery.continuum.masked import Tail
    out = tmp_path / "out"
    monkeypatch.setattr(webapi, "_output_dir", lambda: out)
    tail = Tail(np.zeros((1, 24, 7, 3, 4), np.float32), np.zeros((1, 32, 2, 37), np.float32), 0.25)
    def make(segment, take):
        frames = [np.full((48, 64, 3), 40 * take, np.uint8) for _ in range(24)]
        return film.save_take(out, "reels/a", segment, frames, np.zeros((2, 48000), np.float32), 48000, tail,
                              {"seed": 7, "take": take}, -1)
    make(0, 0)
    surf = [make(1, k) for k in range(3)]
    listed = ok(home, webapi.chain, chain="reels/a")["takes"]
    assert list(listed) == ["0", "1"] and [t["take"] for t in listed["1"]] == [0, 1, 2]
    assert len(listed["0"]) == 1 and listed["0"][0]["active"]  # its one take, circled
    assert ok(home, webapi.chain_video, chain="reels/a", take=surf[0].name) == surf[0] / "video.mp4"
    assert ok(home, webapi.chain_pick, chain="reels/a", segment=1, folder=surf[1].name)["take"] == 1
    assert api(home, webapi.chain_pick, chain="reels/a", segment=1, folder="seg_0001_nothere1")[0] == 400
    assert ok(home, webapi.chain_delete, chain="reels/a", segment=1, folder=surf[1].name)["folder"] == surf[2].name
    assert not surf[1].exists()
    assert api(home, webapi.chain_delete, chain="reels/a", segment=1, folder=surf[1].name)[0] == 400
    assert ok(home, webapi.chain_clear, chain="reels/a", segment=1, keep=True)["deleted"] == 1  # #234: all but the film's
    assert ok(home, webapi.chain_clear, chain="reels/a", segment=1, keep=False) == {"deleted": 1, "folder": None}
    assert api(home, webapi.chain_clear, chain="reels/a", segment=1)[0] == 400  # none left
    grown = ok(home, webapi.chain_tree, chain="reels/a")  # #240: the tree, then a walk and an end
    assert len(grown["takes"]) == 1 and grown["path"] == [grown["takes"][0]["folder"]]
    assert ok(home, webapi.chain_walk, chain="reels/a", folder=grown["takes"][0]["folder"])["clips"] == 1
    assert ok(home, webapi.chain_end, chain="reels/a", segment=0) == {"clips": 1}
    assert ok(home, webapi.chain_video, chain="reels/a", film=1).name == "film.mp4"  # #243: the film to watch
    assert api(home, webapi.chain_video, chain="reels/none", film=1)[0] == 404
    assert api(home, webapi.chain_walk, chain="reels/a", folder="seg_0009_nothere1")[0] == 400


def test_every_library_in_a_line_says_what_it_rolled_where_it_is_written(home):
    """#202: each library of a line its own roll, by its place among the line's libraries; one in a branch that
    did not roll says nothing, one used twice says it twice. A text template and a screenplay alike."""
    from orrery.dsl import expand
    from orrery.home import Home

    libs = Home(home).libraries()
    text = "# a comment\n$a = __animal__\nA __animal__ in __style__,\n{__style__ ink|plain} beside __animal__."
    for seed in range(12):
        out = ok(home, webapi.annotate, template=text, seed=seed, target="text")
        x = expand(text, seed, libs)
        first, second = out["rolls"]["2"], out["rolls"]["3"]
        assert [k for k, _ in first] == [0, 1] and first[0][1] in ("fox", "heron", "owl") and first[1][1] in ("linocut", "gouache")
        assert first[0][1] in x.text and first[1][1] in x.text
        branch = "ink" in x.text  # the brace rolled its library, or the plain branch
        assert [k for k, _ in second] == ([0, 1] if branch else [1])  # k counts the line's __…__: the second is __animal__
        assert second[-1][1] in ("fox", "heron", "owl") and second[-1][1] in x.text.split("beside")[-1]
    assert "1" not in out["rolls"]  # the binding's line says it as a binding
    screenplay = "@h3 t2va\n$x = __style__\nSHOT 5s: static\nA __animal__ and an __animal__ in __style__.\nSFX: __animal__ calls"
    out = ok(home, webapi.annotate, template=screenplay, seed=4, target="h3-base")
    assert [k for k, _ in out["rolls"]["3"]] == [0, 1, 2] and [k for k, _ in out["rolls"]["4"]] == [0]
    assert "1" not in out["rolls"] and out["bindings"]["x"] in ("linocut", "gouache")


def test_takes_at_the_line_ask_the_endpoint_for_one_place_at_the_seed(home, fake_api):
    """#173: a slot, a library still to be written and a > enhance line, each its place marked in the prompt as it
    rolls; a steer and the takes written before go with the next ones."""
    template = "A __animal__ with --one small object in its paws--, under a __sky_kind__.\n> make it moody"
    status, body = api(home, webapi.llm_takes, kind="slot", what="one small object in its paws", template=template)
    assert status == 400 and "API endpoint" in body["error"]
    Home(home).save_config({"llm": {"source": "api", "api": {"base_url": fake_api.url, "model": "gpt-5.4-mini"}}})
    fake_api.answer = lambda body: json.dumps(["a brass key", "a cracked marble", "a folded note", "a fourth"])
    body = ok(home, webapi.llm_takes, kind="slot", what="one small object in its paws", template=template, seed=4,
              steer="older, worn", have=["a red ball"])
    assert body["takes"] == ["a brass key", "a cracked marble", "a folded note"]  # three, as asked
    prompt = fake_api.requests[-1]["messages"][0]["content"]
    prompt = prompt if isinstance(prompt, str) else prompt[-1]["text"]
    assert "[this part]" in prompt and "--one small object" not in prompt and "__sky_kind__" in prompt  # rolled, the place marked
    assert "Steer them: older, worn." in prompt and "- a red ball" in prompt and fake_api.requests[-1]["temperature"] == 0.8
    body = ok(home, webapi.llm_takes, kind="library", what="sky_kind", template=template, seed=4, directions="weather words")
    prompt = fake_api.requests[-1]["messages"][0]["content"]
    prompt = prompt if isinstance(prompt, str) else prompt[-1]["text"]
    assert "__sky_kind__: 12 entries." in prompt and "Directions: weather words" in prompt  # the library, as a run asks (#272)
    assert len(body["takes"]) == 4
    ok(home, webapi.llm_takes, kind="enhance", what="make it moody", template=template, seed=4)
    prompt = fake_api.requests[-1]["messages"][0]["content"]
    prompt = prompt if isinstance(prompt, str) else prompt[-1]["text"]
    assert "instruction: make it moody" in prompt and "The passage:\nA " in prompt
    key = ok(home, webapi.llm_takes, kind="enhance", what="make it moody", template=template, seed=4)["keep"]
    assert len(key) == 16  # the roll a picked rewrite is kept for (#276)
    assert ok(home, webapi.llm_keep, key=key, instruction="make it moody", text="A moody fox.")["kept"] == key
    assert api(home, webapi.llm_keep, key="nonsense", text="x")[0] == 400
    assert api(home, webapi.llm_keep, key=key, instruction="make it moody", text=" ")[0] == 400
    assert api(home, webapi.llm_takes, kind="slot", what="nothing like it", template=template)[0] == 400  # no such slot
    fake_api.answer = lambda body: "no list here"
    assert api(home, webapi.llm_takes, kind="slot", what="one small object in its paws", template=template)[0] == 502


def test_a_library_that_exists_offers_its_rolls_and_new_entries_from_the_model(home, fake_api):
    """#273: rolls from the library, the one at this seed first, and new entries asked as a top-up asks, none of
    those it has or the sheet shows; Add to the library writes picked ones in, or only its directions."""
    (home / "library" / "sky_kind.txt").write_text("fog\nlow cloud\nhail\nsleet\n")
    Home(home).save_config({"llm": {"source": "api", "api": {"base_url": fake_api.url, "model": "gpt-5.4-mini"}}})
    fake_api.answer = lambda body: json.dumps(["Fog", "sun dogs", "a heat haze", "graupel", "virga"])
    body = ok(home, webapi.llm_takes, kind="entries", what="sky_kind", template="A fox under a __sky_kind__ sky.", seed=3, roll="hail")
    assert body["rolled"][0] == "hail" and len(body["rolled"]) == 3 and set(body["rolled"]) <= {"fog", "low cloud", "hail", "sleet"}
    assert body["takes"] == ["sun dogs", "a heat haze", "graupel"]  # three new, none it has
    prompt = fake_api.requests[-1]["messages"][0]["content"]
    assert "3 NEW entries in the spirit of the existing ones" in prompt and '"sleet"' in prompt
    assert api(home, webapi.llm_takes, kind="entries", what="moods", template="A __moods__ fox.")[0] == 400  # not written yet
    fake_api.answer = lambda body: json.dumps(["virga", "ice fog", "hail"])
    body = ok(home, webapi.llm_takes, kind="entries", what="sky_kind", template="", rolls=False, have=["sun dogs"])
    assert (body["rolled"], body["takes"]) == ([], ["virga", "ice fog"])  # the Libraries tab's Generate (#323): new only
    assert '"sun dogs"' in fake_api.requests[-1]["messages"][0]["content"]  # what the sheet shows is not asked again
    fake_api.answer = lambda body: json.dumps(["fog", "hail"])  # nothing new: the sheet says so
    status, said = api(home, webapi.llm_takes, kind="entries", what="sky_kind", template="", rolls=False)
    assert status == 502 and "nothing __sky_kind__ does not have yet" in said["error"]
    assert ok(home, webapi.library_add, name="sky_kind", entries=["graupel", "hail"])["added"] == 1
    assert ok(home, webapi.library_add, name="sky_kind", directions="weather a painter sees")["added"] == 0
    assert Home(home).libraries()["sky_kind"].meta["directions"] == "weather a painter sees"


def test_keep_as_the_library_writes_the_picked_entries_straight_in(home):
    """#272: a new library made of the entries picked in the sheet, not To review, its directions kept; picked again,
    only the new ones are added; `orrery lib undo` has a snapshot."""
    body = ok(home, webapi.library_add, name="sky_kind", entries=["fog", "low cloud", "fog"], directions="weather words")
    assert body["added"] == 2 and [e["value"] for e in body["library"]["entries"]] == ["fog", "low cloud"]
    lib = Home(home).libraries()["sky_kind"]
    assert lib.meta["directions"] == "weather words" and not lib.meta.get("pending")
    assert ok(home, webapi.library_add, name="sky_kind", entries=["Fog", "hail"])["added"] == 1
    assert api(home, webapi.library_add, name="sky_kind", entries=[])[0] == 400


def test_the_plan_of_a_run_lists_its_language_model_tasks_in_order(home):
    """#171: what Roll queues mini-runs for before a run: libraries, the rewrites, each slot (none from image output)."""
    template = "a fox under a __sky_mood__ sky, --one small object--\n> moody\nEXPORT: sheet = --a sheet from image output--"
    assert ok(home, webapi.llm_plan, template=template, seed=2)["tasks"] == [
        {"task": "library", "what": "sky_mood"}, {"task": "rewrites", "what": ""}, {"task": "slot", "what": "one small object"}]
    assert ok(home, webapi.llm_plan, template="a fox", seed=2)["tasks"] == []


def test_how_many_takes_each_sheet_asks_for_is_a_setting(home, fake_api):
    """#274: a count per kind in the llm settings, 1 to 12; the sheets ask for it (More too), unless they say n."""
    writers = {"continue": 3, "story": 3, "describe": 3}
    assert ok(home, webapi.llm_settings)["takes"] == {"slot": 3, "enhance": 3, "rolled": 3, "new": 3, **writers}
    saved = ok(home, webapi.llm_save, takes={"slot": 5, "enhance": 40, "new": "x", "story": 1})["takes"]
    assert saved == {"slot": 5, "enhance": 12, "rolled": 3, "new": 3, **writers, "story": 1}  # capped, a bad value its default
    from orrery.takes import counts
    assert counts({"takes": {"write": 2}}) == {"slot": 3, "enhance": 3, "rolled": 3, "new": 3, "continue": 2, "story": 2,
                                               "describe": 2}  # the one count before #333: each writer's default
    assert ok(home, webapi.llm_save, entries=20)["takes"]["slot"] == 5  # another setting saved keeps them
    Home(home).save_config({**Home(home).config(), "llm": {**Home(home).config()["llm"], "source": "api",
                                                            "api": {"base_url": fake_api.url, "model": "gpt-5.4-mini"}}})
    fake_api.answer = lambda body: json.dumps([f"take {i}" for i in range(9)])
    body = ok(home, webapi.llm_takes, kind="slot", what="a small object", template="A fox with --a small object--.")
    assert len(body["takes"]) == 5 and "Write 5 different takes" in fake_api.requests[-1]["messages"][0]["content"]


def test_takes_find_a_slot_in_a_cast_line(home, fake_api):
    """A slot in a CAST member's description compiles as `--… (for NAME)--` (two members, a text each); its takes
    find it there and do not answer that the prompt has no such slot."""
    Home(home).save_config({"llm": {"source": "api", "api": {"base_url": fake_api.url, "model": "gpt-5.4-mini"}}})
    fake_api.answer = lambda body: json.dumps(["a white cotton dress", "a grey wool coat", "a red raincoat"])
    template = "@h3 t2va\nCAST\n@HOST: a tall woman. --what she wears--\n\nSHOT 5s: static\n@HOST stands in the rain."
    body = ok(home, webapi.llm_takes, kind="slot", what="what she wears", template=template, target="h3-base", seed=4)
    assert body["takes"] == ["a white cotton dress", "a grey wool coat", "a red raincoat"]
    prompt = fake_api.requests[-1]["messages"][0]["content"]
    prompt = prompt if isinstance(prompt, str) else prompt[-1]["text"]
    assert "[this part]" in prompt and "--what she wears" not in prompt  # the place marked, as for any slot


def test_takes_for_a_slot_see_the_pictures_it_names(home, fake_api, tmp_path, monkeypatch):
    """#174: a slot's takes get the Load Image file behind first_frame as Picture 1; without it they ask nothing
    and say what is missing; one from image output come from the Gallery, never here."""
    picture = tmp_path / "fox.png"
    Image.new("RGB", (64, 48), "orange").save(picture)
    monkeypatch.setattr(webapi, "_input_picture", lambda name: picture if name else None)
    Home(home).save_config({"llm": {"source": "api", "api": {"base_url": fake_api.url, "model": "gpt-5.4-mini"}}})
    fake_api.answer = lambda body: json.dumps(["a brass key", "a coin", "a note"])
    template = "A fox holding --the object in image first_frame--."
    body = ok(home, webapi.llm_takes, kind="slot", what="the object in image first_frame", template=template,
              frames={"first_frame": "fox.png"})
    content = fake_api.requests[-1]["messages"][0]["content"]
    assert content[0]["type"] == "image_url" and "the object in Picture 1" in content[-1]["text"]
    asked = len(fake_api.requests)
    status, body = api(home, webapi.llm_takes, kind="slot", what="the object in image first_frame", template=template)
    assert status == 400 and "nothing is wired into the Orrery Prompt's first_frame: its takes need it." in body["error"]
    assert len(fake_api.requests) == asked  # the model is not asked
    status, body = api(home, webapi.llm_takes, kind="slot", what="a sheet from image output", template="A --a sheet from image output--.")
    assert status == 400 and "Gallery" in body["error"]


def test_a_gallery_picture_writes_its_slots_from_image_output(home, fake_api, tmp_path):
    """#175: the Gallery's takes for an export slot see the picture as Picture 1; Write puts one into the row; the
    setting writes them after every run instead."""
    from orrery.comfy import log_outputs
    from orrery.galaxy import read_rows

    picture = tmp_path / "hero.png"
    Image.new("RGB", (64, 48), "teal").save(picture)
    data = {"seed": 3, "text": "A character sheet of a ferryman.", "picks": [],
            "exports": {"who": "a ferryman", "sheet": "--a full character sheet, as image output shows them--"}}
    log_outputs(Home(home), json.dumps(data), [str(picture)])
    rid = read_rows(Home(home))[0]["id"]
    what = "a full character sheet, as image output shows them"
    assert api(home, webapi.galaxy_takes, id=rid, what=what)[0] == 400  # no endpoint yet
    Home(home).save_config({"llm": {"source": "api", "api": {"base_url": fake_api.url, "model": "gpt-5.4-mini"}}})
    fake_api.answer = lambda body: json.dumps(["tall, grey coat, a lantern", "weathered hands, a pole", "a hood, calm eyes"])
    body = ok(home, webapi.galaxy_takes, id=rid, what=what)
    content = fake_api.requests[-1]["messages"][0]["content"]
    assert body["takes"][0] == "tall, grey coat, a lantern" and content[0]["type"] == "image_url"
    assert "a full character sheet, as Picture 1 shows them" in content[-1]["text"] and "A character sheet of a ferryman." in content[-1]["text"]
    assert "never name them (Picture 1)" in content[-1]["text"]  # a kept take that says "as Picture 1" means nothing later
    row = ok(home, webapi.galaxy_write, id=rid, what=what, text="weathered hands, a pole")["row"]
    assert row["exports"]["sheet"] == "weathered hands, a pole" and row["exports"]["who"] == "a ferryman"
    assert api(home, webapi.galaxy_takes, id=rid, what=what)[0] == 400  # written: no slot left
    ok(home, webapi.ui_save, picture_slots="every run")  # the setting: after every run
    assert webapi.galaxy_capture in webapi.SLOW  # it waits for the endpoint then: in a thread, so ComfyUI answers
    fake_api.answer = lambda body: json.dumps(["a red scarf"])
    log_outputs(Home(home), json.dumps(data), [str(picture)])
    assert read_rows(Home(home))[0]["exports"]["sheet"] == "a red scarf"


def test_a_library_still_to_be_written_says_no_roll_and_escapes_show_as_written(home):
    """#269: a stand-in for a missing library showed its escape placeholders as its roll."""
    (home / "library" / "brace.txt").write_text("a \\{curly\\} thing\n")
    out = ok(home, webapi.annotate, template="A __animal__ under a __sky_kind__ sky, with __brace__.", seed=1, target="text")
    rolls = out["rolls"]["0"]
    assert [k for k, _ in rolls] == [0, 2] and rolls[1][1] == "a {curly} thing"  # __sky_kind__ (k 1) says nothing
    assert not any("" in v or "" in v for _, v in rolls)


def test_a_preset_card_says_what_it_makes_and_when_it_changed_and_the_text_can_be_searched(home):
    """#307, #308: image or video, still, scene or reel, the file's date; a regex over the template text."""
    save_preset(Home(home), "mine/still", "a __animal__ at dusk")
    save_preset(Home(home), "mine/scene", "@h3 t2va\nSHOT 5s: static\nA den.")
    save_preset(Home(home), "mine/reel", "@h3 t2va\nSCENE one\nSHOT 5s: static\nA den.\nSCENE two\nSHOT 5s: static\nRain.")
    cards = {c["name"]: c for c in ok(home, webapi.presets)["presets"]}
    assert [(cards[n]["kind"], cards[n]["sub"]) for n in ("mine/still", "mine/scene", "mine/reel")] == [
        ("image", "still"), ("video", "scene"), ("video", "reel")]
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", cards["mine/still"]["modified"])
    mine = lambda names: [n for n in names if n.startswith("mine/")]
    assert mine(ok(home, webapi.presets_grep, pattern="a den\\.")["names"]) == ["mine/reel", "mine/scene"]
    assert mine(ok(home, webapi.presets_grep, pattern="DUSK")["names"]) == ["mine/still"]
    assert mine(ok(home, webapi.presets_grep, pattern="den.(")["names"]) == []  # no regex: plain text


def test_a_sheet_sends_along_what_its_toggles_say(home, fake_api, tmp_path, monkeypatch):
    """#335: the frames a slot does not name go along when sent, each told what it is; a library's lines go along
    only with the prompt; a writer sees only what is sent, the prompt when it is."""
    frame = tmp_path / "first.png"
    Image.new("RGB", (64, 48), "orange").save(frame)
    monkeypatch.setattr(webapi, "_input_picture", lambda name, what="picture": frame if name else None)
    Home(home).save_config({"llm": {"source": "api", "api": {"base_url": fake_api.url, "model": "gpt-5.4-mini"}}})
    fake_api.answer = lambda body: json.dumps(["a red scarf", "a lantern", "a hat"])
    ok(home, webapi.llm_takes, kind="slot", what="what she carries", template="A woman with --what she carries--.",
       sends=["prompt", "first_frame"], frames={"first_frame": "first.png"})
    content = fake_api.requests[-1]["messages"][0]["content"]
    assert content[0]["type"] == "image_url" and "The images are Picture 1 (the first frame)" in content[-1]["text"]
    status, body = api(home, webapi.llm_takes, kind="slot", what="what she carries", template="A woman with --what she carries--.",
                       sends=["last_frame"])
    assert status == 400 and "nothing is wired into the Orrery Prompt's last_frame" in body["error"]
    assert api(home, webapi.llm_takes, kind="slot", what="x", template="A --x--.", sends=["the moon"])[0] == 400
    (home / "library" / "props.txt").write_text("a cane\na fan\n")
    fake_api.answer = lambda body: json.dumps(["a parasol", "a cane"])
    ok(home, webapi.llm_takes, kind="entries", what="props", template="A woman with __props__.", rolls=False,
       sends=["first_frame"], frames={"first_frame": "first.png"})
    content = fake_api.requests[-1]["messages"][0]["content"]
    said = content[-1]["text"]
    assert content[0]["type"] == "image_url" and "Picture 1 is the first frame. Let them shape the entries." in said
    assert "A woman with" not in said  # the prompt was not sent: no lines that use it
    fake_api.answer = lambda body: "SHOT 5s: static\nShe opens the fan."
    body = ok(home, webapi.write_idea, task="story", template="@h3 fl2va\nSHOT 5s: static\nA woman with a __props__.",
              sends=["prompt", "first_frame"], frames={"first_frame": "first.png"})
    content = fake_api.requests[-1]["messages"][0]["content"]
    said = content[-1]["text"]
    assert body["text"].startswith("SHOT 5s") and sum(c["type"] == "image_url" for c in content) == 1
    assert "Picture 1 is the first frame. There is no last frame this time: imagine it" in said  # it has the first
    assert "carry its story on:\n\nSHOT 5s: static\nA woman with a" in said  # its lines kept, and what they are for
