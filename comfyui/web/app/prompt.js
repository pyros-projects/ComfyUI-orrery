// Prompt tab: preset bar, the highlighted editor with completion, dials, and a way into Test.
import { KEYWORDS, castNames, inlineLibraries, suggest } from "../orrery-complete.js";
import { chosen, closeMenu, drawMenu, fillMenu, joinChoices, keptScroll, reveal } from "./dialmenu.js";
import { esc, highlight, hintRooms } from "./highlight.js";
import { bindRoom, setRooms } from "./textroom.js";
import { annotationLines, mergeHints, shownHints } from "./annotate.js";
import { wireHover } from "./hover.js";
import { hintsFor } from "./remember.js";
import { icon } from "./icons.js";
import { applyDials, chunkInfo, copyScene, dials, dropScene, hasGoto, knobKey, knobsOf, withFields, plays, sceneAtCaret, sceneStep, sceneTransport, folderColor, pickerGroups, sceneTarget, shape, stats, stripComments, PLAN_HINT, matches, templateHash } from "./model.js";
import { drag, thumbHTML } from "./parts.js";
import { openSave } from "./save.js";
import { openSceneStats } from "./scenestats.js";
import { openTree } from "./tree.js";
import { kept, TAKES, takesOf } from "./results.js";
import { llmLocal } from "./miniruns.js";
import { markPlace, openTakes, placeAt, placeOf, placeOfRoll } from "./takes.js";
import { STARTERS } from "./starters.js";
import { runRolls } from "./test.js";
import { caretPoint, cellStart, inCell, jumpCell, paintCells, renderCells, wireCells } from "./cells.js";
import { loadChain } from "./timeline.js";
import { paintStage, paintStageLive, stageSectionHTML, wireStage } from "./stage.js";
import { openLibraries, openWrite, writeMenuHTML, writeNow } from "./write.js";

function statsHTML(app) {
  const st = stats(app.text), out = shape(app.text), plan = planOf(app), planned = planData(app);
  // with GOTO lines the clips are the walked path's (all of it when it ends, else on and on)
  const walked = st.h3?.reel && hasGoto(app.text) ? app.reelPath() : null;
  const reel = !st.h3?.reel ? null : !hasGoto(app.text) ? st.h3.reel
    : { ...st.h3.reel, clips: walked ? (walked.ended ? walked.path.length : Infinity) : NaN, goto: true };
  const wired = /^\s*(:\s*.*\b[wh]\d|@size\b)/m.test(app.text) ? [] : app.bridge.frames?.() || [];  // `@size` wins
  const outs = app.data.gTemplates?.[templateHash(app.text)] || 0;  // the gallery's count, once it was open
  const forever = reel && reel.clips === Infinity, clips = !reel ? "" : forever ? "∞" : Number.isNaN(reel.clips) ? "?" : reel.clips;
  const how = !reel ? "" : `Its clips live in output/${app.bridge.chain?.() || "h3_context"}. Wire the picks into Orrery Continue (and the clip into Orrery Film). Next clip counts up by itself after each run (unless held): `
    + (forever ? "Run (Instant) plays clip after clip until you stop it." : `a Run count of ${clips} plays the whole reel${reel.goto ? " at this seed (its GOTO lines may jump on what rolls)" : ""}; after the last clip nothing downstream runs.`);
  const timing = reel
    ? `<span class="stat" title="${esc(how)}"><b>Reel</b> · ${reel.secs.map((s, i) => `<b>${s.toFixed(1)} s</b>${reel.repeats[i] === 1 ? "" : ` ×${reel.repeats[i] === Infinity ? "∞" : reel.repeats[i]}`}`).join(" + ")}${reel.goto ? " · GOTO" : ""} · <b>${clips}</b> clip${reel.clips === 1 ? "" : "s"}</span>`
    : st.h3 ? `<span class="stat"><b>H3</b> · ${st.h3.shots} shot${st.h3.shots === 1 ? "" : "s"} · <b>${st.h3.secs.toFixed(1)} s</b> · ${st.h3.voices} voice${st.h3.voices === 1 ? "" : "s"}</span>` : "";
  const frames = reel ? ` · <b>${out.lengths.join(" / ")}</b> frames per scene` : st.h3 ? ` · <b>${out.length}</b> frames = ${(out.length / 24).toFixed(2)} s` : "";
  return timing
    + `<span class="stat"><b>${st.rolls}</b> rolls · <b>${st.libs}</b> libraries · <b>${st.binds}</b> bindings${setDials(app) ? ` · <b>${setDials(app)}</b> dialed` : ""}</span>`
    + `${app.llmActive() ? `<span class="stat" title="Unknown __libraries__ and __name:N__ are made by this model when the node runs${app.llmApi()
      ? "; an API endpoint, beside ComfyUI: no VRAM, no queue" : ""}">LLM <b>${esc(app.data.llm.active.name)}</b>${app.llmApi() ? " · API" : ""}</span>` : ""}`
    + writeNowHTML(app)
    + (wired.length
      ? `<span class="stat" title="Width and height take the shape of the ${wired[0].replace("_", " ")} wired into the node, at the header's megapixels or H3's canvas area, so H3 does not stretch or crop it; the size is known when the node runs">→ size from the <b>${wired[0].replace("_", " ")}</b>${headerMP(app.text) ? ` · ${out.megapixels} MP` : ""}${frames}</span>`
      : `<span class="stat" title="The node's width, height, length and megapixels outputs${reel ? "; from the second clip on, length includes the 22 frames the clip continues from" : ""}">→ <b>${out.width}×${out.height}</b> · ${out.megapixels} MP${frames}</span>`)
    + (planned?.error ? `<span class="stat warn" title="${esc(planned.error)}">${esc(planned.error)}</span>` : "")
    + `${out.cli.length ? `<span class="stat cli" title="In ComfyUI, use the Run count and the seed widget">${esc(out.cli.join(" "))}: CLI only</span>` : ""}<span class="grow"></span>`
    + `${outs ? `<button class="btn ghost" data-act="outputs">${icon("image")}${outs} output${outs === 1 ? "" : "s"}</button>` : ""}`
    + `<button class="btn" data-act="test" title="Roll it in the Test tab: a few seeds, or a reel's clips">${icon("dice")}Test</button>`
    + (reel ? (app.run
      ? `<span class="stat live" title="The clip of the reel this node is rendering now">Rolling clip <b>${Number(app.run.segment) + 1}</b></span>`
      : `<label class="rep" title="The clip Roll plays next; after each run it steps on to the next, unless held">Next clip<input type="number" min="1" value="${Number(app.bridge.getSegment()) + 1}" data-nextclip aria-label="The clip Roll plays next"></label>`
        + `<button class="btn ghost" data-act="hold" aria-pressed="${!!app.bridge.segmentHeld?.()}" title="${app.bridge.segmentHeld?.()
          ? "Held: every Roll plays this clip again, for takes. Press to step on after each run" : "Hold this clip: every Roll plays it again, for takes"}">${icon("lock")}Hold</button>`)
      + `<button class="btn ghost" data-act="jump" title="Scroll the editor to the scene that plays the next clip">${icon("jump")}Jump</button>`
      + `<button class="btn ghost" data-act="tree" title="The take tree: every take of the reel, its paths and the film's">${icon("tree")}Tree</button>`
      + `<button class="btn" data-act="restart" title="Cancel this node's queued and running clips, set segment to 0 and generate from the start">${icon("undo")}Restart</button>` : "")
    + (app.state.sweepQueue
      ? `<button class="btn primary" data-act="stopsweep" title="Stop queueing the sweep; what is queued already still runs">${icon("x")}Stop<small class="sweep">${app.state.sweepQueue.done}/${app.state.sweepQueue.total} queued</small></button>`
      : plan
      ? `<button class="btn primary" data-act="generate" title="The sweep: every LoRA strength (solo LoRAs in turn) and every cell of the grid, one seed per sweep; the outputs go to a gallery folder of their own">${icon("play")}Roll ×${plan.runs * repeats(app)}<small class="sweep">sweep ${esc(plan.formula)}</small></button>`
        + `<label class="rep" title="How many seeds: each runs the whole sweep, the seed stepping between them and after the last as its control after generate says">next<input type="number" min="1" max="999" value="${repeats(app)}" data-rep aria-label="Seeds per sweep">${plural(repeats(app), "seed")}</label>`
      : `<button class="btn primary" data-act="generate" title="Queue only what this node feeds, up to its Save nodes; their files go to the gallery">${icon("play")}Roll</button>`
        + `<label class="rep" title="How many runs Roll queues, one after another; seed and segment step between them as their control after generate says, so a reel plays that many clips">next<input type="number" min="1" max="999" value="${repeats(app)}" data-rep aria-label="Runs per Roll">${plural(repeats(app), reel ? "clip" : st.h3 ? "video" : "image")}</label>`);
}

// The folder a reel's clips live in (#197): reels/<preset>, or for an unsaved reel reels/untitled/<date time>,
// named the first time it is needed and kept in the node until New starts another; "" without scenes.
export function chainName(app) {
  if (!app.chunks()) return "";
  if (app.preset) return `reels/${app.preset}`;
  const now = new Date(), two = (n) => String(n).padStart(2, "0");
  return (app.bridge.props.orrery_untitled ||= `reels/untitled/${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())} `
    + `${two(now.getHours())}-${two(now.getMinutes())}`);
}

