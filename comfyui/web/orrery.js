// The Orrery Prompt node becomes one app: prompt, presets, libraries, galaxy, help.
import { api } from "../../scripts/api.js";
import { app } from "../../scripts/app.js";
import { downstream, queueSweep, seedSource } from "./app/model.js";
import { OrreryApp } from "./app/shell.js";

const NO_PRESET = "(none)";
const MIN = { width: 620, height: 560 };
const NEW = { width: 1300, height: 960 };

function loadStyles() {
  if (document.getElementById("orrery-css")) return;
  const link = document.createElement("link");
  link.id = "orrery-css";
  link.rel = "stylesheet";
  link.href = new URL("./orrery.css", import.meta.url).href;
  document.head.appendChild(link);
}

// widget.hidden is the official switch since frontend 1.53.5; computeSize covers older canvases.
// Never change widget.type: that breaks serialization.
function hide(widget) {
  if (!widget) return;
  widget.hidden = true;
  widget.options = { ...widget.options, hidden: true };
  widget.computeSize = () => [0, -4];
  const el = widget.element || widget.inputEl;
  if (el) el.style.display = "none";
}

// The graph as the Generate button sees it: which node feeds which, and which ones are outputs.
function graphOf(node) {
  const g = node.graph || app.graph;
  const linkOf = (id) => (g.links?.get ? g.links.get(id) : g.links?.[id]);
  return (g._nodes || g.nodes || []).map((n) => ({
    id: n.id,
    type: n.comfyClass || n.type,
    output: !!n.constructor?.nodeData?.output_node,
    targets: (n.outputs || []).flatMap((o) => (o.links || []).map((l) => linkOf(l)?.target_id)).filter((t) => t != null),
  }));
}

