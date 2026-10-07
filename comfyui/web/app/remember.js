// What a reel's REMEMBER: lines take and where it goes, shown before any run: the server says per line
// where its frames go (POST /orrery/remembered, the compile's own resolution), the browser cuts the
// frames from the clip they come from (a <video> sought to each frame, drawn), and a frame picked by eye
// rewrites the line. Under a scene's takes they make its anchors (#371): what it hands on to the clips after it.
import { esc } from "./highlight.js";
import { statHTML } from "./results.js";

export const FPS = 24;
const LINE = /^\s*(REMEMBER|SEND):/i;
const COMMENT = /^\s*#/;
const MAX_STRIP = 12;  // a range's frames shown at most, spread out; the count says how many it takes

// The REMEMBER: (SEND:) lines of a text, in order: their indices, as the server counts them.
export function rememberLines(text) {
  const out = [];
  text.split("\n").forEach((l, i) => { if (LINE.test(l) && !COMMENT.test(l)) out.push(i); });
  return out;
}

// The frames a span list takes from a clip of `count` frames: chain.frame_picks and `[::step]`, as Orrery
// Refs reads them. A negative frame counts from the end; frames outside the clip are dropped, and with
// none left the last stands in.
export function framePicks(count, spans, step = 1) {
  const kept = [], dropped = [];
  for (const [first, last] of spans) {
    const a = first < 0 ? first + count : first, b = last < 0 ? last + count : last;
    for (let i = a; i <= b; i++) (i >= 0 && i < count ? kept : dropped).push(i);
  }
  const picks = (kept.length ? kept : count ? [count - 1] : []).filter((_, k) => k % Math.max(1, step) === 0);
  return { picks, dropped };
}

// "2+", "2–5", "2": the clips a fill covers, counted from 1.
const clipsText = (spans) => spans.map(([lo, hi]) => (hi === null ? `${lo + 1}+` : hi === lo ? `${lo + 1}` : `${lo + 1}–${hi + 1}`)).join(", ");

// The hint at a line's end: what it fills, for whom, in which clips, and what replaces it.
export function hintText(line, lines) {
  if (line.source === null) return "never plays at this seed";
  const what = line.fills.map((f) => f.what);
  const images = what.filter((w) => w.startsWith("image ")).map((w) => w.slice(6));
  const fill = line.fills[0];
  let text = `→ ${images.length > 1 ? `images ${images.join(", ")}` : what.join(", ")}`;
  if (fill.member) text += ` · @${fill.member}`;
  if (fill.clips.length) text += ` · clip${/[+,–]/.test(clipsText(fill.clips)) ? "s" : ""} ${clipsText(fill.clips)}`;
  const replaced = line.fills.filter((f) => f.replaced);
  for (const f of replaced) {
    const by = lines.find((l) => l.line === f.replaced.by);
    text += ` · ${line.fills.length > 1 ? `${f.what} ` : ""}replaced from clip ${f.replaced.from + 1} by "${by?.said ?? `line ${f.replaced.by + 1}`}"`;
  }
  return text;
}

// The hints for a text (line index → text), from the server's lines, matched by their place among the
// REMEMBER: lines; `offset` shifts them for a cell that starts further down the whole text.
export function hintsFor(text, remembered, offset = 0) {
  const lines = remembered?.lines || [];
  const out = new Map();
  rememberLines(text).forEach((i, n) => {
    const line = lines.find((l) => l.line === n + offset);
    if (line) out.set(i, { text: hintText(line, lines), replaced: line.fills.every((f) => f.replaced) });
  });
  return out;
}

// --- frames, cut in the browser ---------------------------------------------------------------------

const videos = new Map();  // url → { ready: Promise<HTMLVideoElement>, queue: Promise }
const frames = new Map();  // `${url}#${frame}` → Promise<dataURL>

function video(url) {
  if (!videos.has(url)) {
    const v = Object.assign(document.createElement("video"), { muted: true, preload: "auto", playsInline: true, src: url });
    const ready = new Promise((ok, fail) => {
      v.addEventListener("loadeddata", () => ok(v), { once: true });
      v.addEventListener("error", () => fail(new Error("no clip")), { once: true });
    });
    videos.set(url, { ready, queue: Promise.resolve() });
  }
  return videos.get(url);
}

// How many frames the clip has: the chain's count when it knows it, else its length at 24 fps.
export async function frameCount(url, known) {
  if (known) return known;
  const v = await video(url).ready;
  return Math.max(1, Math.round(v.duration * FPS));
}