// The hidden chain widget follows the reel; another chain is another film, so the clips load again.
function syncChain(app) {
  const name = chainName(app);
  if (name === app.bridge.chain?.() || app.bridge.sweeping?.()) return;
  app.bridge.setChain?.(name);
  if (name) app.data.chain = undefined;  // paintEditor loads the new chain's clips
}

// A scene's button in its divider (#204): its numbers (📊). What makes takes, + take, ×N and 📌, is in each clip's
// strip of takes (#319), the results' head: there it makes a take of that clip.
// The transport in every divider (#341), the footer's controls where you are: ⏮ ⏭ move Next clip to the scene
// before or after, ▶ Roll, +N the clips a Roll plays, 🔒 Hold. Each acts on its own scene (#414): a click into a
// scene's header makes its clip the next one first (ACTIVATES), so ▶ rolls that scene and ⏮ ⏭ step from it.
const MORE = [1, 2, 4];
const ACTIVATES = new Set(["prev", "roll", "more", "next", "hold", "stats", "copy"]);
const sceneName = (c, n) => `SCENE ${n + 1}${c?.title ? ` (${c.title})` : ""}`;
export function sceneActs(app) {
  const chunks = app.chunks() || [], seg = Number(app.bridge.getSegment()), busy = !!app.state.sweepQueue, runs = repeats(app);
  const held = !!app.bridge.segmentHeld?.(), more = MORE.find((m) => m > runs) ?? MORE[0];
  const after = runs > 1 ? ` and the ${runs - 1} after it` : "";
  const button = (act, n, inner, title, off = false, extra = "") => `<button type="button" class="scene-act" data-scene-act="${act}" data-chunk="${n}" `
    + `title="${esc(title)}" aria-label="${esc(title)}" ${extra} ${off ? "disabled" : ""}>${inner}</button>`;
  return (c, n) => {
    const { to, now, prev, next } = sceneTransport(chunks, c, seg), none = `${sceneName(c, n)} never plays at this seed: it has no clip`;
    const step = (at, where) => (to === null ? none : at === null ? `No scene ${where} this one` : `Next clip becomes ${at + 1}: the first of the scene ${where} this one`);
    return `<span class="scene-acts">`
      + button("prev", n, icon("skip", "flip"), step(prev, "before"), prev === null || busy)
      + button("roll", n, icon("play"), to === null ? none : now ? `Roll: clip ${to + 1}${after}, as Roll in the footer`
        : `Roll this scene: Next clip becomes ${to + 1}, then Roll plays it${after}`, to === null || busy, 'data-roll="1"')
      + button("more", n, `+${runs}`, `A Roll plays ${runs} clip${runs === 1 ? "" : "s"}. Click for ${more}`, busy)
      + button("next", n, icon("skip"), step(next, "after"), next === null || busy)
      + button("hold", n, icon("lock"), to === null ? none : held && now ? "Held: every Roll plays this clip again. Click to step on after each run"
        : `Hold clip ${to + 1}${held ? " instead" : ""}: every Roll plays it again, for takes`, to === null || (busy && !now), `aria-pressed="${held && now}"`)
      + button("stats", n, icon("chart"), "This scene in numbers: where and how often it plays, what leads to it, what it rolls, what it made")
      + button("copy", n, icon("copy"), `Duplicate ${sceneName(c, n)}: a copy right after it`)  // #344
      + button("drop", n, icon("trash"), `Delete ${sceneName(c, n)}`)
      + "</span>";
  };
}

// A click on a SCENE line, its words or its divider, makes that scene the active one (#414); a selection does not.
function sceneLineClick(app, ta) {
  if (ta.selectionStart !== ta.selectionEnd) return;
  const chunks = app.chunks(), n = sceneAtCaret(chunks, app.text, (inCell(ta) ? cellStart(app, ta) : 0) + ta.selectionStart);
  if (n >= 0) activateScene(app, chunks[n]);
}

// A scene made the active one (#414): its clip becomes Next clip (the one it plays next, else its first), and the
// dividers and the footer follow. False when it has no clip at this seed, or while Generate ×N queues.
function activateScene(app, c) {
  const seg = Number(app.bridge.getSegment()), to = c && !app.state.sweepQueue ? sceneTarget(c, seg) : null;
  if (to === null) return false;
  if (to !== seg) {
    app.bridge.setSegment(to);
    refreshFoot(app);
    paintEditor(app);
  }
  return true;
}

// The seeds of N takes of clip `to` (#206): numbered on from the takes it has (seed+1, seed+2 …: reproducible),
// or as the node's seed control steps (randomize: any). With 📌 they are take numbers (the noise: seed + take),
// without, the node's seed for each take.
export function surfSeeds(app, to, n, keep) {
  const base = Number(app.bridge.getSeed()) || 0, control = app.bridge.getControl();
  const had = (app.data.chain?.takes?.[to] || []).map((t) => (keep ? t.take : (t.seed ?? base) - base)).filter((v) => v >= 0);
  if (!had.length && (app.data.chain?.clips || []).some((c) => c.segment === to)) had.push(0);  // its one clip
  const start = had.length ? Math.max(...had) + 1 : 0;
  return Array.from({ length: n }, (_, k) => (app.data.surf_numbered !== false || control === "increment" ? start + k
    : control === "randomize" ? Math.floor(Math.random() * 2 ** 31) : control === "decrement" ? -(start + k) : 0));
}

async function sceneAct(app, act, n, button = null) {
  const chunks = app.chunks() || [], c = chunks[n], was = !!c && plays(c, Number(app.bridge.getSegment()));
  const active = ACTIVATES.has(act) && activateScene(app, c);  // #414: its own scene first
  if (act === "stats") return openSceneStats(app, n, button);  // #219, also while a sweep runs
  if (act === "hold") {  // this scene's clip: released when it is the held one, else held (the hold moves here)
    if (!active && !was) return;
    app.bridge.holdSegment(was ? !app.bridge.segmentHeld() : true);
    refreshFoot(app);
    return paintEditor(app);
  }
  if (!c || app.state.sweepQueue) return;
  if (act === "copy" || act === "drop") {  // #344: an unsaved edit, with Undo
    const before = app.text, name = sceneName(c, n);
    app.text = act === "copy" ? copyScene(before, chunks, n) : dropScene(before, chunks, n);
    app.cellsSig = null;
    renderPrompt(app);
    return app.toast(`${act === "copy" ? `A copy of ${esc(name)} is right after it` : `${esc(name)} is deleted`} · an unsaved edit`,
      { label: "Undo", run: () => { app.text = before; app.cellsSig = null; renderPrompt(app); } });
  }
  if (act === "roll") return active && generate(app);  // the footer's Roll (#341), from this scene (#414)
  if (act === "more") {
    app.bridge.props.repeat = MORE.find((m) => m > repeats(app)) ?? MORE[0];
    refreshFoot(app);
    return paintEditor(app);
  }
  if (act === "prev" || act === "next") {
    const to = sceneStep(chunks, Number(app.bridge.getSegment()), act === "next" ? 1 : -1);
    if (to === null) return;
    app.bridge.setSegment(to);
    refreshFoot(app);
    return paintEditor(app);
  }
  if (act === "takes") { app.bridge.props.orrery_takes = TAKES[(TAKES.indexOf(takesOf(app)) + 1) % TAKES.length]; return paintEditor(app); }
  if (act === "keep") { app.bridge.props.orrery_keep = { ...app.bridge.props.orrery_keep, [n]: !kept(app, n) }; return paintEditor(app); }
  if (act !== "gen") return;
  const to = button?.dataset.seg != null ? Number(button.dataset.seg) : sceneTarget(c, Number(app.bridge.getSegment()));
  if (to === null) return;
  app.bridge.setSegment(to);
  const scene = chunks.findIndex((o) => plays(o, to)), keep = kept(app, scene), base = Number(app.bridge.getSeed()) || 0;
  const offsets = surfSeeds(app, to, takesOf(app), keep);
  let queued = 0;
  try {
    for (const offset of offsets) {
      app.bridge.setSegment(to);
      app.bridge.setTake(keep ? Math.max(0, offset) : 0);
      app.bridge.setSeed(keep ? base : Math.max(0, base + offset) % 2 ** 32);
      queued += await app.bridge.generate(1);
    }
    if (!queued) app.toast("Nothing to generate: connect this node's outputs toward a Save or Preview node.");
    else if (offsets.length > 1) app.toast(`Queued <b>${queued}</b> takes of clip ${to + 1}: pick the best under it once they are in`);
  } catch (err) { app.fail(err); }
  app.bridge.setSegment(to);  // the clip steps on after it is queued: back, so the scene stays where it is
  app.bridge.setTake(0);
  app.bridge.setSeed(base);
  refreshFoot(app);
}

// Write now (#168): the libraries the template still needs, written before any run: with an API endpoint at once
// beside ComfyUI, with a text encoder in a run of its own each, at the queue's front (#176).
function writeNowHTML(app) {
  if (!app.llmApi() && !llmLocal(app)) return "";
  if (app.state.writingNow) return `<span class="stat live">Writing <b>${app.state.writingNow}</b> librar${app.state.writingNow === 1 ? "y" : "ies"}…</span>`;
  const open = openLibraries(app.text, app.data.completion?.libraries || [], new Set(inlineLibraries(app.text).map((l) => l.name)));
  const how = app.llmApi() ? "each in a request of its own, all at once, beside ComfyUI" : "each in a run of its own, at the front of ComfyUI's queue";
  return open.length ? `<button class="btn ghost" data-act="writenow" title="Write ${esc(open.map((n) => `__${n}__`).join(", "))} now: ${how}. The next run finds them done; they wait for review in Libraries.">`
    + `${icon("spark")}Write ${open.length} now</button>` : "";
}

