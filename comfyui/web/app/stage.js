// The preview (#305): a section of its own under the prompt and the dials, the whole width, as tall as its grip
// makes it. While a run samples, its live preview; then what is shown. A template without scenes shows its result,
// its takes under it like a photo viewer; a reel shows the clip or the take clicked under its scene, autoplaying with
// its controls. A click only shows: the take that counts, the circled one (in a reel the film's), has the golden
// border, and the preview's Circle this take chooses another (#319). A reel's clip in the film picks frames for a
// REMEMBER: line of its scene (#223).
import { esc } from "./highlight.js";
import { icon } from "./icons.js";
import { plays, splitCells } from "./model.js";
import { chooseResult, chosenResult, mediaHTML, mainMedia, resultsHTML, resultsOf, shownResult, takeMedia, wireResults } from "./results.js";
import { pickTake, takeVars } from "./timeline.js";

const FPS = 24;  // the frames REMEMBER: counts, as the reel keeps a clip
export const STAGE_H = 320;
export const RESULT_TAKE = 56;  // the takes under a result: small, one row like a carousel; their grip sizes them
const resultTake = (app) => Number(app.bridge.props.orrery_result_take) || RESULT_TAKE;

const box = (app) => { const el = app.view?.querySelector(".stage"); return el?.classList?.contains("stage") ? el : null; };

// What a reel shows: the clip or take clicked, else the newest clip made. { seg, clip, take, takes, film }
export function reelShown(app) {
  const clips = app.data.chain?.clips || [];
  if (!clips.length) return null;
  const sel = app.state.stage, byClip = new Map(clips.map((c) => [c.segment, c]));
  const seg = sel && byClip.has(sel.seg) ? sel.seg : Math.max(...clips.map((c) => c.segment));
  const takes = app.data.chain?.takes?.[seg] || [], clip = byClip.get(seg);
  const take = (sel?.seg === seg && sel.folder && takes.find((t) => t.folder === sel.folder)) || takes.find((t) => t.active) || null;
  return { seg, clip, take, takes, film: !take || take.active };
}

// The takes the preview steps through (#430), in its order: the scenes as the template has them, a scene's clips in
// order, a clip's takes as saved; a clip no scene plays at this seed (the template changed) after them all.
// [{chunk, seg, folder, active}]
export function stageSteps(chunks, takes) {
  const scene = (seg) => { const i = (chunks || []).findIndex((c) => plays(c, seg)); return i < 0 ? Infinity : i; };
  return Object.keys(takes || {}).map(Number).map((seg) => ({ seg, chunk: scene(seg) }))
    .sort((a, b) => a.chunk - b.chunk || a.seg - b.seg)
    .flatMap(({ seg, chunk }) => takes[seg].map((t) => ({ chunk, seg, folder: t.folder, active: !!t.active })));
}

// Where a step from what the preview shows (`at`: {seg, folder}) lands (#430): by "take", the take before or after
// in its scene, across the scene's clips; by "scene", the scene before or after with something made, its first
// clip's circled take. Null at either end.
export function stageStep(steps, at, by, dir) {
  const i = steps.findIndex((x) => x.seg === at.seg && (!at.folder || x.folder === at.folder));
  if (i < 0) return null;
  if (by === "take") return steps[i + dir]?.chunk === steps[i].chunk ? steps[i + dir] : null;
  const scenes = [...new Set(steps.map((x) => x.chunk))], to = scenes[scenes.indexOf(steps[i].chunk) + dir];
  if (to === undefined) return null;
  const of = steps.filter((x) => x.chunk === to), first = of.filter((x) => x.seg === of[0].seg);
  return first.find((x) => x.active) || first[first.length - 1];
}

// Show a clip or a take in the preview; the picker closes.
export function showInStage(app, sel) {
  app.state.stage = sel;
  app.state.picker = null;
  paintStage(app, true);
}

// A step in the preview (#430) shows the take it lands on, as a click on it does; the preview keeps the focus, so
// the arrow keys go on stepping.
function stepStage(app, by, dir) {
  const r = reelShown(app), to = r && stageStep(stageSteps(app.chunks(), app.data.chain?.takes), { seg: r.seg, folder: r.take?.folder }, by, dir);
  if (!to) return;
  showInStage(app, { seg: to.seg, folder: to.folder });
  box(app)?.focus({ preventScroll: true });
}

const sigOf = (app) => JSON.stringify([app.chunks()?.length ?? 0, app.state.stage, app.state.picker,
  (app.data.chain?.clips || []).map((c) => c.version), Object.values(app.data.chain?.takes || {}).flat().map((t) => `${t.folder}${t.active ? "*" : ""}`),
  resultsOf(app).map((t) => `${t.prompt}:${t.media.length}`), shownResult(app)?.prompt, chosenResult(app)?.prompt, app.bridge.modelWired?.()]);