function mount(node) {
  loadStyles();
  const find = (name) => node.widgets?.find((w) => w.name === name);
  const template = find("template"), preset = find("preset"), home = find("home"), params = find("params");
  [template, preset, home, params, find("sweep"), find("chain"), find("take"), find("shoot")].forEach(hide);
  node.properties = node.properties || {};

  // the control_after_generate combo that belongs to an INT widget (seed and segment each have one); newer frontends
  // name the second one control_after_generate#1, so the name is matched by its start
  const isControl = (w) => /^control_after_generate/.test(w?.name || "");
  const controlOn = (n, w) => {
    const i = w ? (n.widgets?.indexOf(w) ?? -1) : -1;
    return w?.linkedWidgets?.find(isControl) ?? (i >= 0 && isControl(n.widgets?.[i + 1]) ? n.widgets[i + 1] : null);
  };
  const controlOf = (name) => controlOn(node, find(name));
  // the seed a run gets, where it is set: this node's, or the widget a linked seed comes from (#346)
  const seedAt = () => seedSource(node, node.graph || app.graph);
  const seedControl = () => { const s = seedAt(); return controlOn(s.node, s.widget); };
  const putSeed = (value) => {
    const { node: n, widget } = seedAt();
    if (!widget) return;
    widget.value = value;
    widget.callback?.(value);
    n.setDirtyCanvas?.(true, true);
  };
  // A new node plays a reel clip after clip; configure() restores a saved workflow's choice later. The segment and
  // its control are orrery's (#190): the footer's Next clip and Hold set them, so the node shows neither.
  const segmentControl = controlOf("segment");
  if (segmentControl) segmentControl.value = "increment";
  [find("segment"), segmentControl].forEach(hide);

  const set = (name, value) => {
    const w = find(name);
    if (!w) return;
    w.value = value;
    w.callback?.(value);
    node.setDirtyCanvas?.(true, true);
  };
  const batch = { id: 0, done: null, asks: 0 };  // the Generate loop that is queueing right now
  const sweep = { on: false };  // a LoRA sweep is being queued: the template and the dials hold still
  const bridge = {
    props: node.properties,
    getText: () => template?.value ?? "",
    setText: (text) => { if (!sweep.on) set("template", text); },
    getSeed: () => seedAt().widget?.value ?? 0,
    setSeed: (seed) => { if (!sweep.on) putSeed(seed); },
    setControl: (mode) => { const c = seedControl(); if (c && !sweep.on) { c.value = mode; seedAt().node.setDirtyCanvas?.(true, true); } },
    getControl: () => seedControl()?.value ?? "",
    getTarget: () => find("target")?.value || "text",
    setTarget: (target) => { if (!sweep.on) set("target", target); },
    getParams: () => { try { return JSON.parse(params?.value || "{}") || {}; } catch { return {}; } },
    setParams: (values) => { if (!sweep.on) set("params", Object.keys(values).length ? JSON.stringify(values) : ""); },
    sweeping: () => sweep.on,
    home: () => home?.value || "",
    nodeId: () => String(node.id),
    downstream: () => downstream(graphOf(node), node.id),
    // An Orrery Refs reading this node's picks has keep_sent on: images with a stored anchor are held (#371).
    keepSent: () => {
      const g = node.graph || app.graph, linkOf = (id) => (g.links?.get ? g.links.get(id) : g.links?.[id]);
      return (g._nodes || g.nodes || []).some((n) => (n.comfyClass || n.type) === "OrreryRefs"
        && String(linkOf(n.inputs?.find((i) => i.name === "picks")?.link)?.origin_id) === String(node.id)
        && n.widgets?.find((w) => w.name === "keep_sent")?.value === true);
    },
    // Queue only the outputs this node feeds (ComfyUI's partial execution): its branch, not the whole canvas.
    // One queue item per run, so control after generate steps seed and segment between them, and a newer
    // Generate or Restart stops the loop between two runs (ComfyUI's batch count cannot be stopped).
    generate: async (runs = 1) => {
      const { outputs } = downstream(graphOf(node), node.id);
      if (!outputs.length) return 0;
      const id = ++batch.id;
      batch.done = (async () => {
        let queued = 0;
        for (; queued < runs && id === batch.id; queued++) {
          await bridge.beforeRun?.();
          await app.queuePrompt(0, 1, { queueNodeIds: outputs.map(String) });
        }
        return queued;
      })();
      return batch.done;  // how many runs went into the queue
    },
    // A LoRA sweep: every run once per seed, the seed and the segment held still within a sweep and the
    // seed stepping between seeds as its control says; each queue item tells the node its run and the
    // galaxy folder through the hidden sweep widget, which is empty again afterwards.
    // Every queue item reads the template when it is queued, so it is locked until the last one is in.
    generateSweep: async (count, seeds, folder, progress = () => {}) => {
      const { outputs } = downstream(graphOf(node), node.id);
      if (!outputs.length) return 0;
      const id = ++batch.id;
      const seedCtl = seedControl(), segmentControl = controlOf("segment");
      batch.done = (async () => {
        const was = [seedCtl?.value, segmentControl?.value];
        let queued = 0;
        sweep.on = true;
        try {
          if (seedCtl) seedCtl.value = "fixed";
          if (segmentControl) segmentControl.value = "fixed";
          queued = await queueSweep({
            count, seeds, mode: was[0], progress,
            getSeed: () => seedAt().widget?.value, setSeed: putSeed,
            queue: async (i) => { set("sweep", `${i}|${folder}`); await bridge.beforeRun?.(); await app.queuePrompt(0, 1, { queueNodeIds: outputs.map(String) }); },
            live: () => id === batch.id,
          });
        } finally {
          if (seedCtl) seedCtl.value = was[0];
          if (segmentControl) segmentControl.value = was[1];
          set("sweep", "");
          sweep.on = false;
        }
        return queued;
      })();
      return batch.done;
    },
    stopGenerate: async () => { batch.id++; await batch.done?.catch(() => {}); },
    // A run of its own (#171, the Write menu): the node `kind` and only what the language model needs (the frames
    // and a text encoder wired into this node), so it ends when the model has written and no video model loads.
    // `front`: ahead of the waiting runs; `wait`: resolves with what the node hands back, else once it is queued.
    mini: async (kind, inputs, { front = false, wait = true, wire = [], graph = false } = {}) => {
      const { output } = await app.graphToPrompt();
      const key = Object.keys(output).find((k) => output[k]?.class_type === "OrreryPrompt" && (k === String(node.id) || k.endsWith(`:${node.id}`)));
      const me = key && output[key];
      if (!me) throw new Error("This node is not part of what ComfyUI would queue (is it bypassed?).");
      const keep = {};
      const visit = (id) => {
        if (keep[id] || !output[id]) return;
        keep[id] = output[id];
        Object.values(output[id].inputs || {}).forEach((v) => { if (Array.isArray(v)) visit(String(v[0])); });
      };
      // as this node has them, a value or a link (a seed or a home may come from another node)
      const passed = wire.filter((k) => me.inputs[k] !== undefined);
      passed.forEach((k) => { if (Array.isArray(me.inputs[k])) visit(String(me.inputs[k][0])); });
      const id = kind === "OrreryWrite" ? "orrery_write" : `orrery_ask_${++batch.asks}`;
      const prompt = { ...keep, [id]: { class_type: kind, inputs: {
        ...inputs, ...Object.fromEntries(passed.map((k) => [k, me.inputs[k]])),
        ...(graph ? { graph: JSON.stringify(output), node: key } : {}) } } };
      // listening before it is queued: a quick run (or one that fails at once) can end before the POST answers
      const seen = [];
      let settle = () => {};
      const on = Object.fromEntries(["executed", "execution_error", "execution_interrupted"].map((ev) =>
        [ev, ({ detail }) => { seen.push([ev, detail]); settle(); }]));
      if (wait) Object.entries(on).forEach(([ev, f]) => api.addEventListener(ev, f));
      try {
        const res = await api.fetchApi("/prompt", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, client_id: api.clientId ?? api.initialClientId, ...(front ? { front: true } : {}) }) });
        const queued = await res.json();
        if (!res.ok || !queued.prompt_id) throw new Error(queued.error?.message || "ComfyUI did not take the run.");
        if (!wait) return queued.prompt_id;
        const out = kind === "OrreryWrite" ? "orrery_write" : "orrery_ask";
        return await new Promise((resolve, reject) => {
          settle = () => {
            for (const [ev, d] of seen.splice(0)) {
              if (d?.prompt_id !== queued.prompt_id) continue;
              if (ev === "executed" && d.node === id) return resolve(JSON.parse(d.output?.[out]?.[0] || "{}"));
              if (ev === "execution_error") return reject(new Error(`${d.node_type ? `${d.node_type}: ` : ""}${d.exception_message || "the run failed"}`));
              if (ev === "execution_interrupted") return reject(new Error("The run was stopped."));
            }
          };
          settle();
        });
      } finally {
        if (wait) Object.entries(on).forEach(([ev, f]) => api.removeEventListener(ev, f));
      }
    },
    // A writer's take in a run of its own (Orrery Write); take n samples the model at seed + n, steered (#334), for what
    // its sheet chose (#342, #343).
    write: (task, idea, template, steer = "", sends = null, options = null) => bridge.mini("OrreryWrite", { task, template, idea, steer,
      sends: sends ? JSON.stringify(sends) : "", options: options ? JSON.stringify(options) : "" },
    { wire: ["seed", "home", "params", "first_frame", "last_frame", "video"] }),
    // One task of the language model in a run of its own (Orrery Ask, #171): with a text encoder, a library, a run's
    // rewrites, a slot, a take at the line. It reads the node's values and wiring as the run that renders does.
    ask: (task, what = "", args = "", options = {}) => bridge.mini("OrreryAsk", { task, what, args }, { ...options, graph: true,
      wire: ["template", "seed", "target", "preset", "home", "params", "segment", "sweep", "chain", "first_frame", "last_frame", "video"] }),
    // Before each run Generate queues: the app's mini-runs for it (#171), set by the app.
    beforeRun: null,
    getSweep: () => find("sweep")?.value || "",
    // The folder the reel's clips live in (#197): the hidden chain widget, which the app names after the reel
    // (reels/<preset>, reels/untitled/<date time>); empty is the server's default, h3_context.
    chain: () => find("chain")?.value || "",
    setChain: (name) => { if (!sweep.on && (find("chain")?.value || "") !== name) set("chain", name); },
    // Sample surfing (#206): the take the next run renders; the seed output carries seed + take.
    setTake: (take) => { if (find("take") && Number(find("take").value) !== take) set("take", take); },
    // The shoot a template's takes go to (#321): the gallery keeps them together; empty for a reel.
    setShoot: (id) => { if (find("shoot") && (find("shoot").value || "") !== id) set("shoot", id); },
    // The frames wired into the node: they shape width and height (the server reads their size when it runs).
    frames: () => ["first_frame", "last_frame"].filter((name) => node.inputs?.find((i) => i.name === name)?.link != null),
    // the live preview comes from the sampler of the model that passes through this node (#302)
    modelWired: () => node.inputs?.find((i) => i.name === "model")?.link != null,
    wired: (name) => node.inputs?.find((i) => i.name === name)?.link != null,
    // The files behind the frames, for the Write menu over an API (#167): { names: {first_frame: "a.png"} }, and
    // other: true when a frame comes from anything but a Load Image (a run computes it, so the queue writes).
    frameFiles: async () => {
      const { output } = await app.graphToPrompt();
      const key = Object.keys(output).find((k) => output[k]?.class_type === "OrreryPrompt" && (k === String(node.id) || k.endsWith(`:${node.id}`)));
      const names = {}, others = [];  // others: wired from a node that is no loader of a file (a decode, a resize)
      for (const name of ["first_frame", "last_frame", "video"]) {  // the video's file too (#335): a Load Video's
        const from = key && output[key].inputs[name];
        if (!Array.isArray(from)) continue;
        const source = output[String(from[0])], file = { LoadImage: "image", LoadVideo: "file", VHS_LoadVideo: "video" }[source?.class_type];
        if (file && typeof source.inputs?.[file] === "string") names[name] = source.inputs[file];
        else others.push(name);
      }
      return { names, others, other: others.some((n) => n !== "video") };
    },
    getSegment: () => find("segment")?.value ?? 0,
    setSegment: (value) => set("segment", value),
    // The segment is orrery's (#190): a reel steps on after each run unless held (the same clip again, for takes);
    // a template without scenes stays at 0 and never steps, so it is never taken for a reel's next clip.
    segmentHeld: () => !!node.properties.orrery_hold,
    holdSegment: (on) => { node.properties.orrery_hold = !!on; bridge.syncSegment(true); },
    syncSegment: (reel) => {
      if (sweep.on) return;  // a sweep holds the segment still until its last run is queued
      const control = controlOf("segment"), want = reel && !node.properties.orrery_hold ? "increment" : "fixed";
      if (control && control.value !== want) { control.value = want; node.setDirtyCanvas?.(true, true); }
      if (!reel && Number(find("segment")?.value ?? 0) !== 0) set("segment", 0);
    },
    // Restart: dequeue this node's pending runs and interrupt its running one; other jobs stay queued.
    cancelRuns: async () => {
      const q = await (await api.fetchApi("/queue")).json();
      const wf = (node.graph?.rootGraph || app.rootGraph || app.graph)?.id;
      const ours = (item) => (!wf || item[3]?.extra_pnginfo?.workflow?.id === wf)
        && Object.entries(item[2] || {}).some(([k, n]) => n?.class_type === "OrreryPrompt" && (k === String(node.id) || k.endsWith(`:${node.id}`)));
      const post = (path, body) => api.fetchApi(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const pending = (q.queue_pending || []).filter(ours).map((i) => i[1]);
      const running = (q.queue_running || []).filter(ours).map((i) => i[1]);
      if (pending.length) await post("/queue", { delete: pending });
      for (const id of running) await post("/interrupt", { prompt_id: id });
      return pending.length + running.length;
    },
    forwardWheel: (e) => app.canvas?.processMouseWheel?.(e),
    takeLegacyPreset: () => {
      const name = preset?.value;
      if (!name || name === NO_PRESET) return null;
      preset.value = NO_PRESET;
      return name;
    },
  };

  const orrery = new OrreryApp(bridge);
  const widget = node.addDOMWidget("orrery_app", "orrery", orrery.root, {
    serialize: false,
    hideOnZoom: true,
    getMinHeight: () => MIN.height,
  });
  widget.serialize = false;
  widget.computeLayoutSize = () => ({ minHeight: MIN.height, minWidth: MIN.width, maxHeight: 1e6, maxWidth: 1e6 });
  // a new node: wide enough for the footer of a prompt or an H3 scene on one line (a loaded one keeps its size)
  if (node.size[0] < NEW.width || node.size[1] < 900) node.setSize([Math.max(node.size[0], NEW.width), Math.max(node.size[1], NEW.height)]);

  // configure() (a loaded workflow's values and properties) runs after nodeCreated.
  setTimeout(() => {
    // a workflow saved before #199 brings the latent_path input back with it: the node has none now, the app names the folder
    const stale = node.inputs?.findIndex((i) => i.name === "latent_path") ?? -1;
    if (stale >= 0) node.removeInput(stale);
    // and the clip input before #282: the language model is the one in orrery's settings
    const clip = node.inputs?.findIndex((i) => i.name === "clip") ?? -1;
    if (clip >= 0) node.removeInput(clip);
    // and the lora_stack output before #208: the LoRAs go on the model now; the outputs after it move up with their links
    const stack = node.outputs?.findIndex((o) => o.name === "lora_stack") ?? -1;
    if (stack >= 0) node.removeOutput(stack);
    orrery.start();
  }, 0);

  // Which reel segment runs: the node announces it; a finished, failed or stopped prompt ends it.
  const mine = (id) => id != null && (String(id) === String(node.id) || String(id).endsWith(`:${node.id}`));
  const onSegment = ({ detail }) => { if (mine(detail?.node)) orrery.showRun(detail); };
  const onDone = ({ detail }) => orrery.runDone(detail?.prompt_id);
  const ENDS = ["execution_success", "execution_error", "execution_interrupted"];
  api.addEventListener("orrery.segment", onSegment);
  // orrery's previews (#209): this node's whole clip (its model through the node), or ComfyUI's still for any run
  const onPreview = ({ detail: d }) => {
    if (!d?.image || (d.node != null && !mine(d.node))) return;
    orrery.preview({ src: `data:${d.mime};base64,${d.image}`, rank: d.animated ? 3 : 2, step: d.step, total: d.total, prompt: d.prompt_id });
  };
  api.addEventListener("orrery.preview", onPreview);
  ENDS.forEach((e) => api.addEventListener(e, onDone));
  // the segment, the seed and the target change what the editor shows (its annotations, the scene marked next)
  for (const name of ["segment", "seed", "target"]) {
    const widget = find(name), changed = widget?.callback;
    if (widget) widget.callback = function (...args) { const r = changed?.apply(this, args); orrery.refreshRun(); return r; };
  }

  const onRemoved = node.onRemoved;
  node.onRemoved = function (...args) {
    api.removeEventListener("orrery.segment", onSegment);
    api.removeEventListener("orrery.preview", onPreview);
    ENDS.forEach((e) => api.removeEventListener(e, onDone));
    orrery.destroy();
    return onRemoved?.apply(this, args);
  };
}

app.registerExtension({
  name: "orrery.app",
  setup: loadStyles,
  nodeCreated(node) {
    if (node.comfyClass === "OrreryPrompt") mount(node);
  },
});