// What Roll's number counts: "next 1 clip", "next 3 clips".
const plural = (n, noun) => (n === 1 ? noun : `${noun}s`);

// The cells view: each chunk its own cell with its clips under it (a reel, the timeline on, chosen in the footer).
// A reel's clips under each scene, the timeline on (the column beside the editor went in #185).
// The cells view: a reel's scenes each a cell with its clips under it; a template without scenes one cell with its
// results under it (#211).
const cellsView = (app) => app.data.timeline !== false;

// The dials' sidebar (#184): its width, kept in the node, and whether it is folded.
const SIDE_W = 300, ROOMY = 900;  // a row narrower than ROOMY starts with the sidebar folded
const sideWidth = (app) => Number(app.bridge.props.orrery_side_w) || SIDE_W;

// `0.6MP` in the @h3 line: the area a frame-shaped clip gets.
const headerMP = (text) => /^\s*@h3\b[^\n]*\s\d+(?:\.\d+)?mp\b/im.test(stripComments(text));

// Runs per Roll, kept in the node's properties so the workflow remembers it.
const repeats = (app) => Math.min(999, Math.max(1, Math.floor(Number(app.bridge.props.repeat) || 1)));

function chipHTML(app) {
  const card = app.preset && app.card(app.preset), d = app.dirty();
  const head = card
    ? `<span class="fold" style="--c:${folderColor(card.folder)}">${esc(card.folder || "mine")}</span><span class="ptitle">${esc(card.title)}</span>`
      + `${card.builtin ? `<span class="muted flex" title="Built-in, read-only">${icon("lock")}</span>` : ""}`
    : app.preset ? `<span class="ptitle">@${esc(app.preset)}</span><span class="warn">missing</span>` : '<span class="ptitle">Untitled prompt</span>';
  return `${head}${d ? `<span class="dirty">${card ? "edited" : "unsaved"}</span>` : ""}<span class="caret">${icon("chev")}</span>`;
}

export function renderPrompt(app) {
  app.bridge.syncSegment?.(!!app.chunks());
  syncChain(app);
  const card = app.preset && app.card(app.preset);
  const d = app.dirty();
  app.view.innerHTML = `
    <div class="pbar">
      <button class="pchip" data-act="pick" aria-haspopup="listbox" aria-expanded="${app.state.pick}">${chipHTML(app)}</button>
      <button class="icon-btn" data-act="revert" title="Revert to the saved preset" ${card && d ? "" : "disabled"}>${icon("undo")}</button>
      <button class="btn" data-act="save" ${card && (d || setDials(app)) ? "" : "disabled"}>${icon("save")}${card?.builtin ? "Save a copy" : "Save"}</button>
      <button class="btn primary" data-act="saveas">Save as…</button>
      <button class="btn" data-act="new" aria-haspopup="menu" aria-expanded="${!!app.state.newMenu}">${icon("plus")}New</button>
      <button class="btn" data-act="write" aria-haspopup="menu" aria-expanded="${!!app.state.writeMenu}" title="The language model writes: the reel's next scene, the shot between two frames, a prompt from a picture">${icon("spark")}Write</button>
      ${app.state.newMenu ? `<div class="pop newpop" role="menu">${Object.entries(STARTERS).map(([k, s]) => `<button role="menuitem" data-new="${k}"><b>${esc(s.label)}</b><span class="muted">${esc(s.hint)}</span></button>`).join("")}</div>` : ""}
      ${app.state.writeMenu ? writeMenuHTML(app) : ""}
    </div>
    ${card?.note ? `<p class="pnote pfold${app.bridge.props.orrery_note_open ? " open" : ""}" data-act="note" title="${app.bridge.props.orrery_note_open ? "Click to fold the description" : "Click for the whole description"}">`
      + `<b>${esc(card.title)}.</b> ${esc(card.note)}</p>` : '<p class="pnote">Type a template, or open a preset. <b>__</b> lists your libraries, <b>$</b> your bindings.</p>'}
    <div class="edrow" style="--side-w:${sideWidth(app)}px">${cellsView(app)
      ? `<div class="editor cells${app.data.dividers === false ? " nodiv" : ""}"></div>`
      : `<div class="editor${app.data.dividers === false ? " nodiv" : ""}"><pre class="hl" aria-hidden="true"></pre><textarea spellcheck="false" aria-label="Template"></textarea></div>`}
      <div class="side-grip" role="separator" aria-orientation="vertical" tabindex="0" title="Drag to resize the dials" hidden></div>
      <aside class="dials" aria-label="Dials" hidden></aside></div>
    ${cellsView(app) ? stageSectionHTML(app) : ""}
    <div class="pfoot">${statsHTML(app)}</div>
    ${app.state.pick ? pickerHTML(app) : ""}`;

  const paint = () => paintEditor(app);
  const afterEdit = (ta) => {
    fixReelSeed(app);
    fixUniqueSeed(app);
    if (dialKey(app.text) !== app.state.dialKey) renderDials(app);
    refreshBar(app);
    if (ta) complete(app, ta);
    else closeCompletion(app);
  };
  // only this textarea's completion: in the cells view focus moves between textareas while typing goes on
  const blur = (ta) => setTimeout(() => { if (!app.ac || app.ac.ta === ta) closeCompletion(app); }, 120);
  const focus = () => app.refreshCompletion().then(paint).catch(() => {});
  if (cellsView(app)) {
    renderCells(app);
    wireCells(app, { onEdit: afterEdit, onKey: (e) => completionKey(app, e), onFocus: focus, onBlur: blur });
    wireStage(app, { edited: () => { renderCells(app); afterEdit(null); } });  // the preview (#305); a REMEMBER: line written
    paintStage(app, true);
    paintStageLive(app);
  } else {
    const ed = bindRoom(app.view.querySelector(".editor textarea")), pre = app.view.querySelector(".editor pre.hl");
    ed.value = app.text;
    ed.readOnly = !!app.state.sweepQueue;
    paint();
    ed.addEventListener("input", () => {
      app.text = ed.value;
      paint();
      afterEdit(ed);
    });
    ed.addEventListener("scroll", () => { pre.scrollTop = ed.scrollTop; });
    ed.addEventListener("keydown", (e) => completionKey(app, e));
    ed.addEventListener("blur", () => blur(ed));
    ed.addEventListener("focus", focus);
  }
  wireHover(app, app.view.querySelector(".editor"));
  const editor = app.view.querySelector(".editor"), keyOf = (e) => e.target.closest?.(".llm-key");
  if (editor && !editor.dataset.marks) {  // a 🎲 outlines its place while the pointer is on it (#280)
    editor.dataset.marks = "1";
    editor.addEventListener("mouseover", (e) => { if (keyOf(e)) markPlace(keyOf(e), true); });
    editor.addEventListener("mouseout", (e) => { if (keyOf(e)) markPlace(keyOf(e), false); });
  }
  if (app.data.timeline !== false && app.chunks()) loadChain(app).then(paint);

  app.sceneActs = () => sceneActs(app);
  app.view.onclick = (e) => {
    const key = e.target.closest("[data-llm]");  // a 🎲 at a line's end (#173)
    if (key) return openTakes(app, placeOf(app, key), key);
    const roll = e.target.closest("[data-lroll]");  // a library's roll at a line's end: that library's takes (#273)
    if (roll && placeOfRoll(app, roll)) return openTakes(app, placeOfRoll(app, roll), roll);
    if ((e.ctrlKey || e.metaKey) && e.target.tagName === "TEXTAREA" && app.llmActive()) {  // Ctrl+click on a library
      const place = placeAt(app, e.target);
      if (place) return openTakes(app, place, e.target);
    }
    const scene = e.target.closest("[data-scene-act]");
    if (scene) return sceneAct(app, scene.dataset.sceneAct, Number(scene.dataset.chunk), scene);
    if (e.target.tagName === "TEXTAREA" && e.target.closest(".editor")) sceneLineClick(app, e.target);  // #414
    const act = e.target.closest("[data-act]")?.dataset.act;
    const load = e.target.closest("[data-load]");
    if (load) return app.loadPreset(load.dataset.load);
    if (act === "pick") { app.state.pick = !app.state.pick; app.state.pickQ = ""; app.state.pickI = 0; renderPrompt(app); app.$("#oa-pq")?.focus(); }
    if (act === "revert") revert(app);
    if (act === "save") save(app);
    if (act === "saveas") openSave(app, { text: applyDials(app.text, app.bridge.getParams()), from: app.preset, link: true });
    if (act === "test") { app.go("test"); runRolls(app); }
    if (act === "stopsweep") return app.bridge.stopGenerate();
    if (act === "generate") return generate(app);
    if (act === "restart") restart(app);
    if (act === "jump") jumpToChunk(app);
    if (act === "tree") openTree(app);
    if (act === "new") { app.state.newMenu = !app.state.newMenu; app.state.writeMenu = false; return renderPrompt(app); }
    if (act === "write") { app.state.writeMenu = !app.state.writeMenu; app.state.newMenu = false; return renderPrompt(app); }
    const writer = e.target.closest("[data-write]")?.dataset.write;
    if (writer) { app.state.writeMenu = false; renderPrompt(app); return openWrite(app, writer); }
    const starter = e.target.closest("[data-new]")?.dataset.new;
    if (starter) startNew(app, starter);
    if (act === "note") {  // the preset's description: one line until opened (#306), as the node remembers; in place, the editor stays
      const open = (app.bridge.props.orrery_note_open = !app.bridge.props.orrery_note_open), note = e.target.closest(".pnote");
      note.classList.toggle("open", open);
      note.title = open ? "Click to fold the description" : "Click for the whole description";
      return;
    }
    if (act === "outputs") {  // every output of this prompt, wherever the gallery was
      Object.assign(app.state, { gScope: "prompt", gPlace: { view: "all", day: null, coll: null }, gAlbums: [] });
      app.go("galaxy");
    }
    if (act === "writenow") return writeNow(app);
    if (act === "hold") { app.bridge.holdSegment(!app.bridge.segmentHeld()); refreshFoot(app); return paintEditor(app); }  // the dividers' 🔒 too (#341)
    if (act === "browse") app.go("presets");
  };
  app.view.onchange = (e) => {
    if (e.target.dataset.nextclip !== undefined) {
      app.bridge.setSegment(Math.max(0, Math.floor(Number(e.target.value) || 1) - 1));
      return paintEditor(app);  // the dividers' ⏮ ⏭ follow (#341)
    }
    if (e.target.dataset.rep === undefined) return;
    app.bridge.props.repeat = Number(e.target.value) || 1;
    e.target.value = repeats(app);
    refreshFoot(app);  // the sweep button counts runs × seeds, and the noun after the number follows it
    paintEditor(app);  // and the dividers' +N
  };
  if (app.state.pick) wirePicker(app);
  renderDials(app);
  wireDials(app);
  fixReelSeed(app);
  fixUniqueSeed(app);
  refreshPlan(app);
  refreshReelPath(app);  // a reel with CUT TO: walks at the seed: without it no scene knows its clips
  refreshRemembered(app);  // the hints and the remembered frames of a reel just opened
  refreshAnnotations(app);
}

