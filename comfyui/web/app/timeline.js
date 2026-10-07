// A reel's clips as Orrery Film (or H3 Motion Context's Chain Video) keeps them, under each scene in the cells
// view (cells.js), each scene's in a section of its own. The column beside the editor went in #185: the dials
// have that place now.
import { esc } from "./highlight.js";
import { icon } from "./icons.js";
import { shape } from "./model.js";
import { fetchTemplates, useVersion, versionOf, versionText } from "./versions.js";
import { paintStageLive, showInStage } from "./stage.js";
import { ghostHTML, kept, playAll, statHTML, stripHeadHTML } from "./results.js";

// The clips the chain holds, fetched again after every run, and the templates its takes were made with (#242).
export async function loadChain(app) {
  try { app.data.chain = await app.api.chain(app.bridge.chain()); } catch { app.data.chain = null; }
  await fetchTemplates(app, Object.values(app.data.chain?.takes || {}).flat());
  try { app.data.anchors = (await app.api.anchors()).images; } catch { app.data.anchors = []; }  // the ones keep_sent holds (#371)
  app.data.anchorV = Date.now();  // anchors change in place: a new run, a new URL
}

// The segments a chunk shows: all it plays, or for one that repeats forever, the clips made so far
// and the next one.
function segmentsOf(c, clips) {
  if (c.segs) {  // GOTO: the segments on the walked path; an endless one, those made and the next
    if (!c.endless) return c.segs;
    const next = c.segs.find((s) => !clips.has(s));
    return [...c.segs.filter((s) => clips.has(s)), ...(next === undefined ? [] : [next])];
  }
  if (c.first === null) return [];
  if (c.repeat !== Infinity) return Array.from({ length: c.repeat }, (_, i) => c.first + i);
  const made = [...clips.keys()].filter((s) => s >= c.first);
  return [...made, made.length ? Math.max(...made) + 1 : c.first];
}

// The clips' width / height: a chain keeps one frame size; before it holds a clip, the size the template asks for.
export function clipRatio(app) {
  const { width, height } = app.data.chain?.width && app.data.chain?.height ? app.data.chain : shape(app.text);
  return width / height;
}

// A chunk's clips for its section in the cells view: each its strip of takes (#331); the clip being made and the
// take clicked show in the preview below. The frames its REMEMBER: lines take come under them (remember.js stripHTML).
export function sectionHTML(app, c) {
  if (c.first === null) {
    return `<span class="muted cm-none">${!c.segs ? "never plays: a scene before it repeats forever"
      : app.reelPath() ? "never plays at this seed: the walk does not reach it" : "walking the reel at this seed…"}</span>`;
  }
  const clips = new Map((app.data.chain?.clips || []).map((x) => [x.segment, x]));
  const segment = Number(app.bridge.getSegment()), segs = segmentsOf(c, clips);
  return segs.map((s) => takesHTML(app, s, c, clips.has(s) || s === segment)).join("");
}

// The × that deletes a take (#214), on hover; a click asks in place.
function delHTML(folder) {
  return `<span class="del" role="button" data-del="${esc(folder)}" title="Delete this take" aria-label="Delete this take">${icon("x")}</span>`;
}

// The column beside a clip's takes (#245, #319), the results' head: + take, ×N, 📌 and play all on top, the clip in
// numbers, deleting at the bottom. `ready`: the clip is made, or the next to make, so + take can make one.
export function takesHeadHTML(app, s, takes, c = {}, ready = true) {
  const film = takes.findIndex((t) => t.active), on = takes[film], n = c.index ?? 0;
  const newest = takes.map((t) => String(t.created || "")).sort().pop()?.slice(11, 16), older = takes.filter((t) => versionOf(app, t)).length;
  const attr = (act) => (act === "play" ? "data-playall" : `data-scene-act="${act}" data-chunk="${n}" data-seg="${s}"`);
  return stripHeadHTML(app, { attr, keep: kept(app, n), play: takes.length > 1, title: `clip ${s + 1}`, sub: c.title || "",
    off: app.state.sweepQueue ? "A sweep is queueing" : ready ? "" : `Clip ${s + 1} comes after clip ${s}: make that one first`,
    stats: statHTML("takes", takes.length) + statHTML("circled", on ? `#${film + 1}` : "none")
      + (on ? statHTML("seed", `${on.seed ?? "?"}${on.take ? ` + ${on.take}` : ""}`) : "") + (newest ? statHTML("newest", newest) : "")
      + (older ? statHTML("✎ other prompt", older, "th-ver") : ""),
    low: takes.length ? (takes.length > 1 ? ghostHTML('data-clear="others"', `${icon("trash")}the others`, `Delete every take of clip ${s + 1} but the circled one`) : "")
      + ghostHTML('data-clear="all"', `${icon("trash")}all`, `Delete every take of clip ${s + 1}, the circled one too: the film then ends before it`, 'data-danger="1"') : "" });
}

