"""Both ways into ComfyUI load the nodes: the repository cloned into custom_nodes, or a link to comfyui/."""

import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


def load_like_comfyui(folder: Path):
    """What ComfyUI's load_custom_node does: a module named after its path, run from __init__.py."""
    name = str(folder).replace(".", "_x_")
    spec = importlib.util.spec_from_file_location(name, folder / "__init__.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize("folder", [ROOT, ROOT / "comfyui"])
def test_the_nodes_and_the_app_load_from_either_folder(folder):
    module = load_like_comfyui(folder)
    assert {"OrreryPrompt", "OrreryLog"} <= set(module.NODE_CLASS_MAPPINGS)
    assert (folder / module.WEB_DIRECTORY / "orrery.js").is_file()


def test_the_command_line_needs_only_pyyaml():
    """`uv sync` installs PyYAML alone (#443): the CLI and the API load without ComfyUI's numpy, Pillow or PyAV."""
    import subprocess

    probe = "import sys, orrery.cli, orrery.webapi; print(sorted(m for m in ('numpy', 'PIL', 'av', 'torch') if m in sys.modules))"
    result = subprocess.run([sys.executable, "-c", probe], capture_output=True, text=True, check=True)
    assert result.stdout.strip() == "[]"