async function generate(app) {
  await ensurePlan(app);
  if (planOf(app)) return generateSweep(app);
  const runs = repeats(app);
  app.bridge.generate(runs).then((n) => {
    if (!n) app.toast("Nothing to generate: connect this node's outputs toward a Save or Preview node.");
    else if (runs > 1 && n === runs) app.toast(`Queued <b>${runs}</b> runs`);  // fewer: Restart stopped it and says so
    refreshFoot(app);
  }).catch((err) => app.fail(err));
}

async function restart(app) {
  try {
    await app.bridge.stopGenerate();
    const cancelled = await app.bridge.cancelRuns();
    app.run = null;
    app.bridge.setSegment(0);
    await ensurePlan(app);
    if (planOf(app)) return generateSweep(app, cancelled);
    const runs = repeats(app);
    if (!(await app.bridge.generate(runs))) return app.toast("Nothing to generate: connect this node's outputs toward a Save or Preview node.");
    app.toast(`Restarted at clip <b>1</b>${runs > 1 ? ` · ${runs} runs queued` : ""}${cancelled ? ` · cancelled ${cancelled} earlier run${cancelled === 1 ? "" : "s"} of this node` : ""}`);
    refreshFoot(app);
  } catch (err) { app.fail(err); }
}

const SWEEP_ASK = 50;  // above this many runs, Generate asks first

// A LoRA sweep: every run, once per seed, its outputs in a galaxy folder named after the first swept LoRA.
function generateSweep(app, cancelled = 0) {
  const plan = planOf(app), seeds = repeats(app), total = plan.runs * seeds;
  const stamp = new Date(), pad = (n) => String(n).padStart(2, "0");
  const folder = `sweeps/${plan.first.split("/").pop().slice(0, 40)} ${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())} ${pad(stamp.getHours())}.${pad(stamp.getMinutes())}`;
  const lock = (on) => {
    app.state.sweepQueue = on ? { done: 0, total } : null;
    if (app.state.tab === "prompt") app.view.querySelectorAll(".editor textarea").forEach((ed) => { ed.readOnly = on; });
    refreshFoot(app);
  };
  const progress = (done) => {
    if (app.state.sweepQueue) app.state.sweepQueue.done = done;
    const stop = app.state.tab === "prompt" && app.view.querySelector('[data-act="stopsweep"] .sweep');
    if (stop) stop.textContent = `${done}/${total} queued`;
  };
  const go = () => {
    lock(true);
    return app.bridge.generateSweep(plan.runs, seeds, folder, progress).finally(() => lock(false)).then((n) => report(n));
  };
  const report = (n) => {
    if (!n) return app.toast("Nothing to generate: connect this node's outputs toward a Save or Preview node.");
    app.toast(`Queued <b>${n}</b> runs · sweep ${esc(plan.formula)}${seeds > 1 ? ` × ${seeds} seeds` : ""} · gallery folder <b>${esc(folder)}</b>`
      + `${cancelled ? ` · cancelled ${cancelled} earlier run${cancelled === 1 ? "" : "s"} of this node` : ""}`
      + `${n < total ? ` · stopped after ${n} of ${total}` : ""}`);
  };
  if (total <= SWEEP_ASK) return go().catch((err) => app.fail(err));
  const sheet = app.openSheet(`<form class="panel"><div class="row spread"><h4>Queue ${total} runs?</h4></div>
    <p class="muted flush">The sweep makes ${plan.runs} runs (${esc(plan.formula)})${seeds > 1 ? `, for each of ${seeds} seeds` : ""}.</p>
    <div class="acts"><button type="button" class="btn ghost" data-cancel>Cancel</button><button class="btn primary">${icon("play")}Queue ${total}</button></div></form>`);
  sheet.querySelector("[data-cancel]").onclick = () => app.closeSheet();
  sheet.querySelector("form").onsubmit = (e) => { e.preventDefault(); app.closeSheet(); go().catch((err) => app.fail(err)); };
  sheet.querySelector("button.primary").focus();
}

const painted = new WeakMap();  // the editor's highlight → what it was made from

// The highlight with the reel's chunk dividers and the next segment's chunk marked; the dials say what they roll.
// It is made again only when something it shows changed (#218).
function paintEditor(app) {
  paintRolls(app);
  if (app.view.querySelector(".editor.cells")) return paintCells(app);
  const pre = app.view.querySelector(".editor pre.hl");
  if (!pre) return;
  const chunks = app.chunks(), known = app.known(), llm = app.llmActive(), segment = chunks && Number(app.bridge.getSegment());
  const acts = chunks && sceneActs(app);
  const hints = shownHints(app.data.annotations_show, mergeHints(hintsFor(app.text, app.remembered()),
    annotationLines(app.text, app.annotations(), app.api.thumbURL)));
  const key = JSON.stringify([app.text, [...known], llm, chunks, segment, [...hints], acts ? chunks.map((c, n) => acts(c, c.index ?? n)) : ""]);
  if (painted.get(pre) !== key) {
    painted.set(pre, key);
    pre.innerHTML = `${highlight(app.text, known, { llm, chunks, segment, sceneActs: acts, hints })}\n`;
    const ed = pre.parentElement.querySelector("textarea");
    if (ed) setRooms(ed, hintRooms(app.text, known, { llm, hints }));  // the textarea holds the hints too (#416)
  }
  if (chunks && app.data.timeline !== false && app.data.chain === undefined) {  // a reel typed or pasted in
    app.data.chain = null;
    loadChain(app).then(() => paintEditor(app));
  }
}

// The segment moved or a run finished: the marked chunk, the timeline and the footer follow.
export function refreshReel(app, { chain = false } = {}) {
  if (app.state.tab !== "prompt") return;
  refreshFoot(app);
  if (chain && app.data.timeline !== false && app.chunks()) loadChain(app).then(() => paintEditor(app));
  else paintEditor(app);
}

// Jump: the caret and the view to the CHUNK line of the segment Generate plays next.
function jumpToChunk(app) {
  const segment = Number(app.bridge.getSegment()), chunks = app.chunks() || [];
  const i = chunks.findIndex((c) => plays(c, segment));
  if (i < 0) return app.toast(`No scene plays clip <b>${segment + 1}</b>: the reel ends before it. Restart plays it from the beginning.`);
  if (jumpCell(app, i)) return;
  const ed = app.view.querySelector(".editor textarea"), head = app.view.querySelectorAll(".editor .chunkinfo")[i];
  const at = app.text.split("\n").slice(0, chunks[i].line).reduce((n, l) => n + l.length + 1, 0);
  ed.focus({ preventScroll: true });
  ed.setSelectionRange(at, at);
  ed.scrollTop = Math.max(0, head.offsetTop - 10 - head.offsetHeight);  // one line of what comes before
}

export function refreshFoot(app) {
  app.bridge.syncSegment?.(!!app.chunks());  // a template without scenes: clip 0, not stepping (#190)
  syncChain(app);
  refreshPlan(app);  // a dial or an edit can change what Generate queues
  refreshReelPath(app);
  refreshRemembered(app);
  refreshAnnotations(app);
  const foot = app.view.querySelector(".pfoot");
  if (foot) foot.innerHTML = statsHTML(app);
}