// Draws the preview again when what it shows changed (`force`: always); the live preview keeps its own place.
export function paintStage(app, force = false) {
  const host = box(app);
  if (!host) return;
  const sig = sigOf(app);
  if (!force && host.dataset.sig === sig) return;
  host.dataset.sig = sig;
  host.querySelector(".st-body").innerHTML = app.chunks() ? reelHTML(app) : singleHTML(app);
  host.querySelector(".st-video")?.play?.().catch(() => {});
  paintStageLive(app);  // a run sampling keeps its live preview through the redraw
}

function singleHTML(app) {
  const shown = shownResult(app), chosen = chosenResult(app), list = resultsOf(app), n = list.indexOf(shown) + 1;
  if (!shown) {
    return `<div class="st-media"><div class="st-empty muted">What a run makes comes in here: the live preview while it samples, then the picture or the clip, its takes under it.`
      + `${app.bridge.modelWired?.() === false ? " For the live preview, run the model through this node: the loader into its <b>model</b> input, its <b>model</b> output on to the sampler." : ""}</div></div>`
      + resultsHTML(app, takeVars(app, resultTake(app)));
  }
  const m = mainMedia(shown), all = takeMedia(shown), counts = shown === chosen;
  return `<div class="st-head"><b>Take ${n}</b><span class="muted">seed ${shown.seed ?? "?"}${shown.take ? ` + ${shown.take}` : ""} · ${all.length > 1 ? `${all.length} pictures` : esc(m.filename)}</span>`
    + `<span class="grow"></span>${counts ? `<span class="st-chosen">${icon("check")}circled</span>`
      : `<button type="button" class="btn slim" data-stact="choose" title="Circle this take: it is the one that counts, the golden one; a take that rolled anew gives the node its seed">${icon("check")}Circle this take</button>`}</div>`
    + `<div class="st-media${counts ? " chosen" : ""}">${all.length > 1  // a grid's take: its views side by side (#320)
      ? `<div class="st-views">${all.map((x) => mediaHTML(app, x, true, true)).join("")}</div>` : mediaHTML(app, m, true, true)}</div>`
    + resultsHTML(app, takeVars(app, resultTake(app)));
}

function reelHTML(app) {
  const r = reelShown(app);
  if (!r) return '<div class="st-media"><div class="st-empty muted">The clips come in under their scenes; a click on one, or on one of its takes, shows it here.</div></div>';
  const path = app.bridge.chain(), i = r.take ? r.takes.indexOf(r.take) + 1 : 0;
  const src = r.take && r.takes.length > 1 ? app.api.takeVideoURL(path, r.take.folder) : app.api.chainVideoURL(r.seg, path, r.clip?.version);
  const picker = app.state.picker, steps = stageSteps(app.chunks(), app.data.chain?.takes), at = { seg: r.seg, folder: r.take?.folder };
  const step = (by, dir, inner) => {  // #430
    const to = stageStep(steps, at, by, dir), where = dir < 0 ? "before" : "after", key = `${by === "take" ? "Shift+" : ""}${dir < 0 ? "←" : "→"}`;
    const n = to && (app.data.chain.takes[to.seg] || []).findIndex((t) => t.folder === to.folder) + 1;
    const title = !to ? (by === "take" ? `No take ${where} this one in its scene` : `No scene ${where} this one with a clip made`)
      : by === "take" ? `The take ${where} (${key}): clip ${to.seg + 1}, take ${n}` : `The scene ${where} (${key}): clip ${to.seg + 1}, its circled take`;
    return `<button type="button" class="btn slim ghost st-step" data-ststep="${by}" data-dir="${dir}" title="${title}" aria-label="${title}" ${to ? "" : "disabled"}>${inner}</button>`;
  };
  const head = `<div class="st-head"><span class="st-steps">${step("scene", -1, icon("skip", "flip"))}${step("take", -1, "‹")}</span>`
    + `<b>Clip ${r.seg + 1}</b>${i && r.takes.length > 1 ? `<span class="muted">take ${i} of ${r.takes.length}</span>` : ""}`
    + `${r.take ? `<span class="muted">seed ${r.take.seed ?? "?"}${r.take.take ? ` + ${r.take.take}` : ""}</span>` : ""}`
    + `<span class="st-steps">${step("take", 1, "›")}${step("scene", 1, icon("skip"))}</span><span class="grow"></span>`
    + (r.film ? `<span class="st-chosen">${icon("check")}circled</span>`
      : `<button type="button" class="btn slim" data-stact="film" title="Circle this take: it goes in the film, and REMEMBER: and the next clip use it">${icon("check")}Circle this take</button>`)
    + `<button type="button" class="btn slim ghost" data-stact="picker" aria-pressed="${!!picker}" ${r.film ? "" : "disabled"} title="${r.film
      ? "Step through the clip frame by frame and pick frames for a REMEMBER: line of its scene" : "Circle it first: REMEMBER: takes the film's frames"}">${icon("image")}Pick frames</button></div>`;
  const video = `<div class="st-media${r.film ? " chosen" : ""}"><video class="st-video" controls autoplay loop playsinline src="${esc(src)}"></video></div>`;
  return head + video + (picker && r.film ? pickerHTML(picker, r.seg) : "");
}

