// Takes at the line (#173): a 🎲 at the end of a slot's line, of a library still to be written and of a `> enhance`
// line opens a sheet with takes for that place (three, or as many as the settings say, #274), written at the node's
// seed. It asks nothing by itself (#436): Generate takes asks, and again for as many more, new against those there
// are; a steering line goes with them. A click beside the sheet leaves it open (#438). A click selects a
// take (#276), and Use selected puts it in place of the slot as an unsaved edit; Keep the direction writes the steer
// into the slot's (the line's) directions; both with Undo. A `> enhance` take is kept for its roll instead: the run
// that rolls the same prompt uses it. A library's sheet selects several: one still to be written is written in it and
// kept as the library (#272), one that exists offers its rolls and new entries to add (#273); its directions stay
// with the library, never in the template (#275). With an API endpoint the server asks it directly, outside
// ComfyUI's queue. A gallery picture's slot from `image output` (#175) opens the same sheet: its takes are written
// from the picture, Use selected writes one into its exports. The Write menu's writers open it too (#334): each take a
// scene, a shot or a prompt, written with the whole template behind it, which Use selected puts in the editor.
import { esc, highlight, LIBRARY } from "./highlight.js";
import { icon } from "./icons.js";
import { llmLocal } from "./miniruns.js";
import { atCaret, caretOffset } from "./cells.js";
import { sceneTitles, splitCells } from "./model.js";

const LIB = (name) => new RegExp(`__${name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(?:\\[[^\\]\\n]*\\])?(?:#[\\w-]+:\\$?[\\w.-]+)*(?::\\d+)?__(?:\\(([^()]*)\\))?`);
const SAID = { slot: "the slot", library: "the library still to be written", entries: "the library", enhance: "what the line rewrites",
  picture: "the picture's slot", continue: "the reel's next scene", story: "the shot between the frames", describe: "a prompt from a picture" };

// The Write menu's writers (#334): what each writes, and where its take goes.
export const WRITERS = {
  continue: { label: "Continue the reel", hint: "The next scene, after the scene you pick, as the reel plays at this seed" },
  story: { label: "Story interpolator", hint: "What happens between a start and an end: a frame, a scene or the prompt" },
  describe: { label: "Prompt from image", hint: "A prompt for the picture in first_frame" },
};

// After a library was written from a sheet: the editor knows it now, its 🎲 goes, its rolls show.
async function librariesChanged(app) {
  try { app.data.libraries = (await app.api.libraries()).libraries; } catch { /* the next run reads them */ }
  app.data.libFull = {};
  app.dialLibs = {};
  await app.refreshCompletion().catch(() => {});
  app.data.annotations = null;  // the line's annotation rolls it now: ask again for the same template and seed
  app.state.annotateKey = null;
  app.cellsSig = null;
  if (app.state.tab === "prompt" || app.state.tab === "libraries") app.render();  // the tab's Generate (#323): its new entries
}

// The template's line `place.line` changed by `edit(line)`; the text as it was when the line is not there.
function onLine(text, place, edit) {
  const lines = text.split("\n");
  if (place.line < 0 || place.line >= lines.length) return text;
  const next = edit(lines[place.line]);
  if (next === null || next === lines[place.line]) return text;
  lines[place.line] = next;
  return lines.join("\n");
}

// A take in place of the slot, or of the library (its directions go with it); `> enhance` has nothing to put in.
export function insertTake(text, place, take) {
  if (place.kind === "slot") return onLine(text, place, (l) => (l.includes(`--${place.what}--`) ? l.replace(`--${place.what}--`, take) : null));
  if (place.kind === "library" || place.kind === "entries") return onLine(text, place, (l) => (LIB(place.what).test(l) ? l.replace(LIB(place.what), take) : null));
  return text;
}

// The steer into the place's directions: a slot's (`--a, steer--`), the instruction of a `>` line. A library keeps
// its own, never `(…)` in the template (#275).
export function keepDirection(text, place, steer) {
  const s = steer.trim();
  if (!s) return text;
  if (place.kind === "slot") return onLine(text, place, (l) => (l.includes(`--${place.what}--`) ? l.replace(`--${place.what}--`, `--${place.what}, ${s}--`) : null));
  if (place.kind === "enhance") return onLine(text, place, (l) => (/^\s*>/.test(l) ? `${l.replace(/\s+$/, "")}, ${s}` : null));
  return text;
}

// The place a 🎲 stands for, its line counted in the whole template (a cell's key counts in its cell).
export function placeOf(app, key) {
  const local = Number(key.dataset.line) || 0, cell = key.closest(".cell");
  const start = cell ? splitCells(app.text)[Number(cell.dataset.cell)]?.line ?? 0 : 0;
  return { kind: key.dataset.llm, what: key.dataset.what || "", directions: key.dataset.dirs || "", line: start + local };
}

// The `n`-th library of a line, as the server counts them for its rolls (#202).
export function nthLibrary(line, n) {
  return [...line.matchAll(LIBRARY)][n]?.[1] ?? null;
}

const SLOT = /--(?=[^\s-])([^\n]*?[^\s-])--/g;
const inHome = (app, name) => (app.data.completion?.libraries || []).some((l) => l.name === name);  // not a template's @lib