// `unique=` walks a shuffled order one step per seed: the seeds of a batch have to come in a row.
function fixUniqueSeed(app) {
  if (!/^\s*(:.*\bunique=|@unique\b)/m.test(stripComments(app.text)) || ["increment", ""].includes(app.bridge.getControl())) return;
  app.bridge.setControl("increment");
  app.toast("@unique: control after generate set to <b>increment</b>, so each run of a batch gets another value");
}

// What Generate queues (a LoRA sweep's runs times a grid's cells) is planned by the server, which knows
// the libraries; the plan, or why it cannot run, is kept for the template and dials it was made for.
const planKey = (app) => `${app.text}\n${JSON.stringify(app.bridge.getParams())}`;
const planData = (app) => (app.data.plan?.key === planKey(app) ? app.data.plan : null);
const planOf = (app) => { const p = planData(app); return p && !p.error && p.runs ? p : null; };

async function fetchPlan(app) {
  const key = planKey(app);
  let got;
  try { got = await app.api.plan({ template: app.text, target: app.bridge.getTarget(), params: app.bridge.getParams() }); }
  catch (err) { got = { error: err.message }; }
  if (planKey(app) === key) app.data.plan = { ...got, key };
}

function refreshPlan(app) {
  if (!PLAN_HINT.test(stripComments(app.text))) { app.data.plan = null; return; }
  const key = planKey(app);
  if (app.data.plan?.key === key || app.state.planKey === key) return;
  app.state.planKey = key;
  clearTimeout(app.state.planTimer);
  app.state.planTimer = setTimeout(async () => {
    await fetchPlan(app);
    if (app.state.planKey === key) app.state.planKey = null;
    if (app.state.tab === "prompt") refreshFoot(app);
  }, 250);
}

// A reel with GOTO lines: its path at the node's seed comes from the server (a jump may wait on a roll);
// the dividers, the timeline and the cells follow it once it is there.
function refreshReelPath(app) {
  if (!hasGoto(app.text)) { app.data.reelPath = null; return; }
  const key = app.reelKey();
  if (app.data.reelPath?.key === key || app.state.reelKey === key) return;
  app.state.reelKey = key;
  clearTimeout(app.state.reelTimer);
  app.state.reelTimer = setTimeout(async () => {
    let got;
    try { got = await app.api.reel({ template: app.text, target: app.bridge.getTarget(), params: app.bridge.getParams(), seed: app.bridge.getSeed() }); }
    catch (err) { got = { error: err.message }; }
    if (app.state.reelKey === key) app.state.reelKey = null;
    if (app.reelKey() !== key) return;
    app.data.reelPath = { ...got, key };
    if (app.state.tab === "prompt") { paintEditor(app); refreshFoot(app); }
  }, 250);
}

// Where a reel's REMEMBER: lines put their frames, at the node's seed: from the server, which resolves them as
// the compile does; the hints at their ends and the frames under each scene follow once it is there.
// Annotations at line ends (#163): what each line gives at the node's seed (and clip), from the server; they
// wait a moment after typing stops, and a newer template's answer wins.
function refreshAnnotations(app) {
  const key = `${app.reelKey()}\n${app.bridge.getSegment?.() ?? 0}`;
  if (app.data.annotations?.key === key || app.state.annotateKey === key) return;
  app.state.annotateKey = key;
  clearTimeout(app.state.annotateTimer);
  app.state.annotateTimer = setTimeout(async () => {
    let got;
    try {
      got = await app.api.annotate({ template: app.text, target: app.bridge.getTarget(), params: app.bridge.getParams(),
        seed: app.bridge.getSeed(), segment: app.bridge.getSegment?.() ?? 0 });
    } catch { got = {}; }
    if (app.state.annotateKey === key) app.state.annotateKey = null;
    app.data.annotations = { ...got, key };
    if (app.state.tab === "prompt" && `${app.reelKey()}\n${app.bridge.getSegment?.() ?? 0}` === key) paintEditor(app);
  }, 450);
}

function refreshRemembered(app) {
  if (!app.chunks() || !/^\s*(REMEMBER|SEND):/im.test(stripComments(app.text))) { app.data.remembered = null; return; }
  const key = app.reelKey();
  if (app.data.remembered?.key === key || app.state.rememberedKey === key) return;
  app.state.rememberedKey = key;
  clearTimeout(app.state.rememberedTimer);
  app.state.rememberedTimer = setTimeout(async () => {
    let got;
    try { got = await app.api.remembered({ template: app.text, target: app.bridge.getTarget(), params: app.bridge.getParams(), seed: app.bridge.getSeed() }); }
    catch (err) { got = { error: err.message, lines: [] }; }
    if (app.state.rememberedKey === key) app.state.rememberedKey = null;
    if (app.reelKey() !== key) return;
    app.data.remembered = { ...got, key };
    if (app.state.tab === "prompt") paintEditor(app);
  }, 300);
}

// Generate can come before the plan: it waits for it.
async function ensurePlan(app) {
  if (PLAN_HINT.test(stripComments(app.text)) && !planData(app)) await fetchPlan(app);
}

// A reel runs as one clip per queue; a seed that changes between clips would reroll its bindings.
function fixReelSeed(app) {
  if (!stats(app.text).h3?.reel || ["fixed", ""].includes(app.bridge.getControl())) return;
  app.bridge.setControl("fixed");
  app.toast("Reel: control after generate set to <b>fixed</b>, so every scene rolls the same bindings");
}

/* dials: every binding can be turned without editing the template; empty = its default roll */

const dialKey = (text) => [...dials(text).map((d) => `${d.name}=${d.expr}`), ...knobsOf(text).map(knobKey)].join("\n");
const setDials = (app) => Object.keys(app.bridge.getParams()).length;


// A dial's choices: its braces' options, or its library's entries (null while they are on their way).
function dialChoices(app, d) {
  if (d.options.length) return d.options;
  if (!d.lib) return [];
  const own = inlineLibraries(app.text).find((l) => l.name === d.lib);  // the template's @lib wins
  if (own) return own.entries;
  const lib = app.data.libFull?.[d.lib] || app.dialLibs?.[d.lib];  // only this library, once (#152: the home was 30 MB)
  if (!lib) {
    (app.libsLoading ??= {})[d.lib] ??= app.api.library(d.lib)
      .then((got) => { (app.dialLibs ??= {})[d.lib] = got; })
      .catch(() => { (app.dialLibs ??= {})[d.lib] = { entries: [] }; })
      .finally(() => { delete app.libsLoading[d.lib]; refreshMenu(app); });  // asked again after a run empties the cache
    return null;
  }
  return lib.entries.filter((e) => matches(d.tag, e.tags, e.props)).map((e) => e.value);  // the menu shows the first MENU_MAX
}

// The dials (#184): a list in the sidebar beside the editor, one binding a row: its name, what it rolls at the
// node's seed, its box (the default expression as placeholder) and its menu. Folded, the sidebar is a strip.
function renderDials(app) {
  const box = app.view.querySelector(".dials");
  if (!box) return;
  if (app.dm) shutMenu(app);
  const list = dials(app.text), values = app.bridge.getParams(), knobs = templateKnobs(app), keys = new Set(knobs.map(knobKey));
  const kept = Object.fromEntries(Object.entries(values).filter(([k]) => list.some((d) => d.name === k) || keys.has(k)));
  if (Object.keys(kept).length !== Object.keys(values).length) app.bridge.setParams(kept);
  app.state.dialKey = dialKey(app.text);
  const chosen = app.bridge.props.orrery_side, set = Object.keys(kept).length;
  const folded = chosen === "folded" || (chosen !== "open" && (app.view.querySelector(".edrow")?.clientWidth || ROOMY) < ROOMY);
  const any = list.length + knobs.length;
  box.hidden = !any;
  box.classList.toggle("folded", folded);
  app.view.querySelector(".side-grip").hidden = !any || folded;
  if (!any) return void (box.innerHTML = "");
  if (folded) {
    const what = [list.length ? `Dials · ${list.length}` : "", knobs.length ? `Knobs · ${knobs.length}` : ""].filter(Boolean).join(" · ");
    box.innerHTML = `<button class="side-strip" data-dfold title="Show the dials and knobs">${icon("chev")}<span>${what}${set ? ` · ${set} turned` : ""}</span></button>`;
    return;
  }
  box.innerHTML = `<div class="side-head">${sideHead(list.length, set, knobs.length)}</div><div class="dlist">${list.map((d) => {
      const v = kept[d.name] || "", id = `oa-${app.uid}-dl-${d.name}`;
      return `<div class="dial${v ? " on" : ""}" title="$${esc(d.name)} = ${esc(d.expr)}"><div class="dtop"><label class="dn" for="${id}">$${esc(d.name)}</label>`
        + `<span class="droll" data-roll="${esc(d.name)}"></span>`
        + `<button type="button" class="mini" data-dreset="${esc(d.name)}" aria-label="Back to the default roll">${icon("x")}</button></div>`
        + `<input class="dv" id="${id}" data-dial="${esc(d.name)}" value="${esc(v)}" placeholder="${esc(d.expr)}" spellcheck="false" autocomplete="off" role="combobox" aria-expanded="false"></div>`;
    }).join("")}${knobs.length ? knobsHTML(app, knobs, kept) : ""}</div>`;
  paintRolls(app);
}

