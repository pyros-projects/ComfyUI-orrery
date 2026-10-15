"""Orrery Write: the language model writes for the editor, one idea per run (see orrery.writers).

The app queues it on its own, with only what the model needs (the frames wired into the Orrery
Prompt; the text encoder is the one in orrery's settings), so the run ends when the model has written and no video model is loaded.
The idea comes back as the node's UI output: the text, the template with it in place, or what is
wrong with it. With an API endpoint the app asks the server instead (`write_idea`, #167), and only
frames it cannot name as files still take this run.
"""

import json
from pathlib import Path

from orrery import writers
from orrery.comfy_llm import llm_config
from orrery.home import resolve_home

FRAME_EDGE = 768  # the long edge of a frame the model sees: enough to read it, a few hundred tokens


def pick_frames(task: str, first, last) -> tuple[list, list[str]]:
    """The frames a writer shows the model (pictures of any kind) and what each is: the story both frames, a prompt
    from an image the first (else the last). What is not wired is left out, never an error (#334): the writer is
    told what came along and writes from the rest."""
    if task == "story":
        pairs = [(first, "the first frame"), (last, "the last frame")]
    elif task == "describe":
        pairs = [(first if first is not None else last, "the picture")]
    else:
        return [], []
    kept = [(f, what) for f, what in pairs if f is not None]
    return [f for f, _ in kept], [what for _, what in kept]


def _frames(task: str, first, last):
    """The frames a writer shows the model, as one IMAGE batch of one size, or None; and what each is."""
    frames, given = pick_frames(task, first, last)
    if not frames:
        return None, given
    import comfy.utils  # ComfyUI
    import torch

    h, w = int(frames[0].shape[1]), int(frames[0].shape[2])
    scale = min(1.0, FRAME_EDGE / max(h, w))
    size = (max(32, round(w * scale / 16) * 16), max(32, round(h * scale / 16) * 16))
    fitted = [comfy.utils.common_upscale(f[:1].movedim(-1, 1), size[0], size[1], "bilinear", "center").movedim(1, -1)
              for f in frames]
    return torch.cat(fitted), given


class OrreryWrite:
    """The language model writes one idea for the Orrery Prompt's editor. Queued by the app; you do not
    need to add it yourself."""

    CATEGORY = "orrery/internal"
    FUNCTION = "write"
    OUTPUT_NODE = True
    RETURN_TYPES = ()
    DESCRIPTION = ("Used by the Orrery Prompt's Write menu: the language model continues a reel, writes the "
                   "shot between two frames, or a prompt from a picture, in a run of its own.")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"task": (list(writers.TASKS),),
                             "template": ("STRING", {"multiline": True}),
                             "seed": ("INT", {"default": 0, "min": 0, "max": 0xFFFFFFFF})},
                # idea n samples the model at seed + n; the picks it reads still roll at the node's seed
                "optional": {"idea": ("INT", {"default": 0, "min": 0, "max": 0xFFFF}),
                             "home": ("STRING", {"default": ""}), "params": ("STRING", {"default": ""}),
                             "steer": ("STRING", {"default": ""}), "sends": ("STRING", {"default": ""}),
                             "options": ("STRING", {"default": ""}),  # what the writer's sheet chose (JSON)
                             "first_frame": ("IMAGE",), "last_frame": ("IMAGE",), "video": ("VIDEO",)}}

    @classmethod
    def IS_CHANGED(cls, **_):
        return float("NaN")  # every request is a new idea

    def write(self, task, template, seed, idea=0, home="", params="", steer="", sends="", options="", first_frame=None,
              last_frame=None, video=None):
        from orrery import (
            comfy,  # the node pack's helpers; imported here, as comfy imports this module
        )

        h = resolve_home(home or None)

        def backend():
            return comfy.llm_for(h, seed=(seed + idea) % 2**32, temperature=float(llm_config(h)["writer_temperature"]))

        from orrery import sendalong

        sent = sendalong.parse(json.loads(sends)) if sends else None  # what the takes sheet sends along (#335)

        def pictures():
            if sent is None:
                return _frames(task, first_frame, last_frame)
            shown, labels, missing = sendalong.pictures(h, [s for s in sent if s != "prompt"],
                                                        {"first_frame": first_frame, "last_frame": last_frame}, video)
            if missing:
                raise writers.WriterError(f"Nothing to send along there: {'; '.join(missing)}.")
            return shown, labels

        result = write_idea(h, task, template, seed, idea, params, backend, pictures, steer,
                            sent is not None and "prompt" in sent, json.loads(options) if options else None)
        return {"ui": {"orrery_write": [json.dumps(result, ensure_ascii=False)]}}