// The frame picker (#223): step frame by frame, mark the good ones, write them into a REMEMBER: line of the scene.
function pickerHTML(p, seg) {
  return `<div class="st-picker"><button type="button" class="btn slim ghost" data-stact="back" title="One frame back (←)">‹ frame</button>`
    + `<span class="mono st-frame">frame 0</span><button type="button" class="btn slim ghost" data-stact="next" title="One frame on (→)">frame ›</button>`
    + `<button type="button" class="btn slim" data-stact="mark" title="Mark this frame (M)">${icon("plus")}Mark</button>`
    + `<span class="st-marks">${p.marks.map((f) => `<span class="tagchip mono">${f}<button class="mini" data-stunmark="${f}" aria-label="Unmark frame ${f}">${icon("x")}</button></span>`).join("")
      || '<span class="muted">no frames marked</span>'}</span>`
    + `<span class="grow"></span><input class="input mono st-as" value="${esc(p.as)}" placeholder="as @NAME, image 3 or refmod NAME" aria-label="What the frames become" spellcheck="false">`
    + `<button type="button" class="btn slim primary" data-stact="write" ${p.marks.length ? "" : "disabled"} title="Writes REMEMBER: frames … as … into the scene that plays clip ${seg + 1}">Write REMEMBER:</button></div>`;
}

// A REMEMBER: line for the frames marked, at the end of the scene that plays clip `seg` (#223).
export function rememberLine(marks, as) {
  const frames = [...new Set(marks)].sort((a, b) => a - b);
  return `REMEMBER: ${frames.length === 1 ? `frame ${frames[0]}` : `frames ${frames.join(", ")}`} as ${as.trim()}`;
}

export function withRemember(text, chunk, line) {
  const cells = splitCells(text);
  return cells.map((c) => (c.chunk === chunk ? c.text.replace(/\s*$/, (rest) => `\n${line}${rest}`) : c.text)).join("\n");  // before its blank lines
}

const frameOf = (video) => Math.round((video?.currentTime || 0) * FPS);