// ✎ on a take made with another prompt (#242): its title says what changed, a click puts that prompt in the editor.
function verHTML(app, t) {
  const v = versionOf(app, t);
  return v ? `<span class="ver" role="button" data-ver="${esc(t.folder)}" title="${esc(`Made with another prompt · click: use this prompt\n${versionText(v)}`)}">✎</span>` : "";
}

// The takes made with another prompt, for the cells to tell when their marks change.
export function olderTakes(app) {
  return Object.values(app.data.chain?.takes || {}).flat().filter((t) => versionOf(app, t)).map((t) => t.folder);
}

// A take's size in the clip's shape (#215): `least`, the shorter side, as the grip at the strip's end sets it.
export function takeVars(app, least = Number(app.data.take_min) || 54) {
  const ratio = clipRatio(app), w = ratio >= 1 ? least * ratio : least, h = ratio >= 1 ? least : least / ratio;
  return `--take-w:${Math.round(w)}px;--take-h:${Math.round(h)}px;--take-r:${(w / h).toFixed(4)}`;
}

// A clip's takes (#206), from its first (#319): hover plays one, a click shows it in the preview, which circles it.
function takesHTML(app, s, c, ready) {
  const takes = app.data.chain?.takes?.[s] || [];
  return `<div class="cm-takes" data-seg="${s}" style="${takeVars(app)}">${takesHeadHTML(app, s, takes, c, ready)}<div class="cm-takes-list">${takes.map((t, i) =>
    `<button type="button" class="take${t.active ? " on" : ""}" data-take="${esc(t.folder)}" data-seg="${s}" title="Take ${i + 1} · seed ${t.seed ?? "?"}`
    + `${t.take ? ` + ${t.take}` : ""}${t.active ? " · circled: in the film" : " · click to show it"}">`
    + `<img loading="lazy" alt="" src="${app.api.takeThumbURL(app.bridge.chain(), t.folder)}"><span class="n">${i + 1}</span>${verHTML(app, t)}${delHTML(t.folder)}</button>`).join("")}`
    + `${takes.length ? '<span class="grip" data-grip title="Drag to size the takes"></span>' : ""}</div></div>`;
}

// Sample surfing (#206): the take picked is the one the film, REMEMBER: and the next clip use. A take that rolled
// anew sets the node's seed to its own, so the clips after it roll the same world.
export async function pickTake(app, segment, folder) {
  try {
    const got = await app.api.pickTake(app.bridge.chain(), segment, folder);
    followSeed(app, got);
    await loadChain(app);
    app.refreshRun?.();
    app.toast(`Take circled: clip ${segment + 1} plays it in the film`);
  } catch (err) { app.fail(err); }
}

function followSeed(app, got) {
  if (!got.take && got.seed != null && Number(got.seed) !== Number(app.bridge.getSeed())) app.bridge.setSeed(Number(got.seed));
}

// Every take of a clip at once (#238): their videos made from the stills, from the start and in step.
const takeVideo = (app) => (t) => {
  let v = t.querySelector("video");
  if (!v) {
    v = Object.assign(document.createElement("video"), { muted: true, loop: true, playsInline: true, preload: "auto" });
    v.dataset.made = "1";
    v.src = app.api.takeVideoURL(app.bridge.chain(), t.dataset.take);
    t.prepend(v);
  }
  return v;
};

// A clip's takes deleted at once (#234), asked in place: all but the one in the film, or that one too, and then
// the film ends before the clip, and the next clip is that one.
async function clearTakes(app, segment, keep) {
  try {
    const got = await app.api.clearTakes(app.bridge.chain(), segment, keep);
    const ended = !keep && Number(app.bridge.getSegment()) > segment;
    if (ended) app.bridge.setSegment(segment);
    await loadChain(app);
    app.refreshRun?.();
    app.toast(keep ? `${got.deleted} takes of clip ${segment + 1} deleted; the circled one stays`
      : `Clip ${segment + 1} deleted with its ${got.deleted} takes: the film ends before it${ended ? `, and the next clip is ${segment + 1}` : ""}`);
  } catch (err) { app.fail(err); }
}

// What deleting a take does, asked in place (#214): the clip plays another take, or the film ends before it.
export function deleteQuestion(app, host) {
  const s = Number(host.dataset.seg), folder = host.querySelector("[data-del]").dataset.del;
  const takes = app.data.chain?.takes?.[s] || [], at = takes.findIndex((t) => t.folder === folder);
  if (at >= 0 && !takes[at].active) return `Delete take ${at + 1}?`;
  const others = takes.filter((t) => t.folder !== folder);  // the circled take is the one in the film
  return others.length ? `Delete this take? Clip ${s + 1} then plays take ${takes.indexOf(others[others.length - 1]) + 1}.`
    : `Delete clip ${s + 1}? The film ends before it.`;
}

// A take deleted (#214): the film keeps the clip's newest other take, or ends before the clip, and then the next
// clip is that one.
async function deleteTake(app, segment, folder) {
  try {
    const got = await app.api.deleteTake(app.bridge.chain(), segment, folder);
    const ended = !got.folder && Number(app.bridge.getSegment()) > segment;
    if (got.folder) followSeed(app, got);
    else if (ended) app.bridge.setSegment(segment);
    await loadChain(app);
    app.refreshRun?.();
    app.toast(got.folder ? `Take deleted; clip ${segment + 1} plays another take`
      : `Clip ${segment + 1} deleted: the film ends before it${ended ? `, and the next clip is ${segment + 1}` : ""}`);
  } catch (err) { app.fail(err); }
}

// The clip a scene's REMEMBER: lines cut their frames from (its first), when the chain holds it; -1 the input video.
export function sourceClip(app, source) {
  if (source === null || source === undefined) return null;
  if (source < 0) return { url: app.api.chainVideoURL(-1, app.bridge.chain()), frames: null };
  const clip = (app.data.chain?.clips || []).find((x) => x.segment === source);
  return clip ? { url: app.api.chainVideoURL(source, app.bridge.chain(), clip.version), frames: clip.frames ?? null } : null;
}

// The clip rendering now (#205): the sampler's preview and its step, large in the preview below the scenes (#305)
// and small as the take it is making, at the end of its clip's strip of takes (#331). The strips are drawn again
// when the sections change, so this paints over whatever is there; without a live clip it takes the tile off.
export function paintLive(app) {
  paintStageLive(app);
  const host = app.view?.querySelector(".editor.cells");
  if (!host) return;
  const live = app.live;
  host.querySelectorAll(".take.live").forEach((tile) => {
    if (!live || tile.dataset.seg !== String(live.segment)) tile.remove();
  });
  const list = live && host.querySelector(`.cm-takes[data-seg="${live.segment}"] .cm-takes-list`);
  if (!list) return;
  let tile = list.querySelector(".take.live");
  if (!tile) {
    tile = Object.assign(document.createElement("span"), { className: "take live", title: `Clip ${live.segment + 1}: the take being made` });
    tile.dataset.seg = String(live.segment);
    list.insertBefore(tile, list.querySelector("[data-grip]"));
  }
  let view = tile.querySelector(".tl-live");
  if (live.url && (!view || (view.tagName === "VIDEO") !== live.video)) {
    view?.remove();
    view = document.createElement(live.video ? "video" : "img");
    view.className = "tl-live";
    if (live.video) Object.assign(view, { muted: true, loop: true, autoplay: true, playsInline: true });
    tile.prepend(view);
  }
  if (view && live.url && view.src !== live.url) view.src = live.url;
  let step = tile.querySelector(".tl-step");
  if (!step) step = tile.appendChild(Object.assign(document.createElement("span"), { className: "tl-step" }));
  step.textContent = live.total ? `${live.step}/${live.total}` : "…";
  step.style.setProperty("--p", `${Math.round((live.total ? live.step / live.total : 0) * 100)}%`);
}

// Hover plays a take in place; a click shows it in the preview. The grip at a takes strip's end sizes every take (#215).
export function wireClips(app, box) {
  box.addEventListener("pointerdown", (e) => {
    const grip = e.target.closest("[data-grip]");
    if (!grip) return;
    e.preventDefault();
    e.stopPropagation();  // not a drag of the node
    const ratio = clipRatio(app), start = Number(app.data.take_min) || 54, x0 = e.clientX, y0 = e.clientY;
    let least = start;
    // the window's events, not the grip's: the grip moves away under the pointer as the takes resize and wrap
    const move = (m) => {  // along the take's longer move: its shorter side follows the pointer
      const dx = (m.clientX - x0) / Math.max(ratio, 1), dy = (m.clientY - y0) / Math.max(1 / ratio, 1);
      least = Math.min(480, Math.max(32, Math.round(start + (Math.abs(dx) > Math.abs(dy) ? dx : dy))));
      box.querySelectorAll(".cm-takes").forEach((strip) => { strip.style.cssText = takeVars(app, least); });
    };
    const up = async () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      if (least === start) return;
      app.data.take_min = least;
      try { Object.assign(app.data, await app.api.saveUi({ take_min: least })); } catch (err) { app.fail(err); }
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
  });
  box.addEventListener("pointerover", (e) => {  // a reel's takes and clips; the results under the prompt are results.js's
    const take = e.target.closest(".take[data-take]");
    if (take && !take.querySelector("video")) {
      const v = Object.assign(document.createElement("video"), { muted: true, loop: true, autoplay: true, playsInline: true });
      v.src = app.api.takeVideoURL(app.bridge.chain(), take.dataset.take);
      take.prepend(v);
      return;
    }
  });
  box.addEventListener("pointerout", (e) => {
    const take = e.target.closest(".take[data-take]");
    if (take && !take.contains(e.relatedTarget) && !take.closest(".cm-takes.playing")) take.querySelector("video")?.remove();
  });
  box.addEventListener("click", (e) => {
    if (e.target.closest(".cm-takes.results")) return;
    const head = e.target.closest(".cm-takes-head");
    if (head) {
      const strip = head.closest(".cm-takes"), s = Number(strip.dataset.seg), count = strip.querySelectorAll(".take[data-take]").length;
      const play = e.target.closest("[data-playall]");
      if (play) return playAll(strip, play, takeVideo(app));
      if (e.target.closest("[data-clearno]")) return head.querySelector(".ask")?.remove();
      const yes = e.target.closest("[data-clearyes]");
      if (yes) return clearTakes(app, s, yes.dataset.clearyes === "others");
      const ask = e.target.closest("[data-clear]");
      if (!ask) return;
      head.querySelector(".ask")?.remove();
      const others = ask.dataset.clear === "others";
      return head.insertAdjacentHTML("beforeend", `<span class="ask">${others ? `Delete ${count - 1} takes? The circled one stays.`
        : `Delete all ${count} takes? The film ends before clip ${s + 1}.`}<span class="btn danger" role="button" data-clearyes="${ask.dataset.clear}">Delete</span>`
        + `<span class="btn ghost" role="button" data-clearno>Keep</span></span>`);
    }
    const ver = e.target.closest("[data-ver]");
    if (ver) {
      const v = versionOf(app, Object.values(app.data.chain?.takes || {}).flat().find((t) => t.folder === ver.dataset.ver));
      return v && useVersion(app, v);
    }
    const host = e.target.closest(".take[data-take]");
    if (e.target.closest("[data-delno]")) return host.querySelector(".ask")?.remove();
    if (e.target.closest("[data-delyes]")) return deleteTake(app, Number(host.dataset.seg), host.querySelector("[data-del]").dataset.del);
    if (e.target.closest(".ask")) return;
    if (e.target.closest("[data-del]")) {
      return host.insertAdjacentHTML("beforeend", `<span class="ask">${deleteQuestion(app, host)}`
        + `<span class="btn danger" role="button" data-delyes>Delete</span><span class="btn ghost" role="button" data-delno>Keep</span></span>`);
    }
    // a click shows a take in the preview (#305); the preview's Circle this take puts it in the film
    const take = e.target.closest(".take[data-take]");
    if (take) showInStage(app, { seg: Number(take.dataset.seg), folder: take.dataset.take });
  });
}
