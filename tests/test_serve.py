"""`orrery serve`: orrery's API on a server of its own, without ComfyUI (#439)."""

import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

import pytest

from orrery.webapi import call


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture
def serve():
    """Start `orrery serve` with the given arguments; returns get(path) -> (status, body)."""
    servers = []
    env = {k: v for k, v in os.environ.items() if k != "ORRERY_HOME"}  # the home comes from --home

    def start(*argv):
        port = _free_port()
        proc = subprocess.Popen([sys.executable, "-m", "orrery.cli", *argv, "--port", str(port)], env=env,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        servers.append(proc)
        deadline = time.monotonic() + 20
        while True:
            try:
                socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
                break
            except OSError:
                if proc.poll() is not None or time.monotonic() > deadline:
                    proc.kill()
                    pytest.fail(f"orrery serve did not start: {proc.stdout.read()}")
                time.sleep(0.1)

        def get(path):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=10) as answer:
                    return answer.status, json.load(answer)
            except urllib.error.HTTPError as err:
                return err.code, json.load(err)
        return get

    yield start
    for proc in servers:
        proc.terminate()
        proc.wait(timeout=10)


def test_serve_answers_from_its_home(serve, home):
    get = serve("serve", "--home", str(home))
    status, body = get("/orrery/libraries")
    assert status == 200
    assert {"name": "animal", "count": 3}.items() <= next(lib for lib in body["libraries"]
                                                          if lib["name"] == "animal").items()
    status, body = get("/orrery/completions")
    assert status == 200 and "style" in {lib["name"] for lib in body["libraries"]}
    assert get("/orrery/galaxy") == (200, {"rows": [], "weights": {}})
    assert get("/orrery/presets")[0] == 200


def test_the_take_tree_needs_comfyuis_output_folder(serve, home, tmp_path):
    get = serve("--home", str(home), "serve")
    status, body = get("/orrery/chain")
    assert status == 503 and "--output" in body["error"]
    assert get("/orrery/libraries")[0] == 200  # the server is still there

    out = tmp_path / "output"
    out.mkdir()
    get = serve("--home", str(home), "serve", "--output", str(out))
    status, body = get("/orrery/chain")
    assert status == 200 and body["clips"] == []


def test_a_route_that_needs_comfyui_says_so(home, monkeypatch):
    monkeypatch.delitem(sys.modules, "folder_paths", raising=False)

    def needs_comfyui(home, args):
        import folder_paths  # noqa: F401 - not there outside ComfyUI

    def needs_something_else(home, args):
        import orrery_no_such_module  # noqa: F401

    assert call(needs_comfyui, {}) == (503, {"error": "orrery: this needs a running ComfyUI."})
    status, body = call(needs_something_else, {})
    assert status == 500 and "orrery_no_such_module" in body["error"]