function sideHead(n, set, knobs = 0) {
  const label = n ? "Dials" : "Knobs";
  return `<span class="label" title="Turn a binding or a knob without editing the template. Empty means the template's own; saving bakes them in.">${label}</span>`
    + `<span class="muted">${n || knobs}${set ? ` · <b>${set}</b> turned` : ""}</span><span class="grow"></span>`
    + (set ? '<button type="button" class="btn ghost" data-dclear title="Every dial back to its default roll">Clear</button>' : "")
    + `<button type="button" class="icon-btn" data-dfold aria-label="Fold the dials">${icon("chev")}</button>`;
}

// The template's knobs (#226): its LoRAs, RefMods, pictures and members, grouped where they hold, "All clips" first,
// then each scene with knobs of its own, the scene of the next clip open. A value set here is the node's, as a
// dial's: the template stays as written, and Save writes it in. A sweep's values are chips to take out or back in.
const KNOB_KIND = { lora: "LoRA", refmod: "RefMod", image: "image", cast: "member" };

function templateKnobs(app) {
  const done = app.data.completion || {};
  return knobsOf(app.text, { loras: (done.loras || []).map((l) => (l.folder ? `${l.folder}/${l.name}` : l.name)),
    refmods: done.refmods || [], cast: castNames(app.text) });
}

// A knob's (strength, start, end) and its words (a member's `refmods`), as written or as the node turns it.
function knobParts(fields) {
  const numbers = fields.filter((f) => !/^[A-Za-z]/.test(f)), words = fields.filter((f) => /^[A-Za-z]/.test(f));
  return { numbers: [0, 1, 2].map((i) => numbers[i] ?? ""), words };
}

function knobsHTML(app, knobs, values) {
  const chunks = app.chunks() || [], segment = Number(app.bridge.getSegment());
  const next = chunks.findIndex((c) => plays(c, segment)), head = knobs.filter((k) => k.scope === -1);
  const groups = [...new Set(knobs.map((k) => k.scope))];
  const open = app.state.knobOpen ??= new Set([-1, next]);
  return `<div class="ksec"><span class="label">Knobs</span><span class="muted">${knobs.length}</span></div>` + groups.map((scope) => {
    const ks = knobs.filter((k) => k.scope === scope), shut = !open.has(scope);
    return `<div class="kgroup${shut ? " shut" : ""}"><button type="button" class="khead" data-kgroup="${scope}">${icon("chev")}`
      + `<span>${scope < 0 ? "All clips" : `SCENE ${esc(ks[0].scene || String(scope + 1))}`}</span>`
      + `${scope >= 0 && scope === next ? '<span class="knext">▶ next</span>' : ""}<span class="muted">${ks.length}</span></button>`
      + (shut ? "" : ks.map((k) => knobHTML(app, k, values, head)).join("")) + "</div>";
  }).join("");
}

function knobHTML(app, k, values, head) {
  const key = knobKey(k), now = values[key], own = knobParts(k.fields);
  const turned = now ? knobParts(specOf(now).split(",").map((f) => f.trim())) : null;
  const over = k.scope >= 0 && head.find((h) => h.kind === k.kind && h.name.toLowerCase() === k.name.toLowerCase());
  const shown = turned || own;
  // a number field with its little buttons, in steps of 0.05; a sweep's field stays text, its values chips below
  const field = (i, label) => (shown.numbers[i].includes("|")
    ? `<input class="dv kf" data-knob="${esc(key)}" data-field="${i}" value="${esc(shown.numbers[i])}" title="${label}" aria-label="${esc(k.name)} ${label}" spellcheck="false" autocomplete="off">`
    : `<input class="dv kf" type="number" step="0.05"${i ? ' min="0" max="1"' : ""} data-knob="${esc(key)}" data-field="${i}" value="${knobNumber(shown.numbers[i], i)}"`
      + ` title="${label}${i ? ": a share of sampling, 0 the first step, 1 the last" : ""}" aria-label="${esc(k.name)} ${label}">`);
  const chips = shown.numbers.map((f, i) => (f.includes("|") ? [i, f] : null)).filter(Boolean).map(([i, f]) => {
    const all = (own.numbers[i].includes("|") ? own.numbers[i] : f).split("|").map((v) => v.trim()), on = new Set(f.split("|").map((v) => v.trim()));
    return `<div class="kchips" title="The sweep's values: a click takes one out or back in">${all.map((v) => `<button type="button" class="kchip${on.has(v) ? " on" : ""}"`
      + ` data-knob="${esc(key)}" data-chip="${i}" data-value="${esc(v)}">${esc(v)}</button>`).join("")}</div>`;
  }).join("");
  return `<div class="dial knob${now ? " on" : ""}" data-row="${esc(key)}" title="${esc(k.text)}"><div class="dtop"><span class="kk ${k.kind}">${KNOB_KIND[k.kind]}</span>`
    + `<span class="dn">${esc(k.name)}</span><span class="droll">${over ? `overrides ${esc(over.fields.filter(Boolean).join(", "))} here` : ""}</span>`
    + `<button type="button" class="mini" data-kreset="${esc(key)}" aria-label="Back to the template's">${icon("x")}</button></div>`
    + `<div class="kfields">${field(0, "strength")}${field(1, "start")}${field(2, "end")}</div>${chips}</div>`;
}

// A knob's field as a number for its field: the strength as written (1 unless written), a start or an end as a share
// of sampling (`20%` is 0.2; 0 and 1 unless written).
function knobNumber(text, i) {
  const v = parseFloat(text);
  if (Number.isNaN(v)) return i === 1 ? 0 : 1;
  return i && (String(text).trim().endsWith("%") || v > 1) ? Math.round(v * 100) / 10000 : v;
}

// The knob written anew from its row (#226): a field the same as the template's keeps how it is written, another is
// written anew (a start or an end with `%`, so a LoRA tag never reads as the commas' sweep of before); words kept.
function knobFromRow(app, key, chip = null) {
  const k = templateKnobs(app).find((x) => knobKey(x) === key);
  const row = app.view.querySelector(`.dials [data-row="${CSS.escape(key)}"]`);
  if (!k || !row) return null;
  const own = knobParts(k.fields);
  const numbers = [...row.querySelectorAll(".kf")].map((input, i) => {
    if (input.type !== "number") return input.value.trim() || own.numbers[i];
    const v = Number(input.value);
    if (input.value === "" || Number.isNaN(v) || Math.abs(v - knobNumber(own.numbers[i], i)) < 1e-6) return own.numbers[i];
    return i ? `${Math.round(v * 10000) / 100}%` : String(Math.round(v * 10000) / 10000);
  });
  if (chip) {  // a sweep's value taken out or back in, in the order written; one stays
    const all = (own.numbers[chip.field].includes("|") ? own.numbers[chip.field] : numbers[chip.field]).split("|").map((v) => v.trim());
    const on = new Set(numbers[chip.field].split("|").map((v) => v.trim()));
    if (on.has(chip.value) && on.size > 1) on.delete(chip.value); else on.add(chip.value);
    numbers[chip.field] = all.filter((v) => on.has(v)).join("|");
  }
  while (numbers.length && !numbers[numbers.length - 1]) numbers.pop();  // a member's words follow its last number
  const text = withFields(k, [...numbers, ...own.words]);
  return text === k.text ? "" : text;
}

// The fields of a knob as written: `name(…)`, `@name(…)`, or a long form `<kind:name:…>` (a LoRA's `:clip` after them).
const specOf = (text) => (/\(([^()]*)\)$/.exec(text) || /^<\w+:[^<>:]+?:([^<>:]*)(?::[^<>]*)?>$/.exec(text) || [0, ""])[1];

// What each dial rolls at the node's seed, from the annotations (#163): the binding's value, else nothing yet.
function paintRolls(app) {
  const rolled = app.annotations?.()?.bindings || {};
  app.view.querySelectorAll(".dials [data-roll]").forEach((el) => {
    const v = rolled[el.dataset.roll], text = v ? `= ${v}` : "";
    if (el.textContent === text) return;  // #218: unchanged, untouched
    el.textContent = text;
    el.title = v ? `At this seed: ${v}` : "";
  });
}