// The library a roll at a line's end stands for (#273): the k-th `__…__` of its line.
export function placeOfRoll(app, el) {
  const local = Number(el.dataset.line) || 0, cell = el.closest(".cell");
  const start = cell ? splitCells(app.text)[Number(cell.dataset.cell)]?.line ?? 0 : 0;
  const name = nthLibrary(app.text.split("\n")[start + local] || "", Number(el.dataset.lroll));
  return name && inHome(app, name) ? { kind: "entries", what: name, roll: el.textContent, directions: "", line: start + local } : null;
}

// What a Ctrl+click in the editor landed on: a library, its takes (#273) or, still to be written, its sheet (#272);
// else a slot, its takes (#280; one from `image output` is the Gallery's).
export function placeAt(app, ta) {
  const at = ta.selectionStart, cell = ta.closest(".cell");
  const under = (rx) => [...ta.value.matchAll(rx)].find((x) => x.index <= at && at <= x.index + x[0].length);
  const m = under(LIBRARY), s = !m && under(SLOT);
  if (!m && !s) return null;
  const start = cell ? splitCells(app.text)[Number(cell.dataset.cell)]?.line ?? 0 : 0;
  const line = start + ta.value.slice(0, (m || s).index).split("\n").length - 1;
  if (s) return /\bimage\s+output\b/.test(s[1]) ? null : { kind: "slot", what: s[1], directions: "", line };
  if (app.known().has(m[1]) && !inHome(app, m[1])) return null;
  return { kind: app.known().has(m[1]) ? "entries" : "library", what: m[1], roll: "", directions: m[2] || "", line };
}

// The top-level nodes of line `i` in a highlighted <pre>: between its i-th newline and the next.
function lineNodes(pre, i) {
  const out = [];
  let at = 0;
  for (const n of pre.childNodes) {
    if (n.nodeType === Node.TEXT_NODE) at += (n.textContent.match(/\n/g) || []).length;
    else if (at === i) out.push(n);
    if (at > i) break;
  }
  return out;
}

// While the pointer is on a 🎲, the place it stands for is outlined in its line (#280): two slots on one line, two
// dice at its end, each showing its own.
export function markPlace(key, on) {
  const pre = key.closest("pre");
  if (!pre) return;
  pre.querySelectorAll(".t-hl").forEach((el) => el.classList.remove("t-hl"));
  if (!on) return;
  const { llm: kind, what } = key.dataset;
  const sel = kind === "slot" ? ".t-slot" : kind === "enhance" ? ".t-enh" : ".t-lib";
  const lib = new RegExp(`^__${what.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(?![\\w/])`);
  const fits = (el) => (kind === "slot" ? el.textContent === `--${what}--` : kind === "enhance" || lib.test(el.textContent));
  lineNodes(pre, Number(key.dataset.line)).flatMap((el) => [...(el.matches(sel) ? [el] : []), ...el.querySelectorAll(sel)])
    .filter(fits).forEach((el) => el.classList.add("t-hl"));
}

// Several takes as a choice (#336): `{a|b|c}`, every Roll picking one; what the language would read as its own
// (`{ } | $ __ \\`) written as itself.
export const asChoice = (takes) => `{${takes.map((t) => t.replace(/[\\{}|$]/g, (c) => `\\${c}`).replace(/__/g, "\\__")).join("|")}}`;

// Send along (#335): what goes to the model beside the request. The prompt as it rolls (always, where the take is
// written into it: a slot, a rewrite, the reel's next scene), the frames wired into first_frame and last_frame, four
// stills of the video input, and any item of the Gallery (a video as four of its stills).
export const SOURCES = [["prompt", "the prompt"], ["first_frame", "first_frame"], ["last_frame", "last_frame"], ["video", "video"]];
const FRAMES = ["first_frame", "last_frame", "video"];
export const promptLocked = (kind) => ["slot", "enhance", "continue"].includes(kind);

// What a sheet sends along when it opens: the prompt (not from the Libraries tab, #323); the story both frames; a
// prompt from an image the first frame wired (else the last), and the prompt only when no frame is.
export function defaultSends(kind, wired, tab = false) {
  const out = new Set(), frames = ["first_frame", "last_frame"].filter(wired);
  if (kind === "describe") out.add(frames[0] || "prompt");
  else if (!tab || promptLocked(kind)) out.add("prompt");
  if (kind === "story") frames.forEach((f) => out.add(f));
  return out;
}