// One frame of a clip as an image, `height` pixels high; seeks one after another per clip.
export function grab(url, frame, height = 96) {
  const key = `${url}#${frame}#${height}`;
  if (!frames.has(key)) {
    const slot = video(url);
    const job = slot.queue.then(async () => {
      const v = await slot.ready;
      v.currentTime = Math.min((frame + 0.5) / FPS, Math.max(0, v.duration - 0.001));
      await new Promise((ok) => v.addEventListener("seeked", ok, { once: true }));
      const c = document.createElement("canvas");
      c.height = height;
      c.width = Math.round((height * v.videoWidth) / v.videoHeight);
      c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
      return c.toDataURL("image/jpeg", 0.85);
    });
    slot.queue = job.catch(() => {});
    frames.set(key, job);
  }
  return frames.get(key);
}

// The frames to show of a span: one, or a range spread out to MAX_STRIP.
export function shown(picks) {
  if (picks.length <= MAX_STRIP) return picks;
  return Array.from({ length: MAX_STRIP }, (_, k) => picks[Math.round((k * (picks.length - 1)) / (MAX_STRIP - 1))]);
}

// --- the anchors under a scene's takes (#371) -------------------------------------------------------

// The images a line fills (a RefMod has none).
const imagesOf = (l) => l.fills.map((f) => /^image (\d+)$/.exec(f.what)?.[1]).filter(Boolean).map(Number);

const ABOUT = "What this scene's REMEMBER: lines hand on to the clips after it: the frames each takes from the circled "
  + "take (click one to pick another). With keep_sent on in Orrery Refs, an image that has a stored anchor (from an "
  + "earlier run) is held instead, for the whole run; off, this run's frames replace the anchors";

// One group per REMEMBER: line of the scene, in a strip like the takes': a head that says what it is, the frames
// (filled in by fillStrip) and where they go, and a grip that sizes them. `keep`: Orrery Refs' keep_sent is on, so an
// image in `stored` (anchors/image_N) is held: its anchor shows, and the line's frames wait.
export function stripHTML(app, scene, sourceURL, { keep = false, stored = [] } = {}) {
  const lines = (app.data.remembered?.lines || []).filter((l) => l.scene === scene && l.source !== null);
  if (!lines.length) return "";
  const held = (n) => keep && stored.includes(n);
  const images = [...new Set(lines.flatMap(imagesOf))];
  const head = `<span class="cm-takes-head rm-head" title="${esc(ABOUT)}"><span class="th-mid"><span class="th-clip">anchors</span>`
    + `<span class="th-scene">what REMEMBER: hands on</span><span class="th-stats">${statHTML("images", images.join(", ") || "none")}`
    + `${statHTML("keep_sent", keep ? "on" : "off")}${keep ? statHTML("held", images.filter(held).join(", ") || "none") : ""}</span></span></span>`;
  return `<div class="rm-panel" style="--rm-h:${Number(app.data.anchor_h) || 72}px">${head}<div class="rm-strip">${lines.map((l) => {
    const spans = l.fills.flatMap((f) => f.frames.map((s) => ({ span: s, step: f.step })));
    const mine = imagesOf(l), kept = mine.filter(held);
    const cls = `${l.fills.every((f) => f.replaced) ? " replaced" : ""}${mine.length && kept.length === mine.length ? " held" : ""}`;
    return `<div class="rm-line${cls}" data-line="${l.line}"><div class="rm-frames">`
      + kept.map((n) => `<span class="rm-anchor" title="keep_sent holds image ${n}'s stored anchor: the clips after this one get it, not the frames beside it">`
        + `<img alt="" src="${esc(app.api.anchorURL(n, app.data.anchorV))}"><span class="rm-n">held · image ${n}</span></span>`).join("")
      + `${spans.map((s, item) => `<span class="rm-item" data-item="${item}" data-span="${s.span.join(",")}" data-step="${s.step}"${sourceURL ? ` data-url="${esc(sourceURL)}"` : ""}></span>`).join("")}</div>`
      + `<div class="rm-said"><b>${esc(l.said)}</b> <span class="muted">${esc(hintText(l, app.data.remembered.lines))}</span></div></div>`;
  }).join("")}</div><span class="grip" data-rm-grip title="Drag to size the anchors"></span></div>`;
}