function wireDials(app) {
  const box = app.view.querySelector(".dials"), row = app.view.querySelector(".edrow"), grip = app.view.querySelector(".side-grip");
  const width = (px) => {
    const w = Math.round(Math.min(Math.max(px, 200), row.clientWidth * 0.6));
    row.style.setProperty("--side-w", `${w}px`);
    app.bridge.props.orrery_side_w = w;
  };
  drag(grip, (dx, from) => width(from - dx), () => box.offsetWidth, () => {});
  grip.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    width(box.offsetWidth + (e.key === "ArrowLeft" ? 16 : -16));
  });
  box.addEventListener("scroll", (e) => {  // the menu follows its box while the list scrolls; gone from view, it closes
    if (!app.dm) return;
    const list = e.target.getBoundingClientRect?.(), at = app.dm.input.getBoundingClientRect();
    if (list && (at.bottom < list.top || at.top > list.bottom)) shutMenu(app);
    else refreshMenu(app);
  }, true);
  const put = (name, value) => {
    const values = app.bridge.getParams();
    if (value.trim()) values[name] = value.trim(); else delete values[name];
    app.bridge.setParams(values);
    box.querySelector(`[data-dial="${CSS.escape(name)}"]`)?.closest(".dial").classList.toggle("on", !!value.trim());
    const head = box.querySelector(".side-head");
    if (head) head.innerHTML = sideHead(box.querySelectorAll(".dial").length, Object.keys(values).length);
    refreshBar(app);
  };
  const turn = (key, text) => {  // a knob (#226): its key among the params, its row marked
    const values = app.bridge.getParams();
    if (text) values[key] = text; else delete values[key];
    app.bridge.setParams(values);
    box.querySelector(`[data-row="${CSS.escape(key)}"]`)?.classList.toggle("on", !!text);
    refreshBar(app);
  };
  box.addEventListener("input", (e) => {
    if (e.target.dataset.knob) return turn(e.target.dataset.knob, knobFromRow(app, e.target.dataset.knob));
    if (!e.target.dataset.dial) return;
    put(e.target.dataset.dial, e.target.value);
    openMenu(app, e.target, -1);
  });
  box.addEventListener("focusin", (e) => { if (e.target.dataset.dial) openMenu(app, e.target, -1); });
  box.addEventListener("mousedown", (e) => { if (e.target.dataset.dial && !app.dm) openMenu(app, e.target, -1); });
  box.addEventListener("focusout", (e) => {  // into the menu's filter, the menu stays
    if (e.target.dataset.dial) setTimeout(() => { if (app.dm?.input === e.target && !app.dm.box.contains(document.activeElement)) shutMenu(app); }, 0);
  });
  box.addEventListener("keydown", (e) => {
    const input = e.target;
    if (!input.dataset.dial) return;
    const n = app.dm?.items.length || 0;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const down = e.key === "ArrowDown", was = app.dm ? app.dm.at : -1;
      openMenu(app, input, !n ? -1 : was < 0 ? (down ? 0 : n - 1) : (was + (down ? 1 : n - 1)) % n);
    } else if (e.key === "Enter" && app.dm && app.dm.at >= 0 && app.dm.items[app.dm.at] !== undefined) {
      e.preventDefault();
      pickChoice(app, input, app.dm.items[app.dm.at]);
    } else if (e.key === " " && app.dm && app.dm.at >= 0 && app.dm.items[app.dm.at] !== undefined) {
      e.preventDefault();
      toggleChoice(app, input, app.dm.items[app.dm.at]);
    } else if (e.key === "Escape" && app.dm) {
      e.preventDefault();
      shutMenu(app);
    }
  });
  app.pickChoice = (input, value) => { input.value = value; put(input.dataset.dial, value); };
  box.addEventListener("click", (e) => {
    if (e.target.closest("[data-dfold]")) {
      app.bridge.props.orrery_side = box.classList.contains("folded") ? "open" : "folded";
      return renderDials(app);
    }
    if (e.target.closest("[data-dclear]")) {
      app.bridge.setParams({});
      renderDials(app);
      return refreshBar(app);
    }
    const group = e.target.closest("[data-kgroup]");
    if (group) {
      const scope = Number(group.dataset.kgroup), open = app.state.knobOpen;
      if (open.has(scope)) open.delete(scope); else open.add(scope);
      return renderDials(app);
    }
    const chip = e.target.closest("[data-chip]");
    if (chip) {
      turn(chip.dataset.knob, knobFromRow(app, chip.dataset.knob, { field: Number(chip.dataset.chip), value: chip.dataset.value }));
      return renderDials(app);
    }
    const kr = e.target.closest("[data-kreset]");
    if (kr) {
      turn(kr.dataset.kreset, "");
      return renderDials(app);
    }
    const r = e.target.closest("[data-dreset]");
    if (!r) return;
    e.preventDefault();
    box.querySelector(`[data-dial="${CSS.escape(r.dataset.dreset)}"]`).value = "";
    put(r.dataset.dreset, "");
  });
}

// The dial's menu: drawn in the app (the dials row scrolls and would cut it off), kept in app.dm.
const menuHost = (app) => app.view.closest(".orrery-app") || app.view;

// `keep`: a redraw after a tick, All or None keeps the list where it was, the choice ticked (`keep.anchor`) where it
// was on screen (#300); typing and the arrow keys draw it afresh.
function openMenu(app, input, at, keep = null) {
  const d = dials(app.text).find((x) => x.name === input.dataset.dial);
  if (!d) return;
  const lib = d.lib && (app.data.libFull?.[d.lib] || app.dialLibs?.[d.lib]);
  const entries = lib ? new Map(lib.entries.map((e) => [e.value, e])) : null;
  const describe = lib && d.lib.startsWith("pictures/") ? (c) => {
    const p = entries.get(c)?.props;
    const id = p?.ids?.split("\n")[0];
    return p && { sub: p.who || (p.prompt || "").slice(0, 110), thumb: id && app.api.thumbURL(id) };
  } : null;
  const info = entries ? (c) => entries.get(c) : null;  // the filter reads an entry's properties and tags (#186)
  const filter = app.dm?.input === input ? app.dm.filter || "" : "";
  const refocus = !!app.dm?.box.contains(document.activeElement);  // a redraw while the filter is typed in keeps it there
  const choices = dialChoices(app, d);
  const old = keep && app.dm?.input === input ? app.dm : null;
  const itemTop = (dm, value) => { const n = value == null ? -1 : dm.items.indexOf(value); return n < 0 ? null : dm.box.querySelector(`[data-n="${n}"]`)?.offsetTop ?? null; };
  const before = old && { top: old.box.scrollTop, anchor: itemTop(old, keep.anchor) };
  const state = drawMenu(menuHost(app), input, choices, at, describe, { filter, info });
  if (before) state.box.scrollTop = keptScroll(before, itemTop(state, keep.anchor));
  app.dm = { ...state, input, filter };
  input.setAttribute("aria-expanded", "true");
  const field = state.box.querySelector(".dm-filter");
  if (refocus && field) { field.focus(); field.setSelectionRange(field.value.length, field.value.length); }
  state.box.addEventListener("mousedown", (e) => {
    if (e.target === field) return;  // the filter takes the focus; everything else leaves it with the box
    const item = e.target.closest("[data-n]"), box = e.target.closest("[data-toggle]");
    e.preventDefault();
    if (e.target.closest("[data-all]")) return pickAll(app, input, app.dm.items);
    if (e.target.closest("[data-none]")) return pickAll(app, input, []);
    if (box) toggleChoice(app, input, app.dm.items[Number(box.dataset.toggle)]);
    else if (item) pickChoice(app, input, app.dm.items[Number(item.dataset.n)]);
  });
  field?.addEventListener("input", () => {
    app.dm.filter = field.value;
    app.dm.at = -1;
    app.dm.items = fillMenu(state.box, input, choices, -1, describe, { filter: field.value, info });
  });
  field?.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); input.focus(); shutMenu(app); }
  });
  field?.addEventListener("blur", () => setTimeout(() => {
    if (app.dm?.input === input && document.activeElement !== input && !app.dm.box.contains(document.activeElement)) shutMenu(app);
  }, 0));
}

function refreshMenu(app) {
  if (app.dm && app.dm.input.isConnected) openMenu(app, app.dm.input, app.dm.at);
}

function shutMenu(app) {
  closeMenu(menuHost(app));
  app.dm?.input.setAttribute("aria-expanded", "false");
  app.dm = null;
}

// A tick adds a choice to the ones the dial rolls among, or takes it out; the menu stays open.
function toggleChoice(app, input, value) {
  const d = dials(app.text).find((x) => x.name === input.dataset.dial), all = (d && dialChoices(app, d)) || [];
  const now = chosen(all, input.value), next = now.includes(value) ? now.filter((c) => c !== value) : [...now, value];
  app.pickChoice(input, joinChoices(all.filter((c) => next.includes(c))));  // in the list's order
  openMenu(app, input, app.dm ? app.dm.at : -1, { anchor: value });
}

// All (the choices the menu shows) or None (the default roll); the menu stays open.
function pickAll(app, input, items) {
  app.pickChoice(input, joinChoices(items));
  openMenu(app, input, -1, {});
}

function pickChoice(app, input, value) {
  app.pickChoice(input, value);
  shutMenu(app);
}

// Fresh templates: no preset linked, so nothing can be overwritten by accident.

function startNew(app, kind) {
  if (app.busy()) return;
  const s = STARTERS[kind], prev = { preset: app.preset, base: app.base, text: app.text, params: app.bridge.getParams(), target: app.bridge.getTarget(),
    untitled: app.bridge.props.orrery_untitled };
  const hadWork = app.dirty();
  app.preset = null;
  app.base = null;
  delete app.bridge.props.orrery_untitled;  // a new reel gets a folder of its own (#197)
  app.text = app.data.quickstart === false ? stripComments(s.text).trimStart() : s.text;  // the gear turns it off
  app.bridge.setParams({});
  app.bridge.setTarget(s.target);
  app.state.newMenu = false;
  renderPrompt(app);
  app.view.querySelector("textarea")?.focus();
  app.toast(`New ${esc(s.label)}, not linked to a preset`, hadWork || prev.preset ? {
    label: "Undo",
    run: () => {
      app.preset = prev.preset; app.base = prev.base; app.text = prev.text;
      if (prev.untitled) app.bridge.props.orrery_untitled = prev.untitled;  // the unsaved reel's clips are there
      app.bridge.setParams(prev.params); app.bridge.setTarget(prev.target); renderPrompt(app);
    },
  } : null);
}