// The preview's clicks, keys and grip; `edited()`: the template changed (a REMEMBER: line written).
export function wireStage(app, { edited }) {
  const host = box(app);
  if (!host) return;
  wireResults(app, host, () => paintStage(app, true));
  host.addEventListener("pointerdown", (e) => {  // the takes' grip: their size, kept on the node, apart from a reel's
    if (!e.target.closest("[data-grip]")) return;
    e.preventDefault();
    e.stopPropagation();
    const start = resultTake(app), x0 = e.clientX;
    let least = start;
    const move = (m) => {
      least = Math.min(320, Math.max(32, Math.round(start + (m.clientX - x0) / 2)));
      host.querySelectorAll(".cm-takes.results").forEach((strip) => { strip.style.cssText = takeVars(app, least); });
    };
    const up = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      app.bridge.props.orrery_result_take = least;
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
  });
  const grip = app.view.querySelector(".stage-grip");
  grip?.addEventListener("pointerdown", (e) => {  // the preview's height, kept on the node
    e.preventDefault();
    e.stopPropagation();
    const y0 = e.clientY, h0 = host.offsetHeight, k = host.getBoundingClientRect().height / host.offsetHeight || 1;
    const move = (m) => { host.style.setProperty("--stage-h", `${Math.min(1400, Math.max(140, Math.round(h0 - (m.clientY - y0) / k)))}px`); };
    const up = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      app.bridge.props.orrery_stage_h = host.offsetHeight;
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
  });
  const tick = () => { const f = host.querySelector(".st-frame"); if (f) f.textContent = `frame ${frameOf(host.querySelector(".st-video"))}`; };
  host.addEventListener("timeupdate", tick, true);
  host.addEventListener("seeked", tick, true);
  host.addEventListener("input", (e) => { if (e.target.classList.contains("st-as") && app.state.picker) app.state.picker.as = e.target.value; });
  host.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.ctrlKey || e.metaKey || e.altKey) return;
    if (app.state.picker) {  // the frame picker keeps the arrows for frames
      const act = { ArrowLeft: "back", ArrowRight: "next", m: "mark", M: "mark" }[e.key];
      if (act) { e.preventDefault(); host.querySelector(`[data-stact="${act}"]`)?.click(); }
      return;
    }
    const dir = { ArrowLeft: -1, ArrowRight: 1 }[e.key];  // #430: ← → scenes, Shift+← → takes, before the video seeks
    if (!dir || !app.chunks()) return;
    e.preventDefault();
    stepStage(app, e.shiftKey ? "take" : "scene", dir);
  });
  host.addEventListener("click", async (e) => {
    const steps = e.target.closest("[data-ststep]");
    if (steps) return stepStage(app, steps.dataset.ststep, Number(steps.dataset.dir));
    const un = e.target.closest("[data-stunmark]");
    if (un) { app.state.picker.marks = app.state.picker.marks.filter((f) => f !== Number(un.dataset.stunmark)); return paintStage(app, true); }
    const act = e.target.closest("[data-stact]")?.dataset.stact, video = host.querySelector(".st-video");
    if (!act) return;
    if (act === "choose") { chooseResult(app, shownResult(app)); return paintStage(app, true); }
    const r = app.chunks() && reelShown(app);
    if (act === "film" && r?.take) { await pickTake(app, r.seg, r.take.folder); return paintStage(app, true); }
    if (act === "picker") {
      app.state.picker = app.state.picker ? null : { marks: [], as: "" };
      paintStage(app, true);
      return host.querySelector(".st-video")?.pause();
    }
    if (act === "back" || act === "next") {
      video.pause();
      video.currentTime = Math.max(0, (frameOf(video) + (act === "next" ? 1 : -1)) / FPS + 0.001);
      return;
    }
    if (act === "mark") {
      video.pause();
      app.state.picker.marks = [...new Set([...app.state.picker.marks, frameOf(video)])].sort((a, b) => a - b);
      const t = video.currentTime;
      paintStage(app, true);
      const again = host.querySelector(".st-video");
      if (again) { again.pause(); again.currentTime = t; }
      return;
    }
    if (act === "write" && r) {
      const p = app.state.picker, as = p.as.trim(), chunk = (app.chunks() || []).findIndex((c) => plays(c, r.seg));
      if (!as) { host.querySelector(".st-as")?.focus(); return app.toast("Say what the frames become: <b>@NAME</b>, <b>image 3</b> or <b>refmod NAME</b>"); }
      if (chunk < 0) return app.toast(`No scene plays clip ${r.seg + 1} at this seed`);
      const line = rememberLine(p.marks, as);
      app.text = withRemember(app.text, chunk, line);
      app.state.picker = null;
      edited();
      app.toast(`<code>${esc(line)}</code> is in the scene that plays clip ${r.seg + 1}`);
    }
  });
}

// The live preview of the run sampling now, in the picture's place between the head and the takes, which stay in
// view (timeline.js paintLive keeps it fresh).
export function paintStageLive(app) {
  const host = box(app), media = host?.querySelector(".st-media");
  if (!media) return;
  const live = app.live;
  let view = media.querySelector(".st-live");
  if (!live) { view?.remove(); return; }
  if (!view) view = media.appendChild(Object.assign(document.createElement("div"), { className: "st-live" }));
  let pic = view.querySelector(".st-live-pic");
  if (live.url && (!pic || (pic.tagName === "VIDEO") !== live.video)) {
    pic?.remove();
    pic = document.createElement(live.video ? "video" : "img");
    pic.className = "st-live-pic";
    if (live.video) Object.assign(pic, { muted: true, loop: true, autoplay: true, playsInline: true });
    view.prepend(pic);
  }
  if (pic && live.url && pic.src !== live.url) pic.src = live.url;
  let step = view.querySelector(".tl-step");
  if (!step) step = view.appendChild(Object.assign(document.createElement("span"), { className: "tl-step" }));
  const p = live.total ? live.step / live.total : 0;
  step.textContent = live.total ? `${live.segment >= 0 ? `clip ${live.segment + 1} · ` : ""}step ${live.step} / ${live.total}` : "starting…";
  step.style.setProperty("--p", `${Math.round(p * 100)}%`);
}

export const stageSectionHTML = (app) => `<div class="stage-grip" role="separator" aria-orientation="horizontal" title="Drag to size the preview"></div>`
  + `<section class="stage" tabindex="-1" aria-label="Preview" style="--stage-h:${Number(app.bridge.props.orrery_stage_h) || STAGE_H}px">`
  + `<div class="st-body"></div></section>`;