// The frames of every group in `box`, cut from the clip they come from, `height` pixels high; `count` the clip's frames if known.
export async function fillStrip(box, count, height = 96) {
  for (const item of box.querySelectorAll(".rm-item[data-url]:not(.filled)")) {
    item.classList.add("filled");
    const url = item.dataset.url, span = item.dataset.span.split(",").map(Number), step = Number(item.dataset.step);
    let n;
    try { n = await frameCount(url, count); } catch { item.innerHTML = '<span class="rm-none">no clip yet</span>'; continue; }
    const { picks, dropped } = framePicks(n, [span], step);
    const single = span[0] === span[1] && step === 1;
    const show = shown(picks);
    item.innerHTML = show.map((f) => `<img alt="frame ${f}" title="frame ${f}${single ? " · click to pick another" : ""}" data-frame="${f}"${single ? ' class="pick"' : ""}>`).join("")
      + `<span class="rm-n">${single ? `frame ${picks[0]}` : `${picks.length} frames`}${dropped.length ? ` · ${dropped.length} past the end` : ""}</span>`;
    if (dropped.length) item.classList.add("past");
    for (const img of item.querySelectorAll("img")) {
      grab(url, Number(img.dataset.frame), height).then((src) => { img.src = src; }).catch(() => {});
    }
  }
}

// --- picking a frame by eye -------------------------------------------------------------------------

// The REMEMBER: line `text` with its `item`-th frame set to `frame`: `frame 50` → `frame 20`, the second of
// `frames 10, 50` → `frames 10, 20`, `first frame` / `frame at 1s` → `frame N`. null when that item is
// a range or an `every …` (picked by eye only one frame at a time).
export function setFrame(text, item, frame) {
  const m = /^(\s*(?:REMEMBER|SEND):\s*)(.*?)(\s+(?:as|to)\s+.*)$/i.exec(text);
  if (!m) return null;
  const [, head, what, rest] = m;
  if (/^every\b/i.test(what.trim())) return null;
  if (/^(first|last)\s+frame$/i.test(what.trim())) return item === 0 ? `${head}frame ${frame}${rest}` : null;
  const list = /^(frames?\s+(?:at\s+)?)(.+)$/i.exec(what.trim());
  if (!list) return null;
  const items = list[2].split(",").map((s) => s.trim());
  if (item >= items.length || /^-?\d+(?:\.\d+)?s?\s*-\s*-?\d/.test(items[item])) return null;
  if (items.length === 1) return `${head}frame ${frame}${rest}`;
  items[item] = String(frame);
  return `${head}frames ${items.join(", ")}${rest}`;
}

// The picker: the clip at the frame clicked, a slider over its frames, and "Use frame N" rewriting the line.
export async function openPicker(app, { line, item, url, frame }, done) {
  const index = rememberLines(app.text)[line];
  if (index === undefined) return;
  let count;
  try { count = await frameCount(url); } catch { return app.toast("The clip is not there any more."); }
  const sheet = app.openSheet(`<div class="panel rm-picker"><div class="row spread"><h4>Pick a frame</h4>`
    + `<button class="icon-btn" data-close title="Close">×</button></div>`
    + `<video muted playsinline preload="auto" src="${esc(url)}"></video>`
    + `<input type="range" min="0" max="${count - 1}" value="${frame}" aria-label="Frame">`
    + `<div class="row spread"><span class="muted rm-at"></span><span class="row">`
    + `<button type="button" class="btn ghost" data-close>Cancel</button><button type="button" class="btn primary" data-use>Use frame ${frame}</button></span></div></div>`);
  const v = sheet.querySelector("video"), range = sheet.querySelector("input"), use = sheet.querySelector("[data-use]");
  const at = sheet.querySelector(".rm-at");
  const show = () => {
    const n = Number(range.value);
    v.currentTime = Math.min((n + 0.5) / FPS, Math.max(0, (v.duration || 0) - 0.001));
    at.textContent = `frame ${n} of ${count} · ${(n / FPS).toFixed(2)} s`;
    use.textContent = `Use frame ${n}`;
  };
  v.addEventListener("loadedmetadata", show, { once: true });
  range.addEventListener("input", show);
  sheet.querySelectorAll("[data-close]").forEach((b) => { b.onclick = () => app.closeSheet(); });
  use.onclick = () => {
    const lines = app.text.split("\n"), next = setFrame(lines[index], item, Number(range.value));
    app.closeSheet();
    if (next === null) return app.toast("Picking by eye sets one frame: this one is a range.");
    lines[index] = next;
    app.text = lines.join("\n");
    app.cellsSig = null;
    done();
  };
}