function refreshBar(app) {
  const card = app.preset && app.card(app.preset), d = app.dirty();
  app.view.querySelector(".pchip").innerHTML = chipHTML(app);
  app.view.querySelector('[data-act="revert"]').disabled = !(card && d);
  app.view.querySelector('[data-act="save"]').disabled = !(card && (d || setDials(app)));
  refreshFoot(app);
}

function revert(app) {
  if (app.busy()) return;
  const prev = app.text;
  app.text = app.base;
  renderPrompt(app);
  app.toast("Reverted to the saved preset", { label: "Undo", run: () => { app.text = prev; renderPrompt(app); } });
}

async function save(app) {
  const card = app.card(app.preset);
  if (!card) return;
  const text = applyDials(app.text, app.bridge.getParams());
  if (card.builtin) return openSave(app, { text, from: card.name, copyOf: true, link: true });
  try {
    await app.api.savePreset({ name: card.name, text, title: card.title, tags: card.tags, note: card.note, overwrite: true });
    app.text = text;
    app.base = text;
    app.bridge.setParams({});
    await app.refreshPresets();
    renderPrompt(app);
    app.toast(`Saved <b>@${esc(card.name)}</b>`);
  } catch (e) { app.fail(e); }
}

/* quick picker */

function pickerHTML(app) {
  let i = 0;
  const groups = pickerGroups(app.data.presets, { query: app.state.pickQ, favorites: app.data.favorites, recent: app.data.recent });
  const rows = groups.map(([g, cards]) => `<li class="grp label">${esc(g)}</li>` + cards.map((c) => {
    const on = i++ === app.state.pickI;
    return `<li><button data-load="${esc(c.name)}" class="${on ? "on" : ""}"><span class="th">${thumbHTML(app, c)}</span>`
      + `<span class="tt"><span>${esc(c.title)}</span><span class="pname">@${esc(c.name)}</span></span></button></li>`;
  }).join("")).join("");
  return `<div class="pop" role="listbox"><label class="search">${icon("search")}<input class="input" id="oa-pq" placeholder="Find a preset by name, tag or words in it…" value="${esc(app.state.pickQ)}" autocomplete="off"></label>`
    + `<ul>${rows || '<li class="empty">No preset matches.</li>'}</ul>`
    + `<div class="foot"><span>↑↓ choose · ↵ open · esc close</span><button class="btn ghost" data-act="browse">Browse with previews →</button></div></div>`;
}

function wirePicker(app) {
  const q = app.$("#oa-pq");
  q.addEventListener("input", () => {
    const pos = q.selectionEnd;
    app.state.pickQ = q.value;
    app.state.pickI = 0;
    renderPrompt(app);
    const nq = app.$("#oa-pq");
    nq.focus();
    nq.setSelectionRange(pos, pos);
  });
  q.addEventListener("keydown", (e) => {
    const btns = [...app.view.querySelectorAll(".pop [data-load]")];
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      app.state.pickI = (app.state.pickI + (e.key === "ArrowDown" ? 1 : -1) + btns.length) % Math.max(btns.length, 1);
      btns.forEach((b, i) => b.classList.toggle("on", i === app.state.pickI));
      btns[app.state.pickI]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const b = btns[app.state.pickI];
      if (b) app.loadPreset(b.dataset.load);
    } else if (e.key === "Escape") {
      e.preventDefault();
      app.state.pick = false;
      renderPrompt(app);
    }
  });
}

/* completion: the same rules as v0, drawn inside the editor so it scales with the canvas */

// In the cells view a cell sees the whole text (the world's bindings), at its offset in it.
function complete(app, ta) {
  const offset = inCell(ta) ? cellStart(app, ta) : 0;
  const ann = app.annotations() || app.data.annotations;  // while typing, the last ones still know slots and fields
  const data = app.data.completion && { ...app.data.completion, fieldValues: ann?.fields || {},
    taken: Object.fromEntries(Object.entries(ann?.members || {}).flatMap(([name, m]) => m.pictures
      .filter((p) => p.name).map((p) => [p.image, `${name}'s gallery picture (${p.name})`]))) };
  const found = suggest(inCell(ta) ? app.text : ta.value, offset + ta.selectionEnd, data);
  if (!found.items.length) return closeCompletion(app);
  for (const it of found.items) {  // gallery pictures: their thumbnails, by id
    if (it.thumbId) it.thumb = app.api.thumbURL(it.thumbId);
    if (it.thumbIds) it.thumbs = it.thumbIds.map((id) => app.api.thumbURL(id));
  }
  // a whole keyword typed (`CAST`, `SET`): nothing is chosen, so Enter is a new line; ↓ chooses
  const typed = (inCell(ta) ? app.text : ta.value).slice(found.replaceFrom, offset + ta.selectionEnd).trim().replace(/:$/, "");
  const whole = KEYWORDS.some((k) => k.word.trim().replace(/\s*\$$/, "").replace(/:$/, "") === typed);
  app.ac = { ...found, i: whole ? -1 : 0, ta, offset };
  drawCompletion(app);
}

// The popup: wide enough to read (labels and details wrap, nothing is cut), a preview of the highlighted
// item (its text in full, its pictures), under the caret or above it when the app has no room below.
function drawCompletion(app) {
  app.view.querySelector(".ac")?.remove();
  const { items, i, ta } = app.ac, { x, y } = caretPoint(ta), item = items[i] || {};
  // the popup lives in the editor, which scrolls in the cells view: placed where the caret is in its content, while
  // the room around it is measured on screen (#303)
  const editor = ta.closest(".editor"), cell = ta.closest(".cell"), scrolled = editor.scrollTop;
  const dx = cell ? cell.offsetLeft : 0, dy = cell ? cell.offsetTop : 0;
  const box = document.createElement("div");
  box.className = "ac";
  const shown = item.thumbs?.length || item.preview;
  box.innerHTML = `<ul role="listbox">${items.map((it, n) => `<li class="${n === i ? "on" : ""}${it.thumb ? " thumbed" : ""}" data-i="${n}" role="option">`
    + (it.thumb ? `<img class="act" src="${esc(it.thumb)}" alt="" loading="lazy">` : "")
    + `<span class="acl">${esc((it.label ?? it.insert).trim())}</span>${it.detail ? `<span class="acd">${esc(it.detail)}</span>` : ""}</li>`).join("")}</ul>`
    + (shown ? `<div class="pv">${(item.thumbs || []).map((u) => `<img src="${esc(u)}" alt="">`).join("")}`
      + `${item.preview ? `<span>${esc(item.preview)}</span>` : ""}</div>` : "");
  box.addEventListener("mousedown", (e) => {
    const li = e.target.closest("[data-i]");
    if (!li) return;
    e.preventDefault();
    app.ac.i = Number(li.dataset.i);
    acceptCompletion(app);
  });
  editor.appendChild(box);
  const root = editor.closest(".orrery-app") || editor, er = editor.getBoundingClientRect(), rr = root.getBoundingClientRect();
  const k = er.width / editor.offsetWidth || 1, line = parseFloat(getComputedStyle(ta).lineHeight) || 20;
  box.style.left = `${Math.max(4, Math.min(x + 8 + dx, editor.clientWidth - box.offsetWidth - 4))}px`;
  const below = y + 4 + dy, above = y - line - box.offsetHeight - 4 + dy;
  const roomBelow = (rr.bottom - er.top) / k - (below - scrolled), roomAbove = (er.top - rr.top) / k + (above - scrolled);
  box.style.top = `${box.offsetHeight <= roomBelow || roomAbove < 0 ? below : above}px`;
  reveal(box.querySelector("ul"), box.querySelector(".on"));
}

function closeCompletion(app) {
  app.view.querySelector(".ac")?.remove();
  app.ac = null;
}

// True when the completion took the key. Ctrl+Space opens it where the caret is.
function completionKey(app, e) {
  if (e.ctrlKey && (e.code === "Space" || e.key === " ") && e.target.tagName === "TEXTAREA") {
    e.preventDefault();
    complete(app, e.target);
    return true;
  }
  if (!app.ac) return false;
  const n = app.ac.items.length;
  if ((e.key === "Enter" || e.key === "Tab") && app.ac.i < 0) { closeCompletion(app); return false; }  // nothing chosen: the key is the editor's
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const down = e.key === "ArrowDown";
    app.ac.i = app.ac.i < 0 ? (down ? 0 : n - 1) : (app.ac.i + (down ? 1 : -1) + n) % n;
    drawCompletion(app);
  }
  else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); acceptCompletion(app); }
  else if (e.key === "Escape") { e.preventDefault(); closeCompletion(app); }
  else return false;
  return true;
}

function acceptCompletion(app) {
  const { ta, items, i, offset = 0 } = app.ac, insert = items[i].insert, caret = ta.selectionEnd;
  const from = Math.max(0, app.ac.replaceFrom - offset);
  ta.value = ta.value.slice(0, from) + insert + ta.value.slice(caret);
  ta.selectionStart = ta.selectionEnd = from + insert.length;
  closeCompletion(app);
  ta.dispatchEvent(new Event("input", { bubbles: true }));  // the cells view listens on their container
}