// Where Replace and Insert put a writer's takes (#333, #342, #343), in words, as its sheet's choices stand; null where
// the writer has no such place (Prepend and Append work everywhere). `after`: the scene Continue continues after (null:
// the end); `from`/`to`: the story's start and end (a scene's index, first_frame, last_frame or the prompt). `scenes`:
// the template's scene titles; `h3`: a screenplay; `count`: how many scenes the story writes.
export function writerPlaces(kind, { scenes = [], h3 = true, after = null, from = "first_frame", to = "last_frame", count = 1 } = {}) {
  const name = (i) => `SCENE ${i + 1}${scenes[i] ? ` (${scenes[i]})` : ""}`;
  const span = (a, b) => (b - a === 1 ? name(a) : `${name(a)} to ${name(b - 1)}`);
  if (kind === "describe") {
    if (!h3) return { replace: "in place of the prompt, its comments and `: …` lines kept", insert: null };
    if (scenes.length) return { replace: null, insert: "under the line your cursor was on" };
  }
  if (!h3) return { replace: "in place of the prompt, on a grid: one Roll renders every keyframe (as a choice: one a Roll)", insert: null };
  if (!scenes.length) {  // a screenplay without scenes becomes a reel, its shots one scene; frame to frame in one, the fl2va shot
    if (kind === "continue" || from === "prompt") return { replace: null, insert: "after the screenplay, which becomes the first scene" };
    if (to === "prompt") return { replace: null, insert: "before the screenplay, which becomes the scene they lead into" };
    if (from === "first_frame" && to === "last_frame" && count === 1) return { replace: "in place of the shots below the header", insert: "above the shots, which stay" };
    return { replace: "in place of the shots below the header", insert: "before the shots, which become the scene after them" };
  }
  // from the prompt: after all of it; to the prompt: into its first scene, nothing in between
  const a = kind === "continue" ? (after ?? scenes.length - 1) : typeof from === "number" ? from : from === "prompt" ? scenes.length - 1 : -1;
  const b = kind === "continue" ? scenes.length : typeof to === "number" ? to : to === "prompt" ? a + 1 : scenes.length;
  const where = a < 0 ? "before the first scene" : `after ${name(a)}`;
  if (b <= a + 1) return { replace: null, insert: where };
  return { replace: `${where}, in place of ${span(a + 1, b)}`, insert: `${where}, ${span(a + 1, b)} ${b - a > 2 ? "stay" : "stays"} after them` };
}

// The row of a writer's choices in its sheet (#342, #343): what the next takes are written for; none for a writer
// without any.
function writerRow(kind, scenes, h3, wo) {
  const opt = (v, label, on) => `<option value="${v}"${on ? " selected" : ""}>${esc(label)}</option>`;
  const scene = (on) => scenes.map((t, i) => opt(i, `SCENE ${i + 1}${t ? ` · ${t}` : ""}`, on === i)).join("");
  const num = (k, min, max, label) => `<input type="number" class="input num" data-wo="${k}" min="${min}" max="${max}" value="${wo[k]}" aria-label="${label}">`;
  const length = `<span class="label">in</span>${num("scenes", 1, 99, h3 ? "How many scenes" : "How many keyframes")}<span class="label">${h3 ? "scenes" : "keyframes"}</span>`
    + (h3 ? `<span class="label">of</span>${num("seconds", 1, 60, "Seconds a scene")}<span class="label">s</span>` : "");
  if (kind === "continue") {  // the scene it continues after, on a reel; how many new scenes and how long (#342)
    return `<div class="row wrap take-opts">${scenes.length ? `<span class="label">After</span><select class="input" data-wo="after" aria-label="The scene it continues after">`
      + `${opt("", "the end", true)}${scene(null)}</select>` : ""}${length}</div>`;
  }
  if (kind !== "story") return "";
  const ends = h3 ? [[opt("first_frame", "first_frame", true), opt("prompt", "the prompt", false), scene(null)],
    [opt("last_frame", "last_frame", true), opt("prompt", "the prompt", false), scene(null)]]
    : [[opt("first_frame", "first_frame", true), opt("prompt", "the prompt", false)], [opt("prompt", "the prompt", true), opt("last_frame", "last_frame", false)]];
  return `<div class="row wrap take-opts"><span class="label">From</span><select class="input" data-wo="from" aria-label="Where the story starts">${ends[0].join("")}</select>`
    + `<span class="label">to</span><select class="input" data-wo="to" aria-label="Where the story ends">${ends[1].join("")}</select>`
    + `${length}</div>`;
}