def write_idea(h, task: str, template: str, seed: int, idea: int, params, backend, frames, steer: str = "",
               prompt: bool = False, opts: dict | None = None) -> dict:
    """One idea: the text, the template with it in place (`template`, in place of what it replaces; `inserted`, with
    that kept, #342), what is wrong with it, or the error. `backend` and `frames` (the pictures and what each is) are
    called when needed, so an error before them never loads a model or a picture. `steer`: the takes sheet's
    steering line (#334); `prompt`: the prompt as it rolls goes along (#335); `opts`: what the sheet chose (#342)."""
    from orrery import comfy
    from orrery.dsl import override, strip_comments
    from orrery.presets import resolve_includes

    answer = None
    try:
        source = strip_comments(resolve_includes(h, override(template, comfy._dials(template, params))))  # knobs too (#418)
        images, given = frames()
        asked = writers.request(h, task, source, seed, h.libraries(), h.weights(), steer, given, prompt, opts)
        model = backend()
        if model is None:
            raise writers.WriterError("The writers need a language model: pick one in orrery's settings (the gear "
                                      "in the node).")
        if isinstance(images, list) and images and not isinstance(images[0], str | Path):  # pictures sent along (#335)
            images = comfy._images(None, images, model)
        answer = model.complete(asked, images=images)
        text, problem = writers.check(task, template, answer, opts)
        caret = writers.at_caret(task, template)  # a reel's shot: the app puts it in at the caret (#334)
        placed = text and not caret
        result = {"task": task, "seed": seed, "idea": idea, "text": text, "problem": problem,
                  "template": writers.apply(task, template, text, opts) if placed else None,
                  "inserted": writers.apply(task, template, text, opts, insert=True) if placed else None,
                  **({"at_caret": True} if caret else {})}
    except (writers.WriterError, ValueError, RuntimeError) as err:
        result = {"task": task, "seed": seed, "idea": idea, "error": str(err), "raw": answer}
    print(f"[orrery] write · {task} · seed {seed} · idea {idea}: {result.get('error') or result.get('problem') or 'an idea'}")
    if result.get("text"):
        print(result["text"])
    return result


class OrreryAsk:
    """One task of the language model in a run of its own (#171): a text encoder answers once per run, so the app
    queues one of these per task. Queued by the app; you do not need to add it yourself."""

    CATEGORY = "orrery/internal"
    FUNCTION = "ask"
    OUTPUT_NODE = True
    RETURN_TYPES = ()
    DESCRIPTION = ("Used by the Orrery Prompt with a text encoder: one task of the language model (a library, a "
                   "run's rewrites, a slot, a take at the line) in a run of its own, before the run that renders.")
    TASKS = ("library", "rewrites", "slot", "takes")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"task": (list(cls.TASKS),), "what": ("STRING", {"default": ""}),
                             "template": ("STRING", {"multiline": True}),
                             "seed": ("INT", {"default": 0, "min": 0, "max": 0xFFFFFFFF})},
                # the Orrery Prompt's values as the render run gets them; `graph`: that run's prompt (JSON) and `node`
                # its Orrery Prompt there, so the task reads its wiring as the render run does; `args`: a take's (JSON)
                "optional": {"target": ("STRING", {"default": "text"}), "args": ("STRING", {"default": ""}),
                             "preset": ("STRING", {"default": ""}), "home": ("STRING", {"default": ""}),
                             "params": ("STRING", {"default": ""}), "segment": ("INT", {"default": 0, "min": 0, "max": 99999}),
                             "sweep": ("STRING", {"default": ""}), "chain": ("STRING", {"default": ""}),
                             "graph": ("STRING", {"default": ""}), "node": ("STRING", {"default": ""}),
                             "first_frame": ("IMAGE",), "last_frame": ("IMAGE",), "video": ("VIDEO",)}}

    @classmethod
    def IS_CHANGED(cls, **_):
        return float("NaN")  # every task is asked anew

    def ask(self, task, what, template, seed, target="text", args="", preset="", home="", params="", segment=0,
            sweep="", chain="", graph="", node="", first_frame=None, last_frame=None, video=None):
        from orrery import comfy, webapi

        h = resolve_home(home or None)
        frames = {"first_frame": first_frame, "last_frame": last_frame, "video": video}  # a take's sends read them (#335)
        try:
            if task == "takes":  # a sheet's take (#178): sampled anew for each run the sheet has asked (#330)
                given = json.loads(args or "{}")
                asked = given.get("asked")
                step = asked if isinstance(asked, int) and asked >= 0 else len(given.get("have") or [])
                model = comfy.llm_for(h, seed=(seed + step) % 2**32,
                                      temperature=float(llm_config(h)["writer_temperature"]))
                if model is None:
                    raise ValueError("Takes need a language model: pick one in orrery's settings (the gear in the node).")
                result = webapi.takes_with(h, {**given, "template": template, "target": target, "seed": seed,
                                               "segment": segment, "chain": chain,
                                               "params": json.loads(params) if params else {}},
                                           model, {k: v for k, v in frames.items() if v is not None})
            else:
                prompt = json.loads(graph) if graph else None
                packed, wired, keep, standing = comfy.wiring(prompt, node) if prompt else (False, None, False, frozenset())
                chain = chain or comfy.DEFAULT_CHAIN
                result = comfy.run_prompt(template, seed, target, home, preset or comfy.NO_PRESET, None, params, segment,
                                          comfy._previous(chain, segment), packed, wired, chain, keep, sweep,
                                          comfy.continued(prompt, node), (comfy._size(first_frame), comfy._size(last_frame)),
                                          comfy.reads_picks(prompt, node, "OrreryRefMods"), standing,
                                          {"first_frame": first_frame, "last_frame": last_frame}, ask={"task": task, "what": what})
        except (webapi.ApiError, ValueError, RuntimeError) as err:
            result = {"task": task, "what": what, "error": str(err)}
        print(f"[orrery] ask · {task}{f' · {what[:60]}' if what else ''}: {result.get('error') or 'answered'}")
        return {"ui": {"orrery_ask": [json.dumps(result, ensure_ascii=False)]}}