export function openTakes(app, place, near = null) {
  const s = { takes: [], pick: null, picked: new Set(), keep: null, busy: false, error: "", note: "", asked: 0 };
  const picture = place.kind === "picture", enhance = place.kind === "enhance";
  const known = place.kind === "entries";  // a library that exists: its rolls and new entries (#273)
  const tab = !!place.tab;  // from the Libraries tab (#323): new entries only, and no line to put one on
  const writer = !!WRITERS[place.kind];  // the Write menu's (#334): a take is a text with its whole template
  const meta = [];  // writer: what is wrong with each take
  const wired = (name) => !!app.bridge.wired?.(name);
  const sends = defaultSends(place.kind, wired, tab), gallery = [];  // gallery: {id, kind} of the items sent along
  const sent = () => (picture ? null : [...sends, ...gallery.map((g) => `gallery:${g.id}`)]);
  const h3 = /^@h3\b/i.test((app.text.split("\n").find((l) => l.trim() && !l.trim().startsWith("#")) || "").trim());
  // several at once: a library's entries (#272), the one-line takes that can go in as a choice (#336), and a writer's,
  // which go in one after the other or as one choice, as many as you like (#333)
  const choice = place.kind === "slot" || ((place.kind === "library" || known) && !tab);
  const multi = place.kind === "library" || known || choice || writer;
  const from = [];  // known: where each take came from, "rolled", "new" or "added"
  const token = writer ? WRITERS[place.kind].label : place.kind === "slot" || picture ? `--${place.what}--` : enhance ? `> ${place.what}` : `__${place.what}__`;
  const useTitle = picture ? "Write the selected take into the picture's exports"
    : enhance ? "Keep the selected rewrite for this roll: a run that rolls this prompt uses it instead of asking the model"
      : `Put the selected take in place of ${esc(token)}: an unsaved edit`;
  // the writer's choices (#342, #343): the scene Continue continues after (null: the end); the story's start and end,
  // how many scenes (keyframes on an image prompt) and how long each; whether several takes go in as one choice
  const scenes = writer ? sceneTitles(app.text) : [];
  const wo = { after: null, from: "first_frame", to: h3 ? "last_frame" : "prompt", scenes: 1, choice: false,
    seconds: Math.round(Number(/^\s*SHOT\s+(\d+(?:\.\d+)?)\s*s\b/im.exec(app.text)?.[1]) || 5) };
  const reelShot = place.kind === "describe" && scenes.length > 0;  // its take goes in at the caret
  const hint = place.kind === "continue" && !scenes.length ? "The next scene, after the screenplay as it rolls at this seed" : WRITERS[place.kind]?.hint || "";
  const intro = writer ? `At seed ${esc(String(app.bridge.getSeed()))}: ${esc(hint.toLowerCase())}. `
    + "Select as many as you like: Prepend or Append copies them into the prompt, Replace and Insert put them where the writer has a place."
    : tab ? ": new entries the language model writes, none it has. Steer them, ask for more, select the good ones: Add to the library writes them in."
    : `, ${picture ? "written from the picture, the prompt that made it beside it." : `at seed ${esc(String(app.bridge.getSeed()))}.`}`
      + (enhance ? " A rewrite happens at every run: Use selected keeps the one you pick for this roll, and the run uses it." : "")
      + (known ? " Its rolls (the one at this seed first) and new entries the language model writes, none it has. Select the new ones worth keeping: Add to the library writes them in."
        : multi ? " As many entries as a new library starts with, written as a run would. Select the ones worth keeping: Keep as the library writes them as the library, straight in." : " Click a take to select it.");
  const sheet = app.openSheet(`<div class="panel takes-panel"><div class="row spread"><h4>${writer ? `${icon("spark")} ${esc(token)}` : `${icon("dice")} Takes`}</h4>`
    + `<button class="icon-btn" data-close title="Close">${icon("x")}</button></div>`
    + `<p class="muted flush">${writer ? intro : `For ${SAID[place.kind]} <code>${esc(token)}</code>${intro}`}</p>`
    + writerRow(place.kind, scenes, h3, wo)
    + (picture ? "" : '<div class="row wrap take-send" aria-label="Send along"></div><div class="take-gal" hidden></div>')
    + (multi ? `<div class="row take-sel"><button class="btn ghost slim" data-tall>All</button><button class="btn ghost slim" data-tnone>None</button><span class="muted" data-tcount></span></div>` : "")
    + `<ol class="take-list${multi ? " multi" : ""}${writer ? " long" : ""}" role="listbox" aria-label="Takes"${multi ? ' aria-multiselectable="true"' : ""}></ol><p class="muted flush take-state" role="status"></p>`
    + `<div class="row take-steer"><input class="input grow" data-steer placeholder="Steer them: darker, older, as an anime character …" aria-label="Steer the takes">`
    + `<button class="btn" data-tgen title="Ask the language model for takes, new against those there are">${icon("dice")}Generate takes</button>`
    + (picture || writer ? "" : `<button class="btn ghost" data-tkeep title="Write the steer into ${esc(SAID[place.kind])}'s directions, so it keeps rolling that way">${icon("pin")}Keep the direction</button>`) + "</div>"
    + (writer ? '<div class="row wrap take-how"><span class="row take-mode" role="group" aria-label="How several takes go in">'
      + '<button type="button" class="chip" data-tas="written" aria-pressed="true" title="One after the other, in the order you selected them">as written</button>'
      + '<button type="button" class="chip" data-tas="choice" aria-pressed="false" title="As one choice, so every Roll picks one of them: {a|b} for one-line takes, a $take binding and IF lines for longer ones">as a choice</button></span>'
      + '<span class="muted take-goes" data-tgoes></span></div><div class="row wrap take-use"><span class="grow"></span>'
      + `<button class="btn ghost" data-tput="prepend" title="At the start of the prompt (a screenplay's: under its head). An unsaved edit">${icon("jump")}Prepend to prompt</button>`
      + `<button class="btn ghost" data-tput="append" title="At the end of the prompt. An unsaved edit">${icon("land")}Append to prompt</button>`
      + `<button class="btn" data-tput="replace">${icon("check")}Replace</button><button class="btn primary" data-tput="insert">${icon("plus")}Insert</button></div></div>`
      : '<div class="row take-use"><span class="grow"></span>')
    + (choice ? `<button class="btn ghost" data-tchoice title="Put the selected takes in as a choice, {a|b|c}: every Roll picks one, so you see which works best">${icon("dice")}Insert as a choice</button>` : "")
    + `${tab || writer ? "" : `<button class="btn${place.kind === "library" || known ? " ghost" : " primary"}" data-tuse title="${useTitle}">${icon("check")}Use selected</button>`}`
    + (known ? `<button class="btn primary" data-tlib title="Write the selected new entries into __${esc(place.what)}__, straight in">${icon("save")}Add to the library</button>`
      : place.kind === "library" ? `<button class="btn primary" data-tlib title="Write the selected entries as __${esc(place.what)}__, straight into your libraries">${icon("save")}Keep as the library</button>` : "")
    + (writer ? "" : "</div></div>"), near, { stay: true });
  const list = sheet.querySelector(".take-list"), state = sheet.querySelector(".take-state"), steer = sheet.querySelector("[data-steer]");
  const sendRow = sheet.querySelector(".take-send"), galPick = sheet.querySelector(".take-gal");
  const drawSends = () => {
    if (!sendRow) return;
    sendRow.innerHTML = '<span class="label">Send along</span>' + SOURCES.map(([k, label]) => {
      const fixed = k === "prompt" && promptLocked(place.kind), can = k === "prompt" || wired(k);
      const title = fixed ? "Always sent: what it writes is part of it" : !can ? `Nothing is wired into the Orrery Prompt's ${k}`
        : k === "prompt" ? "The prompt as it rolls at this seed" : k === "video" ? "Four stills of the video wired into the Orrery Prompt"
          : `The picture wired into the Orrery Prompt's ${k}`;
      return `<button type="button" class="chip" data-tsend="${k}" aria-pressed="${sends.has(k)}" ${fixed || !can ? "disabled" : ""} title="${esc(title)}">${esc(label)}</button>`;
    }).join("") + gallery.map((g) => `<span class="chip gal" aria-pressed="true" title="From the Gallery${g.kind === "video" ? ": four stills of it" : ""}">`
      + `<img alt="" src="${esc(app.api.thumbURL(g.id))}"><button type="button" class="mini" data-tungal="${esc(g.id)}" aria-label="Leave it out">${icon("x")}</button></span>`).join("")
      + `<button type="button" class="btn ghost slim" data-tgal aria-expanded="${!galPick.hidden}" title="Send any picture or video of the Gallery along">${icon("image")}Gallery</button>`
      + '<span class="muted">the next takes get them</span>';
  };
  const drawGallery = async () => {  // the newest outputs, a click sends one along (or takes it back)
    if (!galPick.dataset.loaded) {
      galPick.innerHTML = '<span class="muted">Loading the Gallery…</span>';
      try {
        const got = await app.api.galaxyView({ view: "all", flat: 1, limit: 60 });
        galPick.dataset.loaded = "1";
        galPick.items = (got.rows || []).filter((r) => r.kind === "image" || r.kind === "video");
      } catch (err) { galPick.innerHTML = `<span class="warn">${esc(err.message)}</span>`; return; }
    }
    galPick.innerHTML = (galPick.items || []).map((r) => `<button type="button" class="gpick" data-tgpick="${esc(r.id)}" data-kind="${r.kind}" `
      + `aria-pressed="${gallery.some((g) => g.id === r.id)}" title="${esc(r.text || "")}"><img loading="lazy" alt="" src="${esc(app.api.thumbURL(r.id))}">`
      + `${r.kind === "video" ? `<span class="v">${icon("play")}</span>` : ""}</button>`).join("") || '<span class="muted">The Gallery is empty.</span>';
  };
  sendRow?.addEventListener("click", (e) => {
    const t = e.target.closest("[data-tsend]"), un = e.target.closest("[data-tungal]");
    if (t && !t.disabled) sends[sends.has(t.dataset.tsend) ? "delete" : "add"](t.dataset.tsend);
    else if (un) gallery.splice(gallery.findIndex((g) => g.id === un.dataset.tungal), 1);
    else if (e.target.closest("[data-tgal]")) { galPick.hidden = !galPick.hidden; if (!galPick.hidden) drawGallery(); }
    else return;
    drawSends();
    if (!galPick.hidden) drawGallery();
  });
  galPick?.addEventListener("click", (e) => {
    const g = e.target.closest("[data-tgpick]");
    if (!g) return;
    const at = gallery.findIndex((x) => x.id === g.dataset.tgpick);
    if (at >= 0) gallery.splice(at, 1);
    else gallery.push({ id: g.dataset.tgpick, kind: g.dataset.kind });
    drawSends();
    drawGallery();
  });
  // the writer's choices (#342, #343): the next takes are written for them; a story's start and end set the frames sent
  const optRow = sheet.querySelector(".take-opts");
  const framesFor = () => {
    if (place.kind !== "story") return;
    for (const k of ["first_frame", "last_frame"]) sends[(wo.from === k || wo.to === k) && wired(k) ? "add" : "delete"](k);
  };
  const drawGoes = () => {  // what Replace and Insert do, as the choices stand; the one the writer has no place for hidden
    const places = writerPlaces(place.kind, { ...wo, count: wo.scenes, scenes, h3 }), g = sheet.querySelector("[data-tgoes]");
    if (!g) return;
    g.textContent = [["Replace", places.replace], ["Insert", places.insert]].filter(([, w]) => w).map(([k, w]) => `${k}: ${w}.`).join(" ");
    for (const k of ["replace", "insert"]) {
      const b = sheet.querySelector(`[data-tput="${k}"]`);
      b.hidden = !places[k];
      b.title = places[k] ? `${places[k][0].toUpperCase()}${places[k].slice(1)}. An unsaved edit` : "";
    }
  };
  optRow?.addEventListener("change", (e) => {
    const k = e.target.dataset.wo, v = e.target.value;
    if (!k) return;
    if (e.target.type === "number") wo[k] = Math.max(Number(e.target.min), Math.min(Number(e.target.max), Math.round(Number(v)) || 1));
    else wo[k] = v === "" ? null : /^\d+$/.test(v) ? Number(v) : v;
    if (k === "from" || k === "to") { framesFor(); drawSends(); }
    drawGoes();
  });
  sheet.querySelector(".take-mode")?.addEventListener("click", (e) => {
    const m = e.target.closest("[data-tas]");
    if (!m) return;
    wo.choice = m.dataset.tas === "choice";
    sheet.querySelectorAll("[data-tas]").forEach((b) => b.setAttribute("aria-pressed", String(b === m)));
  });
  const writerOptions = () => (place.kind === "continue" ? { after: wo.after, scenes: wo.scenes, seconds: wo.seconds }
    : place.kind === "story" ? { from: wo.from, to: wo.to, scenes: wo.scenes, seconds: wo.seconds } : {});
  // the selected takes, in the order selected, where the button says (#333): the server places them, no model asked
  const put = async (how) => {
    const order = [...s.picked].filter((i) => i < s.takes.length);
    if (!order.length) return;
    try {
      const got = await app.api.writePlace({ task: place.kind, template: app.text, takes: order.map((i) => s.takes[i]),
        how: how === "insert" && reelShot ? "caret" : how, choice: wo.choice, options: writerOptions() });
      const next = got.template ?? atCaret(app.text, caretOffset(app), got.text);
      app.closeSheet();
      changed(next, `${order.length === 1 ? "The take is" : `${order.length} takes are`} in the editor${wo.choice && order.length > 1 ? " as a choice" : ""}`
        + `${order.some((i) => meta[i]?.problem) ? ", with a problem" : ""} · an unsaved edit`);
    } catch (err) { s.error = err.message; draw(); }
  };
  sheet.querySelectorAll("[data-tput]").forEach((b) => { b.onclick = () => put(b.dataset.tput); });
  framesFor();
  drawGoes();
  const use = sheet.querySelector("[data-tuse]"), lib = sheet.querySelector("[data-tlib]"), pick = sheet.querySelector("[data-tchoice]");
  const picks = () => [...s.picked].sort((a, b) => a - b);
  const oneLine = () => picks().every((i) => !s.takes[i].includes("\n"));
  const on = (i) => (multi ? s.picked.has(i) : s.pick === i);
  const chosen = () => (multi ? (s.picked.size === 1 ? [...s.picked][0] : null) : s.pick);
  const draw = () => {
    const tag = (i) => (known ? `<small class="tk ${from[i]}">${from[i] === "new" ? "new" : from[i] === "added" ? "added" : "rolled"}</small>` : "");
    const shown = (t, i) => (writer ? `<pre class="codebox">${highlight(t, app.known(), {})}</pre>${meta[i]?.problem ? `<p class="warn flush">${esc(meta[i].problem)}</p>` : ""}` : esc(t));
    list.innerHTML = s.takes.map((t, i) => `<li class="${on(i) ? "on" : ""}" data-tpick="${i}" tabindex="0" role="option" aria-selected="${on(i)}">${shown(t, i)}${tag(i)}`
      + `<button type="button" class="icon-btn tdel" data-tdel="${i}" title="Take it out of the list" aria-label="Take it out of the list">${icon("x")}</button></li>`).join("");
    state.textContent = s.busy ? "Writing…" : s.error || s.note;
    state.classList.toggle("warn", !!s.error && !s.busy);
    sheet.querySelector("[data-tgen]").disabled = s.busy;
    if (use) use.disabled = s.busy || chosen() === null || (enhance && !s.keep);
    sheet.querySelectorAll("[data-tput]").forEach((b) => { b.disabled = s.busy || !s.picked.size; });
    if (pick) {
      pick.disabled = s.busy || s.picked.size < 2 || !oneLine();
      pick.title = s.picked.size > 1 && !oneLine() ? "A take of several lines goes in alone: a choice holds one line each"
        : "Put the selected takes in as a choice, {a|b|c}: every Roll picks one, so you see which works best";
    }
    if (lib) lib.disabled = s.busy || !(known ? [...s.picked].some((i) => from[i] === "new") : s.picked.size);
    if (multi) sheet.querySelector("[data-tcount]").textContent = `${s.picked.size} of ${s.takes.length} selected`;
    if (enhance && !s.keep && s.takes.length) use.title = "This > rewrites several passages of the screenplay, each on its own at the run: there is no one rewrite to keep";
  };
  const add = (got) => {  // what a request answered: the rolls of a library first, then the model's takes
    for (const [list, kind] of [[got.rolled || [], "rolled"], [got.takes || [], "new"]]) {
      for (const t of list.filter((x) => !s.takes.includes(x))) { s.takes.push(t); from.push(kind); }
    }
    if (known && !place.directions) place.directions = got.directions || "";
    if (enhance && got.keep !== undefined) s.keep = got.keep || null;
  };
  const ask = async () => {
    s.busy = true;
    s.error = s.note = "";
    draw();
    try {
      if (picture) {
        const got = await app.api.galaxyTakes({ id: place.id, what: place.what, steer: steer.value, have: s.takes });
        s.takes.push(...got.takes.filter((t) => !s.takes.includes(t)));
        return;
      }
      if (writer) return await writeTakes();
      const take = { kind: place.kind, what: place.what, directions: place.directions, steer: steer.value,
        roll: s.takes.length ? "" : place.roll || "", ...(tab ? { rolls: false } : {}), sends: sent() };
      // the files of the Load Image and Load Video nodes behind what is sent along, or a slot names (#174, #335); one
      // that is no file (a decode, a resize) only a run of its own can see
      const need = sent().filter((k) => FRAMES.includes(k)), named = /\bimage\s+(first|last)_frame\b/.test(place.what);
      const files = need.length || named ? (await app.bridge.frameFiles?.()) || { names: {}, others: [] } : { names: {}, others: [] };
      const viaRun = (files.others || []).some((n) => need.includes(n) || (named && n !== "video"));
      if ((!app.llmApi() && llmLocal(app)) || viaRun) {  // a text encoder: in runs of their own at the queue's front (#178)
        const one = place.kind === "slot" || enhance;  // one take a run, each sampled anew; a library's in one run
        const runs = one ? Number(app.data.llm?.takes?.[enhance ? "enhance" : "slot"]) || 3 : 1;
        for (let i = 0; i < runs; i++) {
          const got = await app.bridge.ask("takes", "", JSON.stringify({ ...take, have: s.takes, asked: s.asked++, ...(one ? { n: 1 } : {}) }), { front: true });
          if (got.error) throw new Error(got.error);
          add(got);
          draw();
        }
        return;
      }
      add(await app.api.takes({ ...take, template: app.text, target: app.bridge.getTarget(), params: app.bridge.getParams(),
        seed: app.bridge.getSeed(), segment: app.bridge.getSegment?.() ?? 0, chain: app.bridge.chain?.() || "",
        have: s.takes, frames: files.names }));  // as many as the settings say (#274)
    } catch (err) { s.error = err.message; } finally {
      s.busy = false;
      draw();
    }
  };
  // A writer's takes (#334): each a run of its own with a text encoder (it writes once a run), at seed + its number;
  // over the API all at once, when the frames are files ComfyUI holds.
  const writeTakes = async () => {
    const n = Number(app.data.llm?.takes?.[place.kind]) || 3, ideas = Array.from({ length: n }, () => s.asked++);  // each writer its own
    const options = writerOptions();
    const need = sent().filter((k) => FRAMES.includes(k));
    const files = app.llmApi() ? (need.length ? (await app.bridge.frameFiles?.()) || null : { names: {}, others: [] }) : null;
    const api = !!files && !(files.others || []).some((k) => need.includes(k));  // a sent input that is no file: a run
    const one = (idea) => (api
      ? app.api.writeIdea({ task: place.kind, idea, template: app.text, seed: Number(app.bridge.getSeed()) || 0,
        params: app.bridge.getParams(), frames: files.names, steer: steer.value, sends: sent(), options })
      : app.bridge.write(place.kind, idea, app.text, steer.value, sent(), options));
    const errors = [];
    const took = (got) => {
      if (got.error) errors.push(got.error);
      else if (got.text && !s.takes.includes(got.text)) {
        s.takes.push(got.text);
        meta.push({ problem: got.problem });
      }
      draw();
    };
    if (api) (await Promise.all(ideas.map((i) => one(i).catch((err) => ({ error: err.message }))))).forEach(took);
    else for (const i of ideas) took(await one(i).catch((err) => ({ error: err.message })));
    if (errors.length) s.error = [...new Set(errors)].join(" ");
  };
  const changed = (text, said) => {
    const before = app.text;
    if (text === before) return app.toast(`${esc(token)} is not on its line any more: the editor changed since.`);
    app.text = text;
    app.cellsSig = null;
    if (app.state.tab === "prompt") app.render();
    app.toast(said, { label: "Undo", run: () => { app.text = before; app.cellsSig = null; if (app.state.tab === "prompt") app.render(); } });
  };
  sheet.querySelector("[data-close]").onclick = () => app.closeSheet();
  sheet.querySelector("[data-tgen]").onclick = () => ask();
  steer.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ask(); } });
  if (!picture && !writer) sheet.querySelector("[data-tkeep]").onclick = () => {  // a writer's sheet has no Keep the direction
    if (!steer.value.trim()) return steer.focus();
    if (multi) {  // a library keeps its directions itself, not (…) in the template (#272, #275)
      place.directions = place.directions ? `${place.directions}, ${steer.value.trim()}` : steer.value.trim();
      steer.value = "";
      if (!known) {
        s.note = `Kept: __${place.what}__ gets the directions “${place.directions}” when you keep it, and Generate takes asks with them.`;
        return draw();
      }
      return app.api.addToLibrary({ name: place.what, entries: [], directions: place.directions })
        .then(() => { s.note = `__${place.what}__ keeps the directions “${place.directions}”: its top-ups and Generate takes ask with them.`; draw(); })
        .catch((err) => { s.error = err.message; draw(); });
    }
    const text = keepDirection(app.text, place, steer.value), moved = text !== app.text;
    changed(text, `Your steer is in ${esc(SAID[place.kind])}'s directions · an unsaved edit`);
    if (!moved) return;
    if (place.kind === "slot" || enhance) place.what = `${place.what}, ${steer.value.trim()}`;  // the next takes ask with it
    else place.directions = place.directions ? `${place.directions}, ${steer.value.trim()}` : steer.value.trim();
    if (enhance) s.keep = null;  // another instruction: its takes come with Generate takes
    steer.value = "";
    draw();
  };
  const select = (li) => {
    if (!li) return;
    const i = Number(li.dataset.tpick);
    if (!multi) s.pick = i;
    else if (s.picked.has(i)) s.picked.delete(i);
    else s.picked.add(i);
    draw();
    list.querySelector(`[data-tpick="${s.pick}"]`)?.focus();
  };
  const drop = (i) => {  // a take out of the list (#333); what is selected stays selected, in its order
    s.takes.splice(i, 1);
    meta.splice(i, 1);
    from.splice(i, 1);
    s.picked = new Set([...s.picked].filter((k) => k !== i).map((k) => (k > i ? k - 1 : k)));
    s.pick = s.pick === i ? null : s.pick !== null && s.pick > i ? s.pick - 1 : s.pick;
    draw();
  };
  list.addEventListener("click", (e) => {
    const del = e.target.closest("[data-tdel]");
    if (del) return drop(Number(del.dataset.tdel));
    select(e.target.closest("[data-tpick]"));
  });
  list.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && !e.target.closest("[data-tdel]")) { e.preventDefault(); select(e.target.closest("[data-tpick]")); }
  });
  if (multi) {
    sheet.querySelector("[data-tall]").onclick = () => { s.takes.forEach((_, i) => s.picked.add(i)); draw(); };
    sheet.querySelector("[data-tnone]").onclick = () => { s.picked.clear(); draw(); };
    if (lib) lib.onclick = async () => {
      const picked = [...s.picked].sort((a, b) => a - b).filter((i) => !known || from[i] === "new");
      const entries = picked.map((i) => s.takes[i]);
      try {
        if (known) {  // the sheet stays: Generate takes, then add more
          const d = await app.api.addToLibrary({ name: place.what, entries });
          picked.forEach((i) => { from[i] = "added"; s.picked.delete(i); });
          s.note = `Added ${d.added} to __${place.what}__.`;
          draw();
          return librariesChanged(app);
        }
        const d = await app.api.addToLibrary({ name: place.what, entries, directions: place.directions || "" });
        app.closeSheet();
        app.toast(`<b>__${esc(place.what)}__</b> is written: ${d.added} entries, in your libraries`,
          { label: "Open", run: () => { app.state.lib = place.what; app.go("libraries"); } });
        await librariesChanged(app);
      } catch (err) { s.error = err.message; draw(); }
    };
  }
  if (pick) pick.onclick = () => {  // #336: in place of the slot, the library, or the prompt a picture's takes replace
    const chosenTakes = picks().map((i) => s.takes[i]), next = insertTake(app.text, place, asChoice(chosenTakes));
    app.closeSheet();
    changed(next, `${chosenTakes.length} takes are in as a choice: every Roll picks one · an unsaved edit`);
  };
  if (use) use.onclick = async () => {
    const take = s.takes[chosen()];
    if (take === undefined) return;
    try {
      if (picture) {
        const d = await app.api.galaxyWrite({ id: place.id, what: place.what, text: take });
        app.closeSheet();
        place.written?.(d.row);
        return app.toast("The take is in the picture's exports");
      }
      if (enhance) {
        await app.api.keepRewrite({ key: s.keep, instruction: place.what, text: take });
        app.closeSheet();
        return app.toast(`Kept for this roll: a run at seed ${esc(String(app.bridge.getSeed()))} that rolls this prompt uses it instead of asking the model`);
      }
    } catch (err) { s.error = err.message; return draw(); }
    app.closeSheet();
    changed(insertTake(app.text, place, take), "The take is in the editor · an unsaved edit");
  };
  drawSends();
  // nothing is asked until Generate takes (#436); a story and Continue name their choices first (#342, #343)
  s.note = place.kind === "story" ? "Pick where the story starts and ends, how many scenes and how long: Generate takes writes them."
    : place.kind === "continue" ? `Pick ${scenes.length ? "the scene to continue after, " : ""}how many new scenes and how long: Generate takes writes them.`
      : "Steer them and pick what goes along, if you like: Generate takes asks the language model.";
  draw();
}
