import { test } from "node:test";
import assert from "node:assert/strict";
import { highlight } from "../../comfyui/web/app/highlight.js";
import { openLibraries, writerBlock } from "../../comfyui/web/app/write.js";
import {
  applyDials, dials, downstream, nextSeed, queueSweep, entryPage, libraryHead, filterPresets, folderDropPath, folderTree, libraryGroups, filterRows, glyph, markPicks, pickerGroups,
  chunkInfo, chunkLabel, splitCells, rangeIds, shape, stats, PLAN_HINT, templateHash, hasGoto, plays, longForm, matches, splitOptions, tagsMatch, withDice,
} from "../../comfyui/web/app/model.js";

const known = new Set(["creature", "place"]);

test("libraries are coloured, unknown ones flagged", () => {
  const html = highlight("a __creature__ in __nowhere__", known);
  assert.match(html, /<span class="t-lib">__creature__<\/span>/);
  assert.match(html, /<span class="t-lib t-miss">__nowhere__<\/span>/);
});

test("bindings, braces and multi-picks are coloured", () => {
  const html = highlight("$hero = {1-2$$a|b}", known);
  assert.match(html, /<span class="t-var">\$hero<\/span>/);
  assert.match(html, /<span class="t-brace">1-2\$\$<\/span>/);
  assert.equal((html.match(/t-brace/g) || []).length, 4);
});

test("screenplay lines get keyword colours and html is escaped", () => {
  const html = highlight("@h3 t2va 16:9\nSHOT 5s: push in\nKEEPER (warm voice): Hi\nSFX: rain\nThe start of <Picture 1>.", known);
  assert.match(html, /<span class="t-head">@h3 t2va 16:9<\/span>/);
  assert.match(html, /<span class="t-kw">SHOT 5s:<\/span>/);
  assert.match(highlight("@h3 t2va\nSHOT 5s | push in", known), /<span class="t-kw">SHOT 5s<\/span>/);
  assert.match(html, /<span class="t-kw">KEEPER \(warm voice\):<\/span>/);
  assert.match(html, /<span class="t-kw">SFX:<\/span>/);
  assert.match(html, /&lt;Picture 1&gt;/);
});

test("keyword lines keep their colour without a space after the colon", () => {
  const html = highlight("LORA:<lora:a:0.8>\nHANDOFF:she waves\nSEND:frame 0 to image 3\nGOTO:the walk\nSET:image_1(0.5)", known);
  for (const kw of ["LORA:", "HANDOFF:", "SEND:", "GOTO:", "SET:"]) assert.match(html, new RegExp(`<span class="t-kw">${kw}</span>`));
  assert.match(html, /<span class="t-lora">&lt;lora:a:0.8&gt;<\/span>/);
});

test("screenplay cast lines are keywords", () => {
  const html = highlight("CAST\nsummary: MAYA meets DOG.\nvoice: audio 1", known);
  assert.match(html, /<span class="t-kw">CAST<\/span>/);
  assert.match(html, /<span class="t-kw">summary:<\/span>/);
  assert.match(html, /<span class="t-kw">voice:<\/span>/);
});

test("enhance line, and the params line marks CLI-only parts", () => {
  const html = highlight("> moody\n: x8 seed=100 w832 h1216", known);
  assert.match(html, /<span class="t-enh">&gt; moody<\/span>/);
  assert.match(html, /<span class="t-cli" title="[^"]*">x8<\/span>/);
  assert.match(html, /<span class="t-cli" title="[^"]*">seed=100<\/span>/);
  assert.match(html, /<span class="t-param">w832<\/span>/);
});

test("shape mirrors the node's width, height and H3 length outputs", () => {
  assert.deepEqual(shape("a fox"), { width: 1024, height: 1024, length: 124, megapixels: 1.049, cli: [] });
  assert.deepEqual(shape("a fox\n: x8 seed=100 w832 h1216"), { width: 832, height: 1216, length: 124, megapixels: 1.012, cli: ["x8", "seed=100"] });
  assert.deepEqual(shape("@h3 t2va 16:9\nSHOT 5s\nA."), { width: 1344, height: 768, length: 124, megapixels: 1.032, cli: [] });
  assert.deepEqual(shape("@h3 t2va 9:16\nSHOT 4s\nA.\nSHOT 3s\nB.\nSHOT 4s\nC."), { width: 768, height: 1344, length: 277, megapixels: 1.032, cli: [] });
  assert.equal(shape("@h3 t2va 21:9\nSHOT 4s\nA.").width, 1536);
  assert.equal(shape("@h3 ref2va lite 9:16\nSHOT 4s\nA.").height, 1344);
  const mp = shape("@h3 ref2va 16:9 0.6MP\nSHOT 4s\nA.");
  assert.deepEqual([mp.width, mp.height, mp.megapixels], [1024, 576, 0.6]);
  assert.deepEqual([shape("@h3 t2va 0.5mp\nSHOT 4s\nA.").width, shape("@h3 t2va 0.5mp\nSHOT 4s\nA.").height], [704, 704]);
  assert.deepEqual([shape("@h3 t2va 16:9 0.6MP\n: w1216 h832\nA.").width, shape("@h3 t2va 16:9 0.6MP\n: w1216 h832\nA.").height], [1216, 832]);
});

test("template hash matches orrery's sha256 prefix", () => {
  assert.equal(templateHash("a __creature__"), "f8ad7a7fd793fbc4");
  assert.equal(templateHash(""), "e3b0c44298fc1c14");
  assert.equal(templateHash("Späti 🌙\n$x = {a|b}"), "7fe816c6c2103fe3");
});

test("stats count rolls, libraries, bindings and H3 timing", () => {
  const s = stats("$a = __creature__\n{x|y} in __place__ and __creature__");
  assert.deepEqual([s.rolls, s.libs, s.binds, s.h3], [4, 2, 1, null]);
  const h = stats("@h3 t2va\nSHOT 3s: static\nA.\nNARRATOR (voiceover): Hi\nSHOT 2.5s: cut, arc\nB.\nSFX: wind");
  assert.deepEqual(h.h3, { shots: 2, secs: 5.5, voices: 1, reel: null });
  const r = stats("@h3 ref2va\nCAST\nMAYA (video 1): a woman\nDOG (image 1): a dog\nSHOT 5s\nMAYA waves.\nMAYA (warm): Hi.\nSFX: wind");
  assert.equal(r.h3.voices, 1);
});

test("picks are marked once each, longest first", () => {
  const html = markPicks("a red panda and a panda", [{ value: "red panda" }, { value: "panda" }]);
  assert.equal(html, "a <mark>red panda</mark> and a <mark>panda</mark>");
  assert.equal(markPicks("wax, marble", [{ value: "wax, marble" }]), "<mark>wax</mark>, <mark>marble</mark>");
});

test("glyph is deterministic per key", () => {
  assert.equal(glyph("krea/a", "#fff"), glyph("krea/a", "#fff"));
  assert.notEqual(glyph("krea/a", "#fff"), glyph("krea/b", "#fff"));
  assert.match(glyph("x", "#fff"), /^<svg/);
});

const cards = [
  { name: "krea/tiny", folder: "krea", title: "Tiny world", note: "diorama", tags: ["krea"], text: "", builtin: true },
  { name: "stills/forest", folder: "stills", title: "Forest", note: "", tags: ["moody"], text: "", builtin: false },
  { name: "top", folder: "", title: "Top", note: "", tags: [], text: "", builtin: false },
];

test("preset filters: favorites, recent order, folder, search", () => {
  const fav = new Set(["stills/forest"]);
  const recent = ["top", "krea/tiny"];
  assert.deepEqual(filterPresets(cards, { filter: "fav", favorites: fav }).map(c => c.name), ["stills/forest"]);
  assert.deepEqual(filterPresets(cards, { filter: "recent", recent }).map(c => c.name), ["top", "krea/tiny"]);
  assert.deepEqual(filterPresets(cards, { filter: "f:mine" }).map(c => c.name), ["top"]);
  assert.deepEqual(filterPresets(cards, { filter: "all", search: "DIORAMA" }).map(c => c.name), ["krea/tiny"]);
});

test("picker groups favorites and recents first, folders after", () => {
  const groups = pickerGroups(cards, { query: "", favorites: new Set(["krea/tiny"]), recent: ["top"] });
  assert.deepEqual(groups.map(g => g[0]), ["Favorites", "Recent", "krea", "stills", "mine"]);
  assert.deepEqual(pickerGroups(cards, { query: "forest", favorites: new Set(), recent: [] }).map(g => g[0]), ["stills"]);
});

test("galaxy rows filter by scope, rating and pick", () => {
  const rows = [
    { id: "1", template: "aaa", rating: "love", picks: [{ keys: ["__c__=fox"] }] },
    { id: "2", template: "bbb", rating: null, picks: [{ keys: ["__c__=owl"] }] },
  ];
  assert.deepEqual(filterRows(rows, { scope: "prompt", hash: "bbb" }).map(r => r.id), ["2"]);
  assert.deepEqual(filterRows(rows, { scope: "all", rating: "unrated" }).map(r => r.id), ["2"]);
  assert.deepEqual(filterRows(rows, { scope: "all", rating: "love" }).map(r => r.id), ["1"]);
  assert.deepEqual(filterRows(rows, { scope: "all", pick: "__c__=owl" }).map(r => r.id), ["2"]);
  const owned = [{ id: "1", template: "aaa", preset: "krea/x", rating: null, picks: [] }, { id: "2", template: "bbb", preset: null, rating: null, picks: [] }];
  assert.deepEqual(filterRows(owned, { scope: "preset", preset: "krea/x" }).map(r => r.id), ["1"]);
  assert.deepEqual(filterRows(owned, { scope: "preset", preset: null }).map(r => r.id), []);
});

test("galaxy folders become a tree: parents first, children sorted by name, own counts", () => {
  const tree = folderTree([{ path: "b", count: 2 }, { path: "a/z", count: 1 }, { path: "a", count: 0 }, { path: "a/Y/deep", count: 4 }]);
  const flat = (nodes, depth = 0) => nodes.flatMap((n) => [`${"  ".repeat(depth)}${n.name}:${n.count}`, ...flat(n.children, depth + 1)]);
  assert.deepEqual(flat(tree), ["a:0", "  Y:0", "    deep:4", "  z:1", "b:2"]);
  assert.equal(tree[0].children[0].children[0].path, "a/Y/deep");
});

test("shift-click selects from the anchor to the card, in the order shown", () => {
  const ids = ["a", "b", "c", "d"];
  assert.deepEqual(rangeIds(ids, "b", "d"), ["b", "c", "d"]);
  assert.deepEqual(rangeIds(ids, "d", "b"), ["b", "c", "d"]);
  assert.deepEqual(rangeIds(ids, "gone", "c"), ["c"]);
  assert.deepEqual(rangeIds(ids, null, "a"), ["a"]);
});

test("a folder dropped on a folder nests; on the top level it moves up; never into itself", () => {
  assert.equal(folderDropPath("a/b", "c"), "c/b");
  assert.equal(folderDropPath("a/b", ""), "b");
  assert.equal(folderDropPath("a/b", "a"), null);
  assert.equal(folderDropPath("a", "a/b"), null);
  assert.equal(folderDropPath("a", "a"), null);
  assert.equal(folderDropPath("ab", "a"), "a/ab");
});

test("dials are the bindings, with choices for a library or a brace", () => {
  const d = dials("$hero = __creature[myth]__\n  $mood = {calm|eerie:3}\n$n = {1-2$$a|b}\n$x = a fox\n$hero at dusk");
  assert.deepEqual(d.map((x) => x.name), ["hero", "mood", "n", "x"]);
  assert.deepEqual(d[0], { name: "hero", expr: "__creature[myth]__", lib: "creature", tag: "myth", options: [] });
  assert.deepEqual(d[1].options, ["calm", "eerie"]);
  assert.deepEqual([d[2].lib, d[2].options, d[3].options], [null, [], []]);
});

test("applyDials mirrors orrery's override", () => {
  const t = "$hero = __animal__\n  $place = {a|b}\n$hero in $place";
  assert.equal(applyDials(t, { hero: "owl", place: " " }), "$hero = owl\n  $place = {a|b}\n$hero in $place");
  assert.equal(applyDials(t, {}), t);
});

test("reels: chunk timing, per-chunk lengths, keywords are not voices", () => {
  const reel = "@h3 t2va 16:9\nLORA: <lora:a:1>\ncontext: 22\nCHUNK\nSHOT 5s\nA.\nHANDOFF: b\nSEND: frame 0 to image 3\nCHUNK the hall\nSHOT 3s\nB.\nSHOT 1s\nC.";
  const st = stats(reel);
  assert.deepEqual([st.h3.voices, st.h3.reel], [0, { chunks: 2, secs: [5, 4], repeats: [1, 1], fresh: [true, false], clips: 2 }]);
  const out = shape(reel);
  assert.deepEqual([out.length, out.lengths], [124, [124, 124]]);
  assert.deepEqual(shape(reel.replace("context: 22", "context: 56")).lengths, [124, 158]);
  assert.equal(stats("@h3 t2va\nSHOT 5s\nA.").h3.reel, null);
});

test("reel lines are keywords", () => {
  const html = highlight("CHUNK the hall\nHANDOFF: the door\nLORA: <lora:a:1>\ncontext: 22", known);
  for (const kw of ["CHUNK", "HANDOFF:", "LORA:", "context:"]) assert.match(html, new RegExp(`<span class="t-kw">${kw}`));
});

test("lora tags are coloured as loras, not as libraries, and are not counted", () => {
  const html = highlight("LORA: <lora:bf16__apply__x:1.00> __creature__", known);
  assert.match(html, /<span class="t-lora">&lt;lora:bf16__apply__x:1.00&gt;<\/span>/);
  assert.doesNotMatch(html, /t-miss/);
  assert.deepEqual([stats("LORA: <lora:a__b__c:1.00>").libs, stats("LORA: <lora:a__b__c:1.00>").rolls], [0, 0]);
});

test("repeated chunks count as clips; forever has no end", () => {
  const loop = "@h3 t2va\nCHUNK intro\nSHOT 5s\nA.\nCHUNK walk repeat 8\nSHOT 6s\nB.";
  assert.deepEqual(stats(loop).h3.reel, { chunks: 2, secs: [5, 6], repeats: [1, 8], fresh: [true, false], clips: 9 });
  const forever = stats(loop.replace("repeat 8", "repeat forever")).h3.reel;
  assert.deepEqual([forever.repeats, forever.clips], [[1, Infinity], Infinity]);
});

test("history references are coloured as variables", () => {
  assert.match(highlight("$look~1 walks back", known), /<span class="t-var">\$look~1<\/span>/);
});

test("a binding repeated in several chunks is one dial", () => {
  assert.deepEqual(dials("$a = x\nCHUNK\n$b = __creature__\nCHUNK\n$b = __creature__\n$a = y").map((d) => d.name), ["a", "b"]);
});

test("__name:N__ is a library everywhere; with an LLM an unknown one is to be made", () => {
  assert.match(highlight("a __creature:30__", known), /<span class="t-lib">__creature:30__<\/span>/);
  assert.match(highlight("a __shoes:20__", known), /t-lib t-miss/);
  assert.match(highlight("a __shoes__", known, { llm: true }), /<span class="t-lib t-new" title="[^"]*">__shoes__<\/span>/);
  assert.equal(stats("__creature:30__ and __shoes__").libs, 2);
  assert.deepEqual(dials("$s = __shoes:20__")[0].lib, "shoes");
});

test("libraries group: review first, then folders by prefix, then the rest", () => {
  const lib = (name, extra = {}) => ({ name, entries: [], pending: false, pending_entries: [], ...extra });
  const groups = libraryGroups([lib("couture_form"), lib("animal"), lib("couture_house"), lib("film_scene", { pending: true }),
    lib("bh_route"), lib("style", { pending_entries: ["ink"] }), lib("bh_host"), lib("h3style")]);
  assert.deepEqual(groups.map((g) => [g.key, g.items.map((i) => i.short)]), [
    ["review", ["film_scene", "style"]],
    ["bh", ["host", "route"]],
    ["couture", ["form", "house"]],
    ["", ["animal", "h3style"]],
  ]);
  const withRoot = libraryGroups([lib("curator"), lib("curator_line"), lib("h3style")]);
  assert.deepEqual(withRoot.map((g) => [g.key, g.items.map((i) => i.short)]), [["curator", ["curator", "line"]], ["", ["h3style"]]]);
});

test("directions after a library belong to it", () => {
  assert.match(highlight("__film__(30 words, the set)", known), /<span class="t-lib t-miss">__film__\(30 words, the set\)<\/span>/);
  assert.equal(dials("$s = __film:5__(long)")[0].lib, "film");
});

test("libraries in folders: highlighted, counted, dialed and grouped by their folder", () => {
  const withFilm = new Set([...known, "film/genre"]);
  assert.match(highlight("a __film/genre__ noir", withFilm), /<span class="t-lib">__film\/genre__<\/span>/);
  assert.equal(stats("__film/genre__ and __film/moods:3__").libs, 2);
  assert.equal(dials("$g = __film/genre__")[0].lib, "film/genre");
  const lib = (name) => ({ name, entries: [], pending: false, pending_entries: [] });
  const groups = libraryGroups([lib("film/genre"), lib("style"), lib("film/moods"), lib("couture_form"), lib("couture_house")]);
  assert.deepEqual(groups.map((g) => [g.key, g.items.map((i) => i.short)]),
    [["couture", ["form", "house"]], ["film", ["genre", "moods"]], ["", ["style"]]]);
});

test("property filters are part of a library everywhere", () => {
  const withPeople = new Set([...known, "characters/cyberpunk"]);
  assert.match(highlight("a __characters/cyberpunk#gender:female__ runs", withPeople),
    /<span class="t-lib">__characters\/cyberpunk#gender:female__<\/span>/);
  assert.equal(stats("__characters/cyberpunk#gender:female#age:30s:2__").libs, 1);
  assert.equal(dials("$hero = __characters/cyberpunk#gender:female__")[0].lib, "characters/cyberpunk");
});

test("a big library shows a page at a time, and a search shows only matching entries", () => {
  const entries = Array.from({ length: 7071 }, (_, i) => ({ value: i === 4242 ? "neon pink tee" : `prompt ${i}`, tags: [] }));
  const page = entryPage(entries, { name: "pyro/general_prompts" });
  assert.equal(page.rows.length, 200); assert.equal(page.total, 7071);
  assert.equal(entryPage(entries, { name: "pyro/general_prompts", shown: 400 }).rows.length, 400);
  const hit = entryPage(entries, { name: "pyro/general_prompts", query: "Neon" });
  assert.deepEqual([hit.total, hit.rows[0].i], [1, 4242]);
  assert.equal(entryPage(entries, { name: "pyro/general_prompts", query: "general" }).total, 7071);  // the name matched
});

test("dynamic prompts weights are no part of a dial's choices", () => {
  assert.deepEqual(dials("$c = {3::red|1::blue|green}")[0].options, ["red", "blue", "green"]);
});

test("a property of a binding is coloured as part of the variable", () => {
  assert.match(highlight("steps: $w.sfx", known), /<span class="t-var">\$w\.sfx<\/span>/);
});

test("generate finds the output nodes downstream of the orrery node, and whether Orrery Log is there", () => {
  const nodes = [
    { id: 9, type: "OrreryPrompt", output: false, targets: [12, 20] },
    { id: 12, type: "CLIPTextEncode", output: false, targets: [30] },
    { id: 20, type: "EmptyImage", output: false, targets: [31] },
    { id: 30, type: "KSampler", output: false, targets: [31] },
    { id: 31, type: "SaveImage", output: true, targets: [] },
    { id: 40, type: "SaveImage", output: true, targets: [] },  // not downstream
  ];
  assert.deepEqual(downstream(nodes, 9), { outputs: [31], log: false });
  nodes[0].targets.push(41); nodes.push({ id: 41, type: "OrreryLog", output: true, targets: [] });
  assert.deepEqual(downstream(nodes, 9), { outputs: [31, 41], log: true });
});

test("a library's line in the list counts its entries and what waits for review, without carrying them", () => {
  const lib = { name: "film/genre", source: "user", entries: [{ value: "noir" }, { value: "western" }], tags: ["dark"],
    pending: false, pending_entries: ["western"], directions: "" };
  const head = libraryHead(lib);
  assert.deepEqual(head, { name: "film/genre", source: "user", count: 2, tags: ["dark"], pending: false, pending_count: 1, directions: "" });
  assert.equal(libraryGroups([head, libraryHead({ ...lib, name: "style", pending_entries: [] })])[0].key, "review");  // the count is enough
});

test("a sweep holds the seed for its runs, steps it between seeds and once after the last run", async () => {
  const sweep = async (mode, seeds, stopAfter = Infinity) => {
    let seed = 100, ran = 0;
    const used = [];
    const queued = await queueSweep({
      count: 3, seeds, mode, getSeed: () => seed, setSeed: (s) => { seed = s; },
      queue: async (i) => { used.push([seed, i]); ran++; }, live: () => ran < stopAfter,
    });
    return { queued, used, seed };
  };
  const inc = await sweep("increment", 2);
  assert.equal(inc.queued, 6);
  assert.deepEqual(inc.used, [[100, 0], [100, 1], [100, 2], [101, 0], [101, 1], [101, 2]]);
  assert.equal(inc.seed, 102);  // the next Roll starts on a seed of its own
  assert.equal((await sweep("fixed", 2)).seed, 100);
  const rnd = await sweep("randomize", 1);
  assert.deepEqual(rnd.used.map(([s]) => s), [100, 100, 100]);  // one character from every side
  assert.notEqual(rnd.seed, 100);
  const stopped = await sweep("increment", 3, 4);  // Stop after four runs: still a seed of its own next
  assert.deepEqual([stopped.queued, stopped.seed], [4, 102]);
  assert.equal(await queueSweep({ count: 2, seeds: 1, mode: "increment", getSeed: () => 7, setSeed: () => assert.fail(), queue: async () => {}, live: () => false }), 0);
  assert.equal(nextSeed(0, "decrement"), 0);
});

test("# lines are comments: grey, and nothing in them rolls, counts or opens a screenplay", () => {
  const src = "# Quickstart: __ideas__ and $x = __animal__\n@h3 t2va 16:9 0.6MP\n# SHOT 9s: pan left\nSHOT 5s: static\nA fox.";
  assert.match(highlight(src, new Set()), /<span class="t-comment"># Quickstart: __ideas__ and \$x = __animal__<\/span>/);
  const st = stats(src);
  assert.deepEqual([st.rolls, st.libs, st.binds, st.h3.shots, st.h3.secs], [0, 0, 0, 1, 5]);
  assert.deepEqual([shape(src).width, shape(src).height], [1024, 576]);
  assert.deepEqual(dials(src), []);
});

test("every New template opens with a quickstart and its dials come from code, not from comments", async () => {
  const { STARTERS } = await import("../../comfyui/web/app/starters.js");
  for (const [kind, s] of Object.entries(STARTERS)) {
    assert.match(s.text, /^# .+quickstart/i, kind);
    const code = s.text.split("\n").filter((l) => l && !l.startsWith("#"));
    assert.ok(code.length > 1, kind);
    assert.equal(dials(s.text).length, dials(code.join("\n")).length, kind);
    if (s.target === "h3-base") assert.ok(stats(s.text).h3, kind);
  }
  assert.equal(stats(STARTERS.reel.text).h3.reel.chunks, 2);
});


const REEL_TEXT = `@h3 t2va 16:9
# CHUNK in a comment is no chunk
CHUNK the opening
SHOT 5s: push in
A.
CHUNK the walk repeat 4
SHOT 4s: static
B.
SHOT 1s: cut
C.
CHUNK the end
SHOT 10s: static
D.`;

test("every CHUNK line knows its segments, where it sits in the film and what is left", () => {
  const info = chunkInfo(REEL_TEXT);
  assert.deepEqual(info.map((c) => [c.line, c.first, c.last, c.secs, c.start, c.end, c.left]),
    [[2, 0, 0, 5, 0, 5, 30], [5, 1, 4, 5, 5, 25, 10], [10, 5, 5, 10, 25, 35, 0]]);
  assert.equal(chunkLabel(info[0]), "clip 1 · 0:00 → 0:05 · 0:30 left");
  assert.equal(chunkLabel(info[1]), "clips 2–5 · 4 × 5 s · 0:05 → 0:25 · 0:10 left");
  assert.equal(chunkLabel(info[2]), "clip 6 · 0:25 → 0:35 · the end");
  assert.equal(chunkInfo("@h3 t2va\nSHOT 5s\nA."), null);
  const sends = chunkInfo("CHUNK a\nSHOT 5s\nSEND: frame 0 to image 1\nSEND: frames -1 to image 3 for segment 4+\nSEND: frame 9 to image 1 for segment 9\nA.");
  assert.deepEqual(sends[0].images, [1, 3]);
  assert.deepEqual(chunkInfo("SCENE a\nSHOT 5s\nREMEMBER: first frame as image 2\nA.")[0].images, [2]);
});

test("SCENE, ×N and forever give what CHUNK and repeat gave, and CUT TO: walks the reel as GOTO: did", () => {
  const film = REEL_TEXT.replaceAll("CHUNK", "SCENE").replace("repeat 4", "×4");
  const fields = (info) => info.map((c) => [c.line, c.title, c.repeat, c.first, c.last, c.secs, c.label]);
  assert.deepEqual(fields(chunkInfo(film)), fields(chunkInfo(REEL_TEXT)));
  assert.deepEqual(splitCells(film).map((c) => [c.line, c.chunk]), splitCells(REEL_TEXT).map((c) => [c.line, c.chunk]));
  assert.equal(stats(film).h3.reel.clips, 6);
  assert.deepEqual(chunkInfo("SCENE a forever\nSHOT 5s\nA.\nSCENE the 4x4 room\nSHOT 5s\nB.").map((c) => [c.title, c.repeat]),
    [["a", Infinity], ["the 4x4 room", 1]]);
  assert.ok(hasGoto("SCENE a\nSHOT 5s\nA.\nCUT TO: a ×2") && hasGoto("? $w[rain]: CUT TO: a") && !hasGoto("SCENE a\nSHOT 5s\nA."));
});

test("a test scene starts afresh, and so does the first scene after only tests: no pinned context", () => {
  const reel = "@h3 text\ncontext: 22\nSCENE forest (test)\nSHOT 5s\nA.\nSCENE beach (test)\nAFTER: forest\nSHOT 5s\nB.\n"
    + "SCENE walk\nSHOT 5s\nC.\nSCENE end\nSHOT 5s\nD.\nSCENE dune (test)\nSHOT 5s\nE.";
  assert.deepEqual(stats(reel).h3.reel.fresh, [true, false, true, false, true]);
  const [a, b, c, d, e] = shape(reel).lengths;
  assert.ok(b > a && c === a && d > a && e === a, `${a} ${b} ${c} ${d} ${e}`);
  assert.deepEqual(chunkInfo(reel).map((x) => x.title), ["forest", "beach", "walk", "end", "dune"]);
});

test("a chunk that repeats forever runs on, and the ones after it never play", () => {
  const info = chunkInfo("CHUNK a\nSHOT 5s\nA.\nCHUNK b repeat forever\nSHOT 6s\nB.\nCHUNK c\nSHOT 5s\nC.");
  assert.equal(chunkLabel(info[1]), "clip 2 → ∞ · 6 s each · from 0:05");
  assert.equal(chunkLabel(info[2]), "never plays: a scene before it repeats forever");
  assert.equal(chunkLabel(info[0]), "clip 1 · 0:00 → 0:05");
});

test("the film words are keywords, and a CAST member is brass, with @ or without, also in SET: and speech", () => {
  const text = "@h3 references\nCAST\n@JINX (refmod x): a woman\nSCENE the room (test)\nAFTER: 2\nSTART WITH: the door\nSHOT 5s\n"
    + "@JINX waves, JINXED stays.\nJINX (whispering): hi\nIF $m is tense: she runs\nREMEMBER: first frame as @JINX\n"
    + "SET: @JINX(0.6, refmods), @style(0.8)\nEND ON: done\nCUT TO: the room (30%)";
  const html = highlight(text, new Set());
  for (const kw of ["SCENE", "AFTER:", "START WITH:", "IF", "REMEMBER:", "SET:", "END ON:", "CUT TO:"]) assert.match(html, new RegExp(`<span class="t-kw">${kw}</span>`));
  assert.match(html, /<span class="t-cast">@JINX<\/span> waves, JINXED stays/);
  assert.match(html, /<span class="t-kw"><span class="t-cast">JINX<\/span> \(whispering\):<\/span>/);
  assert.match(html, /<span class="t-cast">@JINX<\/span>\(0\.6, refmods\), <span class="t-lora">@style\(0\.8\)<\/span>/);
  assert.doesNotMatch(highlight("a cat @JINX(0.6)", new Set()), /t-cast/);  // no CAST: a LoRA
});

test("CHUNK lines get a divider with their label, and the next segment's chunk is marked", () => {
  const info = chunkInfo(REEL_TEXT);
  const html = highlight(REEL_TEXT, new Set(), { chunks: info, segment: 2 });
  assert.equal(html.split("\n").length, REEL_TEXT.split("\n").length);  // no extra lines: the caret stays put
  // the divider names one clip (#219); its whole label is its hover
  assert.match(html, /<span class="chunkline"><span class="chunkinfo"><span title="clip 1 · 0:00 → 0:05 · 0:30 left">played as clip 1 · 5 s<\/span><\/span><span class="t-kw">CHUNK<\/span> the opening<\/span>/);
  assert.match(html, /<span class="chunkline now"><span class="chunkinfo"><span title="next 2\/4 · clips 2–5 [^"]*">▶ next: clip 3 · 5 s<\/span><\/span><span class="t-kw">CHUNK<\/span> the walk repeat 4/);
  assert.doesNotMatch(highlight(REEL_TEXT, new Set()), /chunkinfo/);
});

test("the cells view splits a reel at its CHUNK lines, and joining the cells gives the text back", () => {
  const cells = splitCells(REEL_TEXT);
  assert.deepEqual(cells.map((c) => [c.line, c.chunk, c.text.split("\n")[0]]),
    [[0, -1, "@h3 t2va 16:9"], [2, 0, "CHUNK the opening"], [5, 1, "CHUNK the walk repeat 4"], [10, 2, "CHUNK the end"]]);
  assert.equal(cells.map((c) => c.text).join("\n"), REEL_TEXT);
  const bare = "CHUNK a\nSHOT 5s\n  CHUNK b\n";
  assert.deepEqual(splitCells(bare).map((c) => [c.chunk, c.text]), [[0, "CHUNK a\nSHOT 5s"], [1, "  CHUNK b\n"]]);
  assert.deepEqual(splitCells("no chunks\nhere"), [{ line: 0, chunk: -1, text: "no chunks\nhere" }]);
});

test("the Write menu greys a writer only without a language model; the sheet says the rest (#334)", () => {
  const app = (text, { llm = true, frames = [] } = {}) => ({ text, llmActive: () => llm, bridge: { frames: () => frames } });
  const fl2va = "@h3 fl2va 16:9\nSHOT 5s\nA.";
  assert.match(writerBlock(app(fl2va, { llm: false }), "continue"), /language model/);
  for (const task of ["continue", "story", "describe"]) {
    assert.equal(writerBlock(app("a photo of a fox"), task), "");  // no reel, no frames: it opens anyway
    assert.equal(writerBlock(app(fl2va), task), "");
  }
});

test("a scene's + take renders the clip it plays next, else its first (#204)", async () => {
  const { chunkInfo, sceneTarget } = await import("../../comfyui/web/app/model.js");
  const reel = "@h3 t2va\nSCENE a\nSHOT 5s\nA.\nSCENE b ×3\nSHOT 5s\nB.\nSCENE c forever\nSHOT 5s\nC.";
  const [a, b] = chunkInfo(reel);
  assert.equal(sceneTarget(a, 2), 0);  // the next clip is elsewhere: the scene's first
  assert.equal(sceneTarget(b, 2), 2);  // the scene plays the next clip: that one
  assert.equal(sceneTarget(b, 0), 1);
});

test("sample surfing numbers its takes on from the ones a clip has, or follows the seed's control (#206)", async () => {
  const { surfSeeds } = await import("../../comfyui/web/app/prompt.js");
  const app = (takes, { control = "fixed", numbered = true, clips = [] } = {}) => ({
    data: { chain: { takes, clips }, surf_numbered: numbered }, bridge: { getSeed: () => 100, getControl: () => control } });
  assert.deepEqual(surfSeeds(app({}), 2, 4, true), [0, 1, 2, 3]);  // a clip not rendered yet: the plain take first
  assert.deepEqual(surfSeeds(app({}, { clips: [{ segment: 2 }] }), 2, 2, true), [1, 2]);  // its one clip is take 0
  assert.deepEqual(surfSeeds(app({ 2: [{ take: 0, seed: 100 }, { take: 3, seed: 100 }] }), 2, 2, true), [4, 5]);
  assert.deepEqual(surfSeeds(app({ 2: [{ take: 0, seed: 100 }, { take: 0, seed: 102 }] }), 2, 2, false), [3, 4]);  // seeds, rolled anew
  assert.deepEqual(surfSeeds(app({}, { numbered: false, control: "fixed" }), 2, 2, true), [0, 0]);  // the same take again
  const random = surfSeeds(app({}, { numbered: false, control: "randomize" }), 2, 3, true);
  assert.equal(new Set(random).size, 3);
});

test("a scene that plays no clip says why: the walk not known yet, not reached, or after a forever (#210)", async () => {
  const { sectionHTML } = await import("../../comfyui/web/app/timeline.js");
  const app = (walked) => ({ reelPath: () => walked });
  assert.match(sectionHTML(app(null), { first: null, segs: [] }), /walking the reel at this seed/);
  assert.match(sectionHTML(app({ path: [0, 2] }), { first: null, segs: [] }), /walk does not reach it/);
  assert.match(sectionHTML(app(null), { first: null }), /a scene before it repeats forever/);
});

test("a scene shows its clips as their strips of takes, no box of the clip above them (#331)", async () => {
  const { sectionHTML } = await import("../../comfyui/web/app/timeline.js");
  const take = { folder: "seg_0000_aaaaaaaa", seed: 1010, active: true, created: "2026-10-05T05:13:00.1+02:00" };
  const app = { text: "", state: {}, data: { chain: { width: 736, height: 768, clips: [{ segment: 0, version: take.folder, frames: 243 }], takes: { 0: [take] } } },
    bridge: { chain: () => "reels/x", getSegment: () => 1, props: {} }, api: { takeThumbURL: (c, f) => `/thumb/${f}` } };
  const html = sectionHTML(app, { index: 0, first: 0, segs: [0] });
  assert.doesNotMatch(html, /tl-clip|cm-clips|<video/);
  assert.match(html, /class="cm-takes" data-seg="0".*<i>takes<\/i><b>1<\/b>.*<i>circled<\/i><b>#1<\/b>.*class="take on" data-take="seg_0000_aaaaaaaa"/s);
});

test("Write now counts the libraries a template still needs, as autolib does", () => {
  const libs = [{ name: "animal", count: 3 }, { name: "style", count: 2 }];
  const text = "# __commented__\na __animal:5__ in __style__ by __makers/new__ <lora:__x__:1>\n__style:2__ \\__escaped__ __clothing/*__ __mine__";
  assert.deepEqual(openLibraries(text, libs, new Set(["mine"])), ["animal", "makers/new"]);
  assert.deepEqual(openLibraries("__animal[tag=a]#k:v:2__ and __style__", libs), []);
});

test("tag algebra, brace options and the LoRA short form mirror the expander", () => {
  assert.ok(tagsMatch("myth,!bird", ["myth"]) && !tagsMatch("myth,!bird", ["myth", "bird"]));
  assert.ok(tagsMatch("water|deep_sea", ["deep_sea"]) && !tagsMatch("water|deep_sea", ["myth"]) && tagsMatch(null, []));
  assert.deepEqual(splitOptions("__a[x|y]__|b"), ["__a[x|y]__", "b"]);
  assert.equal(longForm("@ink(0.8) @include x @h3(1)"), "<lora:ink:0.8> @include x @h3(1)");
  const html = highlight("a __creature[myth,!bird]__ @ink(0.4-0.9)", known);
  assert.match(html, /<span class="t-lib">__creature\[myth,!bird\]__<\/span>/);
  assert.match(html, /<span class="t-lora">@ink\(0\.4-0\.9\)<\/span>/);
  assert.deepEqual(dials("$s = {0.4-0.9}\n$t = {a|__b[x|y]__}").map((d) => d.options), [[], ["a", "__b[x|y]__"]]);
});



test("a backslash keeps a character from being syntax, in the editor too", () => {
  const html = highlight("\\{a|b\\} \\__init__ __creature__ \\@x(1)", known);
  assert.match(html, /<span class="t-esc"[^>]*>\\\{<\/span>/);
  assert.doesNotMatch(html, /t-lib[^"]*">__init__/);
  assert.equal(longForm("\\@x(1) @y(2)"), "\\@x(1) <lora:y:2>");
});

test("a run made before every pick had its own dice replays with @rng 1", () => {
  assert.equal(withDice("a __creature__", {}), "@rng 1\na __creature__");
  assert.equal(withDice("a __creature__", { rng: 2 }), "a __creature__");
  assert.equal(withDice("@rng 1\na __creature__", {}), "@rng 1\na __creature__");
});

test("the predicate language mirrors the expander for the dials", () => {
  const e = { tags: ["myth"], props: { habitat: "Sea", size: "small" } };
  assert.ok(matches("myth, habitat=sea", e.tags, e.props) && matches("size=large|small", e.tags, e.props));
  assert.ok(!matches("myth, !habitat=sea", e.tags, e.props) && !matches("size!=small", e.tags, e.props));
  assert.ok(matches("habitat=$a.habitat", e.tags, e.props));  // a roll the browser cannot know holds
  assert.match(highlight("a __creature[myth, habitat=$a.habitat]__", known), /class="t-lib">__creature\[myth, habitat=\$a\.habitat\]__/);
});

test("directives: @size shapes the node, @seed and @batch are the CLI's, @rng 1 goes under @h3", () => {
  assert.deepEqual([shape("@h3 t2va 16:9\n@size 832x1216\nSHOT 5s\nA.").width, shape("@size 832x1216\na fox").height], [832, 1216]);
  assert.deepEqual(shape("a fox\n@seed 100\n@batch 8").cli, ["@seed 100", "@batch 8"]);
  assert.match(highlight("@batch 8", known), /t-cli/);
  assert.equal(withDice("@h3 t2va\nSHOT 5s\nA.", {}), "@h3 t2va full\n@rng 1\nSHOT 5s\nA.");  // the format of back then too
  assert.equal(withDice("@h3 t2va lite\nSHOT 5s\nA.", { rng: 2 }), "@h3 t2va lite\nSHOT 5s\nA.");
  assert.equal(withDice("@h3 t2va\nSHOT 5s\nA.", { rng: 2, format: "lite" }), "@h3 t2va\nSHOT 5s\nA.");
  assert.equal(withDice("@h3 t2va\nSHOT 5s\nA.", { rng: 2 }), "@h3 t2va full\nSHOT 5s\nA.");
});

test("a chance is on or off, not a list for the dials", () => {
  assert.deepEqual(dials("$r = {30% in the rain}\n$c = {30% off|half price}").map((d) => d.options), [[], ["30% off", "half price"]]);
});

test("a glob is a known library when it matches one", () => {
  const libs = new Set(["clothing/hats", "creature"]);
  assert.match(highlight("__clothing/*__", libs), /class="t-lib">__clothing\/\*__/);
  assert.match(highlight("__shoes/*__", libs), /t-miss/);
});

test("Generate asks the server for a plan only when there may be one", () => {
  for (const t of ["<lora:a:0.5,1.0>", "<lora:a:0-1;0.1>", "<lora:a:1:solo>", "<lora:a:test>", "@x(0.5,1.0)", "a\n@grid __s__", "a\n: grid {x|y}"]) {
    assert.ok(PLAN_HINT.test(t), t);
  }
  for (const t of ["a cat <lora:b:0.8>", "<lora:x:0.4-0.9>", "@x(0.8)", "a grid of tiles"]) assert.ok(!PLAN_HINT.test(t), t);
});


test("with GOTO lines the chunks follow the path the server walked", () => {
  const text = "@h3 t2va\nCHUNK the gate\nSHOT 5s\nA.\nCHUNK the stairs\nSHOT 4s\nB.\nCHUNK the lamp\nSHOT 6s\nC.\nGOTO: the stairs ×2";
  assert.ok(hasGoto(text) && !hasGoto("@h3 t2va\nCHUNK a\nSHOT 5s\nA."));
  assert.match(chunkInfo(text)[1].label, /walking the reel/);  // the path is not there yet
  const walked = chunkInfo(text, { path: [0, 1, 2, 1, 2, 1, 2], ended: true });
  assert.deepEqual(walked.map((c) => c.segs), [[0], [1, 3, 5], [2, 4, 6]]);
  assert.equal(walked[1].label, "clips 2, 4, 6 · 3 × 4 s · from 0:05 · 0:06 left");  // left after its last play
  assert.ok(plays(walked[2], 4) && !plays(walked[2], 3) && plays(chunkInfo("CHUNK a\nSHOT 5s\nA.")[0], 0));
  const endless = chunkInfo(text, { path: [0, 1, 2, 1, 2], ended: false });
  assert.match(endless[2].label, /^clips 3, 5, … · 2\+ × 6 s/);
  const html = highlight(text, known, { chunks: walked, segment: 3 });
  assert.match(html, /title="next 2\/3 · clips 2, 4, 6 [^"]*">▶ next: clip 4 · 4 s</);
  assert.match(html, />comes next as clip 5 · 6 s</);
});

test("a dial's menu lists every choice while the box holds one of them, and filters what is typed (#155)", async () => {
  const { menuItems } = await import("../../comfyui/web/app/dialmenu.js");
  const choices = ["everyday", "adventure", "fantasy", "cyberpunk", "spacefarer"];
  assert.deepEqual(menuItems(choices, ""), choices);
  assert.deepEqual(menuItems(choices, "spacefarer"), choices);  // the datalist showed only this one
  assert.deepEqual(menuItems(choices, "SpaceFarer "), choices);
  assert.deepEqual(menuItems(choices, "an"), ["fantasy"]);
  assert.deepEqual(menuItems(choices, "zz"), []);
});

test("a picture's sheet lists what it exported: texts, lists and an entry's fields (#160)", async () => {
  const { exportRows } = await import("../../comfyui/web/app/model.js");
  assert.deepEqual(exportRows({ who: "a tall heron", skills: ["fishing", "waiting"], job: { value: "a ferryman", tool: "a long pole" } }), [
    { name: "who", value: "a tall heron", items: [], fields: [] },
    { name: "skills", value: null, items: ["fishing", "waiting"], fields: [] },
    { name: "job", value: "a ferryman", items: [], fields: [["tool", "a long pole"]] },
  ]);
  assert.deepEqual(exportRows(undefined), []);
});

test("a dial ticks several choices into one that rolls among them (#156)", async () => {
  const { chosen, joinChoices, menuItems } = await import("../../comfyui/web/app/dialmenu.js");
  const genres = ["everyday", "noir", "gothic", "spacefarer"];
  assert.deepEqual(chosen(genres, "{noir|gothic}"), ["noir", "gothic"]);
  assert.deepEqual(chosen(genres, "Noir"), ["noir"]);
  assert.deepEqual(chosen(genres, "{noir|western}"), []);  // not all of them are choices: it is an expression
  assert.deepEqual(menuItems(genres, "{noir|gothic}"), genres);  // every choice stays listed to tick more
  const origins = ["Tamil descent, with {deep brown|dark brown} skin", "Greek descent"];
  assert.deepEqual(chosen(origins, `{${origins[0]}|${origins[1]}}`), origins);  // a choice with its own braces
  assert.equal(joinChoices([]), "");
  assert.equal(joinChoices(["noir"]), "noir");
  assert.equal(joinChoices(["noir", "gothic"]), "{noir|gothic}");
});

test("the dial menu's filter reads a choice's text, properties and tags, as a regex or as plain text (#186)", async () => {
  const { filterChoices, matchedBy, filterPattern } = await import("../../comfyui/web/app/dialmenu.js");
  const outfits = { "a trench coat": { props: { genre: "noir", fit: "all" }, tags: ["coat"] },
    "a corset gown": { props: { genre: "gothic", fit: "women" }, tags: [] }, "a flight suit": { props: { genre: "spacefarer" }, tags: ["space"] } };
  const names = Object.keys(outfits), info = (c) => outfits[c];
  assert.deepEqual(filterChoices(names, "noir|gothic", info), ["a trench coat", "a corset gown"]);
  assert.deepEqual(filterChoices(names, "^genre=goth", info), ["a corset gown"]);
  assert.deepEqual(filterChoices(names, "fit: women", info), ["a corset gown"]);
  assert.deepEqual(filterChoices(names, "SPACE", info), ["a flight suit"]);  // case-insensitive, a tag
  assert.deepEqual(filterChoices(names, "suit", info), ["a flight suit"]);
  assert.deepEqual(filterChoices(names, "coat (", info), []);  // no regex: plain text, which nothing holds
  assert.deepEqual(filterChoices(names, "  ", info), names);
  assert.deepEqual(filterChoices(["noir", "gothic"], "oi"), ["noir"]);  // a choice list without properties
  const rx = filterPattern("noir");
  assert.equal(matchedBy("a trench coat", rx, info), "genre: noir");
  assert.equal(matchedBy("noir", rx), "");
  assert.equal(matchedBy("a corset gown", rx, info), null);
});

test("a tick in a dial's menu keeps the list where it was, the choice ticked where it was on screen (#300)", async () => {
  const { keptScroll } = await import("../../comfyui/web/app/dialmenu.js");
  // scrolled 400 down, the ticked choice 520 into the list: 120 below the box's top edge
  assert.equal(keptScroll({ top: 400, anchor: 520 }, 520), 400);  // nothing moved: the same place
  assert.equal(keptScroll({ top: 400, anchor: 520 }, 546), 426);  // the "2 chosen" note came in above: down with it
  assert.equal(keptScroll({ top: 400, anchor: 546 }, 520), 374);  // and went again
  assert.equal(keptScroll({ top: 400, anchor: null }, 520), 400);  // All or None: no choice to follow, the old position
  assert.equal(keptScroll({ top: 400, anchor: 520 }, null), 400);  // the choice left the list
  assert.equal(keptScroll({ top: 10, anchor: 40 }, 0), 0);  // never above the top
});

test("annotations sit at the ends of the lines they belong to (#163)", async () => {
  const { annotationLines, mergeHints } = await import("../../comfyui/web/app/annotate.js");
  const text = ["$colour = __colours__", "$backdrop = a grey wall", "EXPORT:", "  mood = __moods__", "  $who", "EXPORT: $a, $b",
    "@grid $view", "@h3 references", "CAST", "@HERO (image $hero): $hero.who", "SHOT 5s: static", "HERO waits."].join("\n");
  const ann = { bindings: { colour: "violet", backdrop: "a grey wall" }, exports: { mood: "restless", who: "a heron", a: "1", b: "2" },
    grid: "4 runs: portrait · profile", cast: { HERO: "images 6–9 · krea/x/7" } };
  const got = Object.fromEntries([...annotationLines(text, ann)].map(([i, h]) => [i, h.text]));
  assert.deepEqual(got, { 0: "= violet", 3: "→ restless", 4: "→ a heron", 5: "→ 1  → 2", 6: "→ 4 runs: portrait · profile",
    9: "→ images 6–9 · krea/x/7" });  // the plain backdrop says itself; HERO waits. is no CAST line
  const merged = mergeHints(new Map([[0, { text: "frames → image 3" }]]), annotationLines(text, ann));
  assert.equal(merged.get(0).text, "frames → image 3");  // REMEMBER's hint wins
});

test("hover knows each keyword's forms and a picture's dials (#136, #147)", async () => {
  const { keywordHelp, directiveHelp, dialText } = await import("../../comfyui/web/app/hover.js");
  assert.equal(keywordHelp("REMEMBER:").word, "REMEMBER:");
  assert.ok(keywordHelp("REMEMBER:").forms.some(([f]) => f === "REMEMBER: frames 0, 50 as @NAME"));
  assert.equal(keywordHelp("SHOT 5s:").word, "SHOT");
  assert.equal(keywordHelp("IF").word, "IF");
  assert.equal(keywordHelp("EXPORT:").word, "EXPORT:");
  assert.equal(keywordHelp("style:").word, "style:");
  assert.equal(keywordHelp("@HERO (image 1):"), null);  // a CAST member's head is no keyword
  assert.equal(directiveHelp("@grid").word, "@grid");
  assert.equal(dialText({ strength: 0.6, from: 0.35, to: 1 }), "at 0.6 from 35%");
  assert.equal(dialText({ strength: 1 }), "");
});

test("a CAST line with gallery pictures shows them after it (#137)", async () => {
  const { annotationLines } = await import("../../comfyui/web/app/annotate.js");
  const ann = { cast: { HERO: "images 8–9 · krea/x/7" }, members: { HERO: { pictures: [{ image: 8, id: "a1" }, { image: 9, id: "a2" }] } } };
  const hint = annotationLines("CAST\n@HERO (image krea/x/7): a heron\nSHOT 5s", ann, (id) => `/t/${id}`).get(1);
  assert.deepEqual(hint.thumbs, ["/t/a1", "/t/a2"]);
});

test("a CAST line's note says nothing the line says itself", async () => {
  const { annotationLines, slotsText } = await import("../../comfyui/web/app/annotate.js");
  assert.equal(slotsText([9, 6, 7, 8]), "images 6–9");
  assert.equal(slotsText([2, 5]), "images 2, 5");
  const ann = { cast: { PLACE: "image 1", HERO: "image 9 · krea/x/7" } };
  const notes = annotationLines("CAST\n@PLACE (image 1): a street\n@HERO (image krea/x/7): a heron", ann);
  assert.deepEqual([...notes.keys()], [2]);
});

test("a scene is highlighted again only when something it shows changed (#218)", async () => {
  const { paintCells } = await import("../../comfyui/web/app/cells.js");
  const text = "@h3 text\n$x = __place__\n\nSCENE one\nSHOT 5s: static\nA room.\n\nSCENE two\nSHOT 5s: static\nA hall.\n";
  const writes = [];
  const cells = splitCells(text).map((_, i) => {
    const pre = { set innerHTML(_html) { writes.push(i); } };
    return { querySelector: () => pre };
  });
  const host = { querySelectorAll: (sel) => (sel === ".cell" ? cells : []) };
  let libraries = new Set(["place"]);
  const app = {
    text, view: { querySelector: () => host }, chunks: () => [], bridge: { getSegment: () => 0 }, remembered: () => null,
    annotations: () => null, known: () => libraries, llmActive: () => false, api: { thumbURL: () => "" }, data: {},
  };
  paintCells(app);
  assert.deepEqual(writes, [0, 1, 2]);
  writes.length = 0;
  paintCells(app);  // nothing changed: nothing is written
  assert.deepEqual(writes, []);
  app.text = text.replace("A hall.", "A long hall.");
  paintCells(app);  // only the scene typed in
  assert.deepEqual(writes, [2]);
  writes.length = 0;
  libraries = new Set(["place", "creature"]);
  paintCells(app);  // a library more: every scene may show it
  assert.deepEqual(writes, [0, 1, 2]);
});

test("deleting a take asks what it does: another take plays, or the film ends before the clip (#214)", async () => {
  const { deleteQuestion } = await import("../../comfyui/web/app/timeline.js");
  const host = (folder) => ({ dataset: { seg: "1" }, querySelector: () => ({ dataset: { del: folder } }) });
  const takes = [{ folder: "a", active: false }, { folder: "b", active: false }, { folder: "c", active: true }];
  const app = { data: { chain: { takes: { 1: takes } } } };
  assert.equal(deleteQuestion(app, host("a")), "Delete take 1?");
  assert.equal(deleteQuestion(app, host("c")), "Delete this take? Clip 2 then plays take 2.");
  assert.equal(deleteQuestion({ data: { chain: { takes: {} } } }, host("c")), "Delete clip 2? The film ends before it.");
});

test("a scene in numbers: where and how often it plays, before and after, what it rolls, what it made (#219)", async () => {
  const { sceneStats, sceneStatsHTML } = await import("../../comfyui/web/app/scenestats.js");
  const text = "@h3 text\nSCENE the gate\nSHOT 5s: static\nA gate.\nCUT TO: the stairs\n\nSCENE the stairs\n$step = __place__\n$mood = {calm|grim}\n"
    + "$luck = {40% lucky}\nSHOT 4s: static\nStairs.\nIF $mood is grim: CUT TO: the lamp\nCUT TO: the lamp\n\nSCENE the lamp\nSHOT 6s: static\nA lamp.\nCUT TO: the stairs\n";
  const walked = { path: [0, 1, 2, 1, 2, 1, 2], ended: true };
  const app = {
    text, chunks: () => chunkInfo(text, walked), reelPath: () => walked, bridge: { getSegment: () => 3, getSeed: () => 7 },
    data: { completion: { libraries: [{ name: "place", count: 12 }] }, chain: { clips: [{ segment: 1 }, { segment: 3 }], takes: { 1: [{}, {}, {}] } } },
  };
  const s = sceneStats(app, 1);
  assert.deepEqual(s.plays, [1, 3, 5]);
  assert.equal(s.times, "3");
  assert.deepEqual(s.before, [["the lamp", 2], ["the gate", 1]]);
  assert.deepEqual(s.after, [["the lamp", 3]]);
  assert.deepEqual(s.steers, ["IF $mood is grim: CUT TO: the lamp", "CUT TO: the lamp"]);
  assert.deepEqual(s.rolls.map((r) => [r.name, r.count, r.lib, r.chance]), [["step", 12, true, null], ["mood", 2, false, null], ["luck", null, false, 40]]);
  assert.deepEqual(s.made, [{ clip: 2, takes: 3 }, { clip: 4, takes: 1 }]);
  const html = sceneStatsHTML(app, 1);
  assert.match(html, /It plays <b>3<\/b> of the <b>7<\/b> clips of the film/);
  assert.equal((html.match(/<i class="on/g) || []).length, 3);
  assert.match(html, /<i class="on next" title="clip 4: the stairs">/);
  assert.match(html, /<small>a 40 % chance<\/small>/);
  assert.match(html, /<dt>comes after<\/dt><dd>the lamp <b>2×<\/b> · the gate <b>1×<\/b><\/dd>/);
});

test("a knob's sweep plans its runs, and its long forms are opaque like a LoRA tag (#227)", () => {
  for (const t of ["SET: image_1(0.3|0.6)", "SET: jinx(1, 0%, 0%-30%;10%)", "LORA: <refmod:jinx:0.6|0.8>", "LORA: <lora:x:0.6|0.8, 20%>", "@x(0.6|0.8)"]) {
    assert.ok(PLAN_HINT.test(t), t);
  }
  for (const t of ["SET: image_1(0.5, 35%)", "SET: x({0.3|0.6})", "<refmod:jinx:0.8, 0%, 10%>"]) assert.ok(!PLAN_HINT.test(t), t);
  assert.match(highlight("SET: <refmod:jinx_v1:0.8, 0%, 10%>", new Set()), /<span class="t-lora">&lt;refmod:jinx_v1:0\.8, 0%, 10%&gt;<\/span>/);
  assert.equal(longForm("@image_2(0.6) @style(0.8)"), "<image:2:0.6> <lora:style:0.8>");
});

test("the template's knobs, where they hold, written anew and put back (#226)", async () => {
  const { knobsOf, knobKey, withFields, applyKnobs } = await import("../../comfyui/web/app/model.js");
  const text = "@h3 ref2va\nLORA: <lora:turbo:0.8> @style(0.5)\nSET: image_1(0.3|0.6), jinx(1, 0%, 10%)\nCAST\n@JINX (image 1): a woman\n"
    + "SCENE the walk\nSET: turbo(1), @JINX(0.6, refmods), refmods(1, 35%)\nSHOT 5s: static\nx.\n";
  const knobs = knobsOf(text, { loras: ["minimax/turbo.safetensors"], refmods: ["jinx_Video.safetensors"], cast: ["JINX"] });
  assert.deepEqual(knobs.map((k) => [k.scope, k.kind, k.name, k.fields.join(" / ")]), [
    [-1, "lora", "turbo", "0.8"], [-1, "lora", "style", "0.5"], [-1, "image", "image_1", "0.3|0.6"], [-1, "refmod", "jinx", "1 / 0% / 10%"],
    [0, "lora", "turbo", "1"], [0, "cast", "JINX", "0.6 / refmods"],
  ]);
  assert.equal(knobs[4].scene, "the walk");
  assert.equal(withFields(knobs[0], ["0.6", "0%", "50%"]), "<lora:turbo:0.6, 0%, 50%>");
  assert.equal(withFields(knobs[3], ["0.8", "", ""]), "jinx(0.8)");
  assert.equal(withFields(knobs[1], ["0.4"]), "@style(0.4)");
  const turned = applyKnobs(text, { [knobKey(knobs[4])]: "turbo(0.5)", [knobKey(knobs[0])]: "<lora:turbo:0.6>", "~3|gone(1)": "x(2)" });
  assert.match(turned, /LORA: <lora:turbo:0\.6> @style\(0\.5\)/);
  assert.match(turned, /SCENE the walk\nSET: turbo\(0\.5\), @JINX/);
});

test("the take tree lays its takes out as a tidy tree, rows where they were made, and shows the way through a take (#241)", async () => {
  const { layoutTree, wayThrough } = await import("../../comfyui/web/app/tree.js");
  const t = (folder, segment, parent, created) => ({ folder, segment, parent, created });
  const takes = [t("a", 0, null, "1"), t("a1", 1, "a", "2"), t("a1x", 2, "a1", "3"), t("b", 0, null, "4"), t("b1", 1, "b", "5"), t("a2", 1, "a", "6")];
  const rows = layoutTree(takes);
  assert.deepEqual(["a", "a1", "a1x"].map((f) => rows.get(f)), [0, 0, 0]);  // a parent on its first child's row: a path runs straight
  assert.equal(rows.get("a2"), 1);  // a branch below
  assert.deepEqual([rows.get("b"), rows.get("b1")], [2, 2]);  // a later take of clip 1 below: whatever the film, no row moves
  assert.deepEqual(wayThrough({ takes, last: { a: "a1", a1: "a1x" } }, "a"), ["a", "a1", "a1x"]);
  assert.deepEqual(wayThrough({ takes, last: {} }, "a1x"), ["a", "a1", "a1x"]);
});

test("a take made with another version of its scene is told, its change shown, and Use this prompt brings it back (#242)", async () => {
  const { fetchTemplates, lineDiff, sceneIn, useVersion, versionHTML, versionOf, wordMarks } = await import("../../comfyui/web/app/versions.js");
  const old = "@h3 base 16:9\n\nSCENE the door\nSHOT 5s: static\na red door opens.\n\nSCENE the hall\nSHOT 5s: dolly in\na long hall.\n";
  const now = "@h3 base 16:9\n\nSCENE the hall\nSHOT 5s: dolly in\na long hall.\n\nSCENE the door\nSHOT 5s: static\n# a note\na blue door opens.\n";
  const asked = [];
  let toast = null, rendered = 0;
  const app = {
    text: now, data: {}, state: { tab: "prompt" }, render: () => { rendered++; }, toast: (html, action) => { toast = { html, action }; },
    api: { template: async (h) => { asked.push(h); if (h === "gone") throw new Error("404"); return { text: old }; } },
  };
  await fetchTemplates(app, [{ template: "old" }, { template: "old" }, { template: "gone" }, {}]);
  await fetchTemplates(app, [{ template: "old" }]);
  assert.deepEqual(asked.sort(), ["gone", "old"]);  // each hash once
  assert.equal(sceneIn(now, 0, "SCENE the door").text.split("\n")[0], "SCENE the door");  // by its heading, moved
  assert.equal(versionOf(app, { template: "old", scene: 1 }), null);  // the hall: the same text, moved and all
  assert.equal(versionOf(app, { template: "gone", scene: 0 }), null);  // a template the home has lost: no mark
  const v = versionOf(app, { template: "old", scene: 0 });
  assert.deepEqual([v.scene, v.at, v.then.split("\n").pop(), v.now.split("\n").pop()], [0, 1, "a red door opens.", "a blue door opens."]);
  assert.deepEqual(lineDiff("a\nb\nc", "a\nx\nc"), [[" ", "a"], ["-", "b"], ["+", "x"], [" ", "c"]]);
  const card = versionHTML(v);
  assert.match(card, /class="cut"><i>−<\/i><span>a <mark>blue<\/mark> door opens\.<\/span>/);  // the changed word marked
  assert.match(card, /class="add"><i>\+<\/i><span>a <mark>red<\/mark> door opens\.<\/span>/);
  assert.match(card, /SCENE the door/);
  assert.deepEqual(wordMarks("walks slowly on", "walks on"), ["walks <mark>slowly</mark> on", "walks on"]);
  useVersion(app, v);
  assert.ok(app.text.startsWith("@h3 base 16:9\n\nSCENE the hall\nSHOT 5s: dolly in\na long hall.\n\nSCENE the door\nSHOT 5s: static\na red door opens."));
  assert.equal(versionOf(app, { template: "old", scene: 0 }), null);
  assert.ok(rendered === 1 && toast.action.label === "Undo");
  toast.action.run();
  assert.equal(app.text, now);
  app.text = "@h3 base 16:9\n\nSCENE the door\nSHOT 5s: static\na red door opens.\n";  // the hall gone: it comes back at the end
  useVersion(app, versionOf(app, { template: "old", scene: 1 }));
  assert.equal(app.text, "@h3 base 16:9\n\nSCENE the door\nSHOT 5s: static\na red door opens.\n\nSCENE the hall\nSHOT 5s: dolly in\na long hall.");
});

test("the film plays in the tree: its clips in film.mp4's time, a test scene's take left out (#243)", async () => {
  const { filmClips } = await import("../../comfyui/web/app/tree.js");
  const takes = [{ folder: "a", frames: 240 }, { folder: "t", frames: 120, test: true }, { folder: "b", frames: 120 }, { folder: "x", frames: 99 }];
  assert.deepEqual(filmClips({ takes, path: ["a", "t", "b"] }), [{ folder: "a", n: 1, start: 0, end: 10 }, { folder: "b", n: 3, start: 10, end: 15 }]);
  assert.deepEqual(filmClips({ takes, path: [] }), []);
});

test("a clip's takes have the results' head: + take, ×N, 📌 and play on top, the clip in numbers, deleting at the bottom (#245, #319)", async () => {
  const { takesHeadHTML } = await import("../../comfyui/web/app/timeline.js");
  const app = { data: {}, text: "", state: {}, bridge: { props: { orrery_takes: 2, orrery_keep: { 3: true } } } };
  const takes = [{ folder: "a", seed: 3, created: "2026-10-04T05:01:02.1+02:00" }, { folder: "b", seed: 7, take: 2, active: true, created: "2026-10-04T05:09:12.5+02:00" }];
  const html = takesHeadHTML(app, 1, takes, { index: 3, title: "the walk" });
  const at = (s) => html.indexOf(s);
  assert.ok(at('data-scene-act="gen" data-chunk="3" data-seg="1"') < at("data-playall") && at("data-playall") < at("th-mid")
    && at("th-mid") < at('data-clear="others"'));  // make takes of this clip, play, numbers, deleting
  assert.match(html, /2 takes<\/span>.*×2<\/span>.*data-scene-act="keep"[^>]*aria-pressed="true"/);  // ×N and the scene's 📌
  assert.match(html, /clip 2<\/span><span class="th-scene" title="the walk">the walk/);
  assert.match(html, /<i>takes<\/i><b>2<\/b>.*<i>circled<\/i><b>#2<\/b>.*<i>seed<\/i><b>7 \+ 2<\/b>.*<i>newest<\/i><b>05:09<\/b>/);
  assert.doesNotMatch(html, /other prompt/);  // none made with another prompt
  const next = takesHeadHTML(app, 4, [], { index: 3 });  // a clip before its turn starts afresh (#415): a take to make
  assert.match(next, /data-scene-act="gen" data-chunk="3" data-seg="4"/);
  assert.doesNotMatch(next, /aria-disabled|data-playall|th-low/);  // nothing yet to play or delete
});

test("the results' head is the one every take strip has, and play all comes with two videos (#319)", async () => {
  const { resultsHTML } = await import("../../comfyui/web/app/results.js");
  const video = (p) => ({ prompt: p, seed: 1, media: [{ filename: `${p}.mp4`, type: "output", kind: "video" }] });
  const app = { preset: "x", data: {}, api: { viewURL: (m) => m.filename }, bridge: { props: { orrery_results: { x: [video("a"), video("b")] }, orrery_chosen: { x: "a" } } } };
  const html = resultsHTML(app, "");
  assert.match(html, /data-ract="gen".*data-ract="takes".*data-ract="keep".*data-ract="play"/);
  assert.match(html, /<i>circled<\/i><b>#1<\/b>/);
  assert.match(html, /title="Take 1 · seed 1 · circled/);
  app.bridge.props.orrery_results.x = [video("a")];
  assert.doesNotMatch(resultsHTML(app, ""), /data-ract="play"/);  // one take: nothing to compare
});

test("the take tree hides the dead ends: the film's, the last clip's and those a shown take came after stay (#246)", async () => {
  const { shownTakes } = await import("../../comfyui/web/app/tree.js");
  const t = (folder, segment, parent = null) => ({ folder, segment, parent });
  const takes = [t("a", 0), t("b", 0), t("c", 0), t("d", 0), t("a1", 1, "a"), t("a2", 1, "a"), t("c1", 1, "c"), t("a1x", 2, "a1"), t("c1x", 2, "c1"), t("c1y", 2, "c1")];
  const tree = { takes, path: ["b"] };
  const names = (least) => shownTakes(tree, least).map((x) => x.folder).sort().join(" ");
  assert.equal(names(0), takes.map((x) => x.folder).sort().join(" "));  // 0: all of them
  assert.equal(names(1), "a a1 a1x b c c1 c1x c1y");  // d goes; a2 too (no take after it, not the last clip); b is the film
  assert.equal(names(2), "a a1 a1x b c c1 c1x c1y");  // c has one take after it, but c1 has two: the path to it stays whole
  assert.equal(names(3), "a a1 a1x b c c1 c1x c1y");  // the last clip's takes stay, and the takes they came after
});

test("a template without scenes shows its results under the prompt, its takes kept on the node per preset (#211)", async () => {
  const R = await import("../../comfyui/web/app/results.js");
  const props = {};
  let seed = 10;
  const app = { preset: "krea/fox", props, state: {}, data: {}, bridge: { props, getSeed: () => seed, setSeed: (s) => { seed = s; }, getControl: () => "fixed" },
    api: { viewURL: (m) => `/view?filename=${m.filename}&type=${m.type}` } };
  assert.equal(R.resultsHTML(app, "").includes("data-result"), false);  // no takes yet: the strip's head only
  R.resultBegins(app, { prompt_id: "p1", seed: 10, take: 0 });
  assert.equal(R.resultMedia(app, { prompt_id: "other", output: { images: [{ filename: "x.png", type: "output" }] } }), false);
  assert.equal(R.resultMedia(app, { prompt_id: "p1", output: { images: [{ filename: "fox_0001.png", subfolder: "", type: "output" }] } }), true);
  R.resultBegins(app, { prompt_id: "p2", seed: 11, take: 0 });
  R.resultMedia(app, { prompt_id: "p2", output: { gifs: [{ filename: "fox.mp4", type: "output", format: "video/h264-mp4" }] } });
  R.resultMedia(app, { prompt_id: "p2", output: { images: [{ filename: "prev.png", type: "temp" }] } });  // a second node of the run
  assert.deepEqual(R.resultsOf(app).map((t) => [t.prompt, t.seed, t.media.map((m) => m.kind)]), [["p1", 10, ["image"]], ["p2", 11, ["video", "image"]]]);
  assert.equal(R.shownResult(app).prompt, "p2");  // the newest is shown
  const html = R.resultsHTML(app, "--take-w:96px");
  assert.match(html, /class="take on shown" data-result="p2"[^>]*><video[^>]*src="\/view\?filename=fox\.mp4&amp;type=output#t=0\.05"/);  // a saved file first; the newest shown and the output
  assert.match(html, /data-result="p1"[^>]*>.*<img loading="lazy" alt="" src="\/view\?filename=fox_0001\.png/);
  assert.match(html, /<i>takes<\/i><b>2<\/b>.*<i>shown<\/i><b>#2<\/b>.*<i>seed<\/i><b>11<\/b>/);
  assert.deepEqual(R.resultSeeds(app, 2, false), [2, 3]);  // numbered on from the takes there are: seeds 12, 13
  assert.deepEqual(R.resultSeeds(app, 2, true), [1, 2]);  // with 📌 take numbers
  props.orrery_shown = { "krea/fox": "p1" };  // a click shows a take: the output and the node's seed stay (#305)
  assert.equal(R.shownResult(app).prompt, "p1");
  assert.equal(R.chosenResult(app).prompt, "p2");
  assert.match(R.resultsHTML(app, ""), /class="take shown" data-result="p1".*class="take on" data-result="p2"/);
  seed = 99;
  R.chooseResult(app, R.shownResult(app));  // Circle this take: it counts now, and a take that rolled anew gives its seed
  assert.equal(R.chosenResult(app).prompt, "p1");
  assert.equal(seed, 10);
  app.preset = "krea/owl";
  assert.deepEqual(R.resultsOf(app), []);  // another preset, its own takes
  R.resultBegins(app, { prompt_id: "p3", seed: 12, take: 0 });
  R.resultEnds(app, "p3");  // nothing written: no take
  assert.equal(R.resultMedia(app, { prompt_id: "p3", output: { images: [{ filename: "y.png" }] } }), false);
});

test("a template's takes are a shoot: finish it, open an earlier one again, the numbers stay (#320)", async () => {
  const R = await import("../../comfyui/web/app/results.js");
  const props = {};
  const app = { preset: "krea/fox", state: {}, data: {}, bridge: { props, getSeed: () => 1, setSeed: () => {}, getControl: () => "fixed" },
    api: { viewURL: (m) => m.filename } };
  const run = (id, seed, file, roll = "") => {
    R.resultBegins(app, { prompt_id: id, seed, take: 0, roll });
    R.resultMedia(app, { prompt_id: id, output: { images: [{ filename: file, type: "output" }] } });
  };
  run("a", 1, "a.png");
  run("b", 2, "b.png");
  props.orrery_chosen = { "krea/fox": "a" };  // a circled
  const first = props.orrery_shoot["krea/fox"];
  assert.ok(first);  // the shoot began with its first take
  assert.match(R.resultsHTML(app, ""), /shoot 1<\/span>.*data-ract="finish"/);
  assert.equal(R.finishShoot(app), true);
  assert.deepEqual(R.resultsOf(app), []);
  assert.deepEqual(R.shootsOf(app).map((x) => [x.id, x.takes.length, x.circled]), [[first, 2, "a"]]);
  assert.equal(R.finishShoot(app), false);  // nothing to finish
  let html = R.resultsHTML(app, "");
  assert.match(html, /shoot 2<\/span>/);  // the next one, before its first take
  assert.match(html, /data-shoot="[^"]+" title="Shoot 1 · 2 takes[^>]*><span class="take on"><img[^>]*src="a\.png"/);  // shown by its circled take
  run("c", 3, "c.png");
  const second = props.orrery_shoot["krea/fox"];
  assert.ok(second > first);
  assert.equal(R.openShoot(app, first), true);  // the first again: shoot 2 goes among the earlier ones
  assert.deepEqual(R.resultsOf(app).map((t) => t.prompt), ["a", "b"]);
  assert.equal(R.chosenResult(app).prompt, "a");
  assert.deepEqual(R.shootsOf(app).map((x) => x.id), [second]);
  html = R.resultsHTML(app, "");
  assert.match(html, /shoot 1<\/span>/);  // its number kept
  assert.match(html, /title="Shoot 2 · 1 take ·/);
  app.preset = "krea/owl";
  assert.deepEqual(R.shootsOf(app), []);  // every preset its own shoots
});

test("a grid's or a sweep's runs at one seed are one take, its views in a mosaic (#320)", async () => {
  const R = await import("../../comfyui/web/app/results.js");
  const props = {};
  const app = { preset: "krea/09", state: {}, data: {}, bridge: { props }, api: { viewURL: (m) => m.filename } };
  const run = (id, seed, file, roll) => {
    R.resultBegins(app, { prompt_id: id, seed, take: 0, roll });
    R.resultMedia(app, { prompt_id: id, output: { images: [{ filename: file, type: "output" }] } });
  };
  ["front", "side", "back", "face"].forEach((v, i) => run(`s1-${i}`, 7, `${v}7.png`, "sweeps/x"));
  run("s2-0", 8, "front8.png", "sweeps/x");  // the sweep's next seed: a take of its own
  run("solo", 9, "solo.png", "");
  assert.deepEqual(R.resultsOf(app).map((t) => [t.seed, t.media.length]), [[7, 4], [8, 1], [9, 1]]);
  assert.match(R.resultsHTML(app, ""), /<span class="mosaic m4"><img[^>]*front7\.png.*face7\.png"><\/span>/);
});

test("the settings are a tab of sections, and every setting of the old sheet is in one (#212)", async () => {
  const { SECTIONS, SECTION_HTML } = await import("../../comfyui/web/app/settings.js");
  assert.deepEqual(SECTIONS.map(([k]) => k), ["home", "llm", "writers", "editor", "clips", "log", "reset"]);
  const app = { data: { quickstart: true, dividers: false, timeline: true, log_prompts: true, preview_fps: 8, preview_edge: 768, preview_light: false, surf_numbered: true } };
  const st = {
    home: { home: "/h", setting: "/h", source: "setting" },
    llm: { source: "comfy", file: "qwen3vl_4b.safetensors", entries: 12, max_tokens: 16000, files: [{ name: "qwen3vl_4b.safetensors", size: 8e9, can_write: true }],
      api: { base_url: "https://api.openai.com/v1", model: "", key: "", key_from: "none", key_env: "OPENAI_API_KEY" } },
    writers: Object.fromEntries(["continue", "story", "story_scenes", "story_keyframes", "describe", "describe_shot", "describe_shot_into"].map((k) => [k, { text: "t", default: "d", edited: k === "story" }])),
    wcur: "continue",
  };
  const html = Object.fromEntries(SECTIONS.map(([k]) => [k, SECTION_HTML[k](app, st)]));
  const has = (k, ...bits) => bits.forEach((b) => assert.ok(html[k].includes(b), `${k} lacks ${b}`));
  has("home", 'id="oa-home"', "data-home", "Use this folder");  // moving the home keeps its own button
  has("llm", 'name="oa-src"', 'id="oa-llm"', 'id="oa-api-url"', 'id="oa-api-key"', "data-check", "data-useapi", 'id="oa-llm-n"', 'id="oa-llm-t"');
  has("writers", 'id="oa-wr"', 'id="oa-wt"', "data-wreset", "data-wsave", "Story interpolator: the fl2va shot between two frames · edited");
  has("editor", 'data-flag="quickstart" checked', 'data-flag="dividers" >', 'data-flag="timeline" checked');
  has("clips", 'id="oa-pvfps" type="number" min="1" max="24" step="1" value="8"', 'value="768"', 'value="smooth" checked', 'value="numbered" checked');
  has("log", 'data-flag="log_prompts" checked');
  assert.ok(!html.clips.includes("oa-clipmin") && html.clips.includes("in the preview below the scenes"));  // #331: no box under a scene
  assert.doesNotMatch(Object.values(html).join(""), /data-cancel|>Save</);  // no Save at the end of a long page
});

test("every library in a line says its roll, at the line's end, on hover or not at all (#202, #203)", async () => {
  const { annotationLines, shownHints } = await import("../../comfyui/web/app/annotate.js");
  const { highlight, onHover } = await import("../../comfyui/web/app/highlight.js");
  const text = "$a = __animal__\nSHOT 5s: static\nA __animal__ in an __arcade__ with __hair__ hair.";
  const ann = { bindings: { a: "fox" }, rolls: { 4: [[0, "heron"], [1, "arcade"], [2, "bob cut"]], 2: [[0, "owl"]] } };
  const cell = annotationLines(text, ann, null, 2);  // a cell from the template's line 2 on
  assert.equal(cell.get(2).text, "→ heron · arcade · bob cut");
  assert.equal(cell.get(0).text, "= fox");  // a binding's line says it as a binding, never its library's roll
  assert.equal(shownHints("none", cell).size, 0);
  assert.equal(shownHints("appended", cell), cell);
  const hover = shownHints("hover", cell);
  assert.ok(hover.get(2).hover && hover.get(0).note === "= fox");
  const known = new Set(["animal", "arcade", "hair"]);
  const html = highlight(text, known, { hints: hover });
  assert.doesNotMatch(html, /class="hint/);  // nothing at the line ends
  assert.match(html, /data-roll="at this seed: heron" class="t-has t-lib">__animal__/);
  assert.match(html, /data-roll="at this seed: bob cut" class="t-has t-lib">__hair__/);
  assert.match(html, /data-roll="= fox" class="t-has t-var">\$a/);
  assert.match(onHover('<span class="t-kw">REMEMBER:</span> x', { note: "→ image 3" }), /data-roll="→ image 3" class="t-has t-kw"/);
  assert.match(highlight(text, known, { hints: cell }), /class="hint note"><span>→ heron · arcade · bob cut/);
});

test("a 🎲 stands at the end of a line the language model writes for; Insert and Keep the direction edit its place (#173)", async () => {
  const { highlight, llmPlaces } = await import("../../comfyui/web/app/highlight.js");
  const { insertTake, keepDirection } = await import("../../comfyui/web/app/takes.js");
  const known = new Set(["animal"]);
  assert.deepEqual(llmPlaces("A __animal__ with --a small object--, under a __sky_kind__(weather words).", known).map((p) => [p.kind, p.what, p.dirs ?? ""]),
    [["slot", "a small object", ""], ["library", "sky_kind", "weather words"]]);  // a known library is no place
  assert.deepEqual(llmPlaces("> make it moody", known), [{ kind: "enhance", what: "make it moody" }]);
  assert.deepEqual(llmPlaces("# --not a slot--", known), []);
  assert.deepEqual(llmPlaces("  sheet = --a character sheet from image output--", known), []);  // the Gallery writes it (#175)
  const text = "@h3 t2va\nSHOT 5s: static\nA __animal__ with --a small object--.";
  assert.doesNotMatch(highlight(text, known), /llm-key/);  // no language model set: no keys
  const html = highlight(text, known, { llm: true, hints: new Map([[2, { text: "→ fox", kind: "note" }]]) });
  assert.match(html, /<span class="hint note with-keys"><span class="llm-keys"><span class="llm-key" role="button" data-llm="slot" data-what="a small object" data-dirs="" data-line="2"/);
  assert.match(html, /<\/span><\/span><span>→ fox<\/span><\/span>/);  // the line's hint after the keys
  const slot = { kind: "slot", what: "a small object", line: 2 };
  assert.equal(insertTake(text, slot, "a brass key").split("\n")[2], "A __animal__ with a brass key.");
  assert.equal(keepDirection(text, slot, " older ").split("\n")[2], "A __animal__ with --a small object, older--.");
  assert.equal(insertTake(text, { ...slot, line: 1 }, "x"), text);  // not on its line: nothing changes
  const lib = "A fox under a __sky_kind__ and a __sky_kind__(grey).";
  assert.equal(insertTake(lib, { kind: "library", what: "sky_kind", line: 0 }, "low fog"), "A fox under a low fog and a __sky_kind__(grey).");
  assert.equal(keepDirection(lib, { kind: "library", what: "sky_kind", line: 0 }, "stormy"), lib);  // a library keeps its own (#275)
  assert.equal(keepDirection("A fox.\n> make it moody", { kind: "enhance", what: "make it moody", line: 1 }, "darker"), "A fox.\n> make it moody, darker");
  assert.equal(insertTake("> make it moody", { kind: "enhance", what: "make it moody", line: 0 }, "x"), "> make it moody");
});

test("a library's roll at a line's end names the k-th library of its line, and Use selected puts an entry in its place (#273)", async () => {
  const { insertTake, nthLibrary } = await import("../../comfyui/web/app/takes.js");
  const line = "A __animal__ with __hair[fit=women]__ under a __sky_kind:30__ and \\__not__ this.";
  assert.equal(nthLibrary(line, 0), "animal");
  assert.equal(nthLibrary(line, 1), "hair");
  assert.equal(nthLibrary(line, 2), "sky_kind");
  assert.equal(nthLibrary(line, 3), null);  // an escaped one is no library
  assert.equal(insertTake(line, { kind: "entries", what: "hair", line: 0 }, "a bob cut"), "A __animal__ with a bob cut under a __sky_kind:30__ and \\__not__ this.");
  const { highlight } = await import("../../comfyui/web/app/highlight.js");
  const hints = new Map([[0, { text: "→ fox · bob cut", kind: "note", rolls: [[0, "fox"], [1, "bob cut"]] }]]);
  const known = new Set(["animal", "hair"]);
  assert.match(highlight("A __animal__ with __hair__.", known, { llm: true, hints }), /→ <span class="lroll" role="button" data-lroll="0" data-line="0" [^>]*>fox<\/span> · <span class="lroll" role="button" data-lroll="1"/);
  assert.doesNotMatch(highlight("A __animal__ with __hair__.", known, { hints }), /lroll/);  // no language model: plain text
});

test("Generate beside Add asks the language model for the settings' new entries, greyed without one (#323)", async () => {
  const { genHTML } = await import("../../comfyui/web/app/libraries.js");
  const app = (active) => ({ llmActive: () => active, data: { llm: { takes: { new: 5 } } } });
  assert.match(genHTML(app(true)), /class="btn primary" data-lact="gen" title="The language model writes 5 new entries, none the library has/);
  assert.match(genHTML(app(false)), /class="btn primary" disabled title="Generate asks a language model/);
});

test("a --slot-- is violet in the editor, what is in it coloured as ever (#280)", async () => {
  const { highlight } = await import("../../comfyui/web/app/highlight.js");
  const html = highlight("a fox with --one small object-- and --a sheet of $who--.", new Set());
  assert.match(html, /<span class="t-slot">--one small object--<\/span> and <span class="t-slot">--a sheet of <span class="t-var">\$who<\/span>--<\/span>/);
  assert.doesNotMatch(highlight("# --not a slot--", new Set()), /t-slot/);
});

test("the API client names every call once: a second key would silently take the first one's place (#288)", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../../comfyui/web/app/api.js", import.meta.url), "utf8");
  const keys = [...source.matchAll(/^ {4}(\w+): /gm)].map((m) => m[1]);
  assert.ok(keys.length > 40);
  assert.deepEqual(keys.filter((k, i) => keys.indexOf(k) !== i), []);
  assert.match(source, /^ {4}plan: \(body\) => call\("plan"/m);  // the grid's and the LoRA sweep's
});

test("with a text encoder, a run's language-model tasks go in mini-runs before it, in the plan's order (#171)", async () => {
  const { llmLocal, queueTasks } = await import("../../comfyui/web/app/miniruns.js");
  const app = (kind, clip = false) => ({ llmApi: () => kind === "api", data: { llm: { active: kind ? { kind } : null } },
    bridge: { wired: (name) => name === "clip" && clip } });
  assert.equal(llmLocal(app("comfy")), true);
  assert.equal(llmLocal(app(null, true)), false);  // nothing wired counts: the gear's model writes (#282)
  assert.equal(llmLocal(app("api")), false);
  assert.equal(llmLocal(app(null)), false);
  const asked = [], planned = [];
  const local = { ...app("comfy"), api: { llmPlan: async (body) => { planned.push(body); return { tasks: [{ task: "library", what: "sky" }, { task: "slot", what: "a key" }] }; } } };
  Object.assign(local.bridge, { getText: () => "t", getTarget: () => "text", getParams: () => ({}), getSeed: () => 7, getSegment: () => 2,
    getSweep: () => "", ask: async (...a) => { asked.push(a); } });
  assert.equal(await queueTasks(local), 2);
  assert.equal(planned[0].seed, 7);
  assert.equal(planned[0].segment, 2);
  assert.deepEqual(asked, [["library", "sky", "", { wait: false }], ["slot", "a key", "", { wait: false }]]);
  assert.equal(await queueTasks({ ...app("api"), bridge: {} }), 0);  // an endpoint: the run asks it, as before
});

test("a gallery picture's export keeps its slots from image output apart, for a 🎲 that writes them from the picture (#175)", async () => {
  const { pictureSlots } = await import("../../comfyui/web/app/model.js");
  assert.deepEqual(pictureSlots("a heron, --her coat as image output shows it--, waiting"),
    [{ text: "a heron, " }, { slot: "her coat as image output shows it" }, { text: ", waiting" }]);
  assert.deepEqual(pictureSlots("--a caption of image output--"), [{ slot: "a caption of image output" }]);
  assert.deepEqual(pictureSlots("a coat, --as image 2 shows it--"), [{ text: "a coat, --as image 2 shows it--" }]);  // written in the run
  assert.deepEqual(pictureSlots(""), []);
});

test("the presets and the libraries are read again on request (#301): an open preset's detail with them", async () => {
  const { reloadPresets } = await import("../../comfyui/web/app/presets.js");
  const { reloadLibraries } = await import("../../comfyui/web/app/libraries.js");
  const calls = [];
  const app = { state: { tab: "prompt", pOpen: "mine/gone" }, data: {}, refreshPresets: async () => calls.push("presets"),
    refreshCompletion: async () => calls.push("completion"), card: () => null, render: () => calls.push("render"), fail: (e) => { throw e; } };
  await reloadPresets(app);
  assert.deepEqual(calls, ["presets"]);  // read again; another tab is not drawn
  assert.equal(app.state.pOpen, null);  // the preset open in the detail is gone from the home: the detail closes
  app.state.tab = "presets";
  await reloadPresets(app);
  assert.deepEqual(calls, ["presets", "presets", "render"]);
  app.state.tab = "prompt";
  reloadLibraries(app);
  assert.equal(app.data.libStale, true);  // the folder is read when the tab draws, the open library with it
  assert.equal(calls.at(-1), "completion");
});

test("the results take what an output node of the run wrote, Orrery Log's pictures too; only without it the app logs them (#302)", async () => {
  const { capturedMedia } = await import("../../comfyui/web/app/results.js");
  const done = (node, output) => ({ node, prompt_id: "p1", output });
  const pic = { images: [{ filename: "orrery_00001_.png", subfolder: "", type: "output" }] };
  assert.deepEqual(capturedMedia(done("9", pic), { outputs: [9], log: true }), { media: pic.images, log: false });  // Orrery Log
  assert.deepEqual(capturedMedia(done("9", pic), { outputs: [9], log: false }), { media: pic.images, log: true });  // a Save node
  assert.equal(capturedMedia(done("7", pic), { outputs: [9], log: false }), null);  // a node this one does not feed
  assert.equal(capturedMedia(done("9", { text: ["hi"] }), { outputs: [9], log: false }), null);  // nothing written
  assert.equal(capturedMedia({ node: "9", output: pic }, { outputs: [9], log: false }), null);  // no prompt to file it under
});

test("a popup's list scrolls to the marked item, and only the list (#303)", async () => {
  const { reveal } = await import("../../comfyui/web/app/dialmenu.js");
  const list = { scrollTop: 0, clientHeight: 100, offsetTop: 0 };
  const item = (top) => ({ offsetTop: top, offsetHeight: 20, offsetParent: list });
  reveal(list, item(40));
  assert.equal(list.scrollTop, 0);  // already in view: nothing moves
  reveal(list, item(150));
  assert.equal(list.scrollTop, 70);  // below: its bottom edge at the list's
  reveal(list, item(10));
  assert.equal(list.scrollTop, 10);  // above: its top edge at the list's
  const inner = { scrollTop: 0, clientHeight: 100, offsetTop: 3 };  // a list inside the popup, both measured from the popup
  reveal(inner, { offsetTop: 133, offsetHeight: 20, offsetParent: {} });
  assert.equal(inner.scrollTop, 50);
  reveal(null, item(10));  // no list, no item: nothing to do
  reveal(list, null);
});

test("History says what a > line did to a run: the instruction, how it came about, the passage before (#279)", async () => {
  const { enhancedHTML } = await import("../../comfyui/web/app/history.js");
  assert.equal(enhancedHTML(undefined), "");
  const html = enhancedHTML([{ instruction: "make it <moody>", before: "a fox", after: "a fox in fog", kept: true },
    { instruction: "shorter", before: "b", after: "c" }]);
  assert.match(html, /&gt; make it &lt;moody&gt;<\/b> · a rewrite you kept \(Use selected\)/);
  assert.match(html, /<pre class="codebox before">a fox<\/pre>/);
  assert.match(html, /shorter<\/b> · written for this run/);
});

test("the Settings offer every reset the server knows, the gallery and everything with the files as a choice (#310)", async () => {
  const { RESETS, SECTIONS } = await import("../../comfyui/web/app/settings.js");
  assert.deepEqual(RESETS.map(([k]) => k), ["ratings", "history", "gallery", "presets", "libraries", "all"]);  // resets.WHAT
  assert.deepEqual(RESETS.filter((r) => r[3]).map(([k]) => k), ["gallery", "all"]);
  assert.ok(SECTIONS.some(([k]) => k === "reset"));
});

test("the preview shows the clip or take clicked, else the newest clip; the film's take counts (#305)", async () => {
  const { reelShown } = await import("../../comfyui/web/app/stage.js");
  const takes = [{ folder: "seg_0002_aaaaaaaa", active: false, seed: 1 }, { folder: "seg_0002_bbbbbbbb", active: true, seed: 2 }];
  const app = { state: {}, data: { chain: { clips: [{ segment: 0, version: "x" }, { segment: 2, version: "seg_0002_bbbbbbbb" }], takes: { 2: takes } } } };
  assert.deepEqual([reelShown(app).seg, reelShown(app).take.folder, reelShown(app).film], [2, "seg_0002_bbbbbbbb", true]);  // the newest, its film take
  app.state.stage = { seg: 2, folder: "seg_0002_aaaaaaaa" };
  assert.deepEqual([reelShown(app).take.seed, reelShown(app).film], [1, false]);  // a take only shown: not the film's
  app.state.stage = { seg: 0 };
  assert.deepEqual([reelShown(app).seg, reelShown(app).take], [0, null]);
  app.state.stage = { seg: 7 };  // a clip gone: the newest again
  assert.equal(reelShown(app).seg, 2);
  assert.equal(reelShown({ state: {}, data: {} }), null);
});

test("frames picked in the preview become a REMEMBER: line at the end of their scene (#223)", async () => {
  const { rememberLine, withRemember } = await import("../../comfyui/web/app/stage.js");
  assert.equal(rememberLine([50, 12, 50], " @GIRL "), "REMEMBER: frames 12, 50 as @GIRL");
  assert.equal(rememberLine([7], "image 3"), "REMEMBER: frame 7 as image 3");
  const text = "@h3 text\nSCENE one\nSHOT 5s: static\nA room.\n\nSCENE two\nSHOT 5s: static\nA hall.";
  assert.equal(withRemember(text, 0, "REMEMBER: frame 7 as image 3"),
    "@h3 text\nSCENE one\nSHOT 5s: static\nA room.\nREMEMBER: frame 7 as image 3\n\nSCENE two\nSHOT 5s: static\nA hall.");  // the blank line stays
  assert.equal(withRemember(text, 1, "REMEMBER: frame 1 as @GIRL").split("\n").at(-1), "REMEMBER: frame 1 as @GIRL");
});

test("the Presets tree: every preset, images, videos, favorites, recent, and collections with their images and videos (#307)", async () => {
  const { presetsAt, presetFolders } = await import("../../comfyui/web/app/model.js");
  const cards = [
    { name: "krea/fox", folder: "krea", kind: "image", sub: "still" }, { name: "h3/den", folder: "h3", kind: "video", sub: "scene" },
    { name: "loops/walk", folder: "loops", kind: "video", sub: "reel" }, { name: "loops/deep/stair", folder: "loops/deep", kind: "video", sub: "reel" },
    { name: "mine", folder: "", kind: "image", sub: "still" }];
  const names = (place, more) => presetsAt(cards, { view: "all", folder: null, kind: null, ...place }, more).map((c) => c.name);
  assert.deepEqual(names({ view: "image" }), ["krea/fox", "mine"]);
  assert.deepEqual(names({ view: "video" }), ["h3/den", "loops/walk", "loops/deep/stair"]);
  assert.deepEqual(names({ view: "fav" }, { favorites: new Set(["h3/den"]) }), ["h3/den"]);
  assert.deepEqual(names({ view: "recent" }, { recent: ["mine", "krea/fox"] }), ["mine", "krea/fox"]);
  assert.deepEqual(names({ folder: "loops" }), ["loops/walk", "loops/deep/stair"]);  // a collection holds the ones in it
  assert.deepEqual(names({ folder: "mine", kind: "image" }), ["mine"]);
  assert.deepEqual(presetFolders(cards), [{ path: "h3", count: 1, image: 0, video: 1 }, { path: "krea", count: 1, image: 1, video: 0 },
    { path: "loops", count: 2, image: 0, video: 2 }, { path: "loops/deep", count: 1, image: 0, video: 1 }, { path: "mine", count: 1, image: 1, video: 0 }]);
});

test("Presets and the Gallery filter by name, kind, date and a regex over the prompt (#308)", async () => {
  const { filterCards, filterRows } = await import("../../comfyui/web/app/model.js");
  const today = new Date(2026, 9, 4, 12);
  const cards = [{ name: "krea/fox", title: "Fox", tags: [], note: "", sub: "still", modified: "2026-10-04" },
    { name: "h3/den", title: "The den", tags: ["moody"], note: "", sub: "scene", modified: "2026-09-20" }];
  const names = (f) => filterCards(cards, { today, ...f }).map((c) => c.name);
  assert.deepEqual(names({ name: "MOODY" }), ["h3/den"]);
  assert.deepEqual(names({ sub: "still" }), ["krea/fox"]);
  assert.deepEqual(names({ since: 1 }), ["krea/fox"]);
  assert.deepEqual(names({ since: 30 }), ["krea/fox", "h3/den"]);
  assert.deepEqual(names({ grep: new Set(["h3/den"]) }), ["h3/den"]);  // the names the server's regex matched
  const rows = [{ id: "a", preset: "krea/fox", kind: "image", album: "", ts: "2026-10-04T08:00:00Z", text: "a fox in snow", picks: [] },
    { id: "b", preset: "h3/den", kind: "video", album: "reel:reels/den", ts: "2026-09-01T08:00:00Z", text: "A den. Rain.", picks: [] }];
  const ids = (f) => filterRows(rows, { today, title: (n) => ({ "krea/fox": "Fox" })[n], ...f }).map((r) => r.id);
  assert.deepEqual(ids({ name: "fox" }), ["a"]);
  assert.deepEqual(ids({ sub: "reel" }), ["b"]);
  assert.deepEqual(ids({ sub: "image" }), ["a"]);
  assert.deepEqual(ids({ since: 7 }), ["a"]);
  assert.deepEqual(ids({ grep: "den\\.\\s+rain" }), ["b"]);
  assert.deepEqual(ids({ grep: "fox (" }), []);  // no regex: plain text, which no prompt holds
});

test("Help is in pages: a start with the lessons, the language section by section, the models, the keys, the settings (#309)", async () => {
  const { PAGES, renderHelp } = await import("../../comfyui/web/app/help.js");
  assert.deepEqual(PAGES.map(([k]) => k), ["start", "wildcards", "bindings-and-extras", "h3-screenplays", "cast-and-references", "reels-orrery-continue",
    "models", "keys", "settings"]);
  let html = "";
  const app = { state: {}, bridge: { props: {} }, known: () => new Set(), data: { presets: [{ name: "tutorial/01_first", title: "01 · A first wildcard" }] },
    view: { set innerHTML(h) { html = h; }, get innerHTML() { return html; } } };
  renderHelp(app);
  assert.match(html, /data-hpage="start" aria-current="true"/);
  assert.match(html, /data-load="tutorial\/01_first"/);  // the lessons on the start page
  app.state.helpPage = "models";
  renderHelp(app);
  assert.match(html, /<h4>Writing for the models<\/h4>/);
  assert.match(html, /Krea 2 faces/);
});

test("⏮ ⏭ in a divider go to the first clip of the scene before or after the next clip's (#341)", async () => {
  const { chunkInfo, sceneStep } = await import("../../comfyui/web/app/model.js");
  const chunks = chunkInfo("@h3 t2va\nSCENE a\nSHOT 5s\nA.\nSCENE b ×3\nSHOT 5s\nB.\nSCENE c\nSHOT 5s\nC.");  // clips 0 | 1 2 3 | 4
  assert.equal(sceneStep(chunks, 2, 1), 4);  // in b: on to c
  assert.equal(sceneStep(chunks, 2, -1), 0);  // in b: back to a
  assert.equal(sceneStep(chunks, 0, -1), null);  // nothing before the first
  assert.equal(sceneStep(chunks, 4, 1), null);  // nothing after the last
  assert.equal(sceneStep(chunks, 9, -1), 4);  // past the end: back to the last scene
});

test("a scene's divider deletes the scene or duplicates it right after itself (#344)", async () => {
  const { chunkInfo, copyScene, dropScene } = await import("../../comfyui/web/app/model.js");
  const text = "@h3 t2va\nstyle: x\nSCENE a\nSHOT 5s\nA.\n\nSCENE b ×3\nSHOT 5s\nB.\nEND ON: b ends\n\nSCENE c\nSHOT 5s\nC.";
  const chunks = chunkInfo(text);
  assert.equal(dropScene(text, chunks, 1), "@h3 t2va\nstyle: x\nSCENE a\nSHOT 5s\nA.\n\nSCENE c\nSHOT 5s\nC.");
  assert.equal(dropScene(text, chunks, 2), "@h3 t2va\nstyle: x\nSCENE a\nSHOT 5s\nA.\n\nSCENE b ×3\nSHOT 5s\nB.\nEND ON: b ends\n");
  assert.equal(copyScene(text, chunks, 1), "@h3 t2va\nstyle: x\nSCENE a\nSHOT 5s\nA.\n\nSCENE b ×3\nSHOT 5s\nB.\nEND ON: b ends\n\n"
    + "SCENE b ×3\nSHOT 5s\nB.\nEND ON: b ends\n\nSCENE c\nSHOT 5s\nC.");
  assert.equal(copyScene(text, chunks, 2), `${text}\n\nSCENE c\nSHOT 5s\nC.`);  // the last: a blank line, then the copy
  assert.equal(chunkInfo(copyScene(text, chunks, 0)).length, 4);
});

test("every scene divider has the reel's transport, in step with the footer (#341)", async () => {
  const { sceneActs } = await import("../../comfyui/web/app/prompt.js");
  const { chunkInfo } = await import("../../comfyui/web/app/model.js");
  const chunks = chunkInfo("@h3 t2va\nSCENE a\nSHOT 5s\nA.\nSCENE b ×3\nSHOT 5s\nB.");
  const app = { chunks: () => chunks, state: {}, bridge: { getSegment: () => 1, segmentHeld: () => true, props: { repeat: 2 } } };
  const html = sceneActs(app)(chunks[0], 0);
  const order = ["prev", "roll", "more", "next", "hold", "stats"].map((a) => html.indexOf(`data-scene-act="${a}"`));
  assert.deepEqual([...order].sort((x, y) => x - y), order);  // ⏮ ▶ +N ⏭ 🔒 📊
  assert.match(html, /Next clip becomes 1: the first of the scene before/);
  assert.match(html, /data-scene-act="next"[^>]*title="No scene after this clip's"[^>]*disabled/);  // b is the last
  assert.match(html, /title="Roll: clip 2 and the 1 after it, as Roll in the footer"/);
  assert.match(html, />\+2<\/button>/);
  assert.match(html, /title="A Roll plays 2 clips. Click for 4"/);
  assert.match(html, /data-scene-act="hold"[^>]*aria-pressed="true"/);
  assert.match(html, /data-scene-act="copy"[^>]*title="Duplicate SCENE 1 \(a\): a copy right after it"/);  // #344
  assert.match(html, /data-scene-act="drop"[^>]*title="Delete SCENE 1 \(a\)"/);
  app.state.sweepQueue = { done: 0, total: 4 };
  assert.match(sceneActs(app)(chunks[0], 0), /data-scene-act="roll"[^>]*disabled/);  // a sweep is queueing
});

test("a sheet sends along by default what its kind needs: the prompt, the story both frames, a picture its frame (#335)", async () => {
  const { defaultSends, promptLocked, SOURCES } = await import("../../comfyui/web/app/takes.js");
  const both = (n) => n === "first_frame" || n === "last_frame", last = (n) => n === "last_frame", none = () => false;
  assert.deepEqual(SOURCES.map(([k]) => k), ["prompt", "first_frame", "last_frame", "video"]);
  assert.deepEqual([...defaultSends("story", both)], ["prompt", "first_frame", "last_frame"]);
  assert.deepEqual([...defaultSends("story", none)], ["prompt"]);
  assert.deepEqual([...defaultSends("describe", both)], ["first_frame"]);  // the picture, not the prompt it would echo
  assert.deepEqual([...defaultSends("describe", last)], ["last_frame"]);
  assert.deepEqual([...defaultSends("describe", none)], ["prompt"]);  // no picture: written from the prompt
  assert.deepEqual([...defaultSends("entries", both, true)], []);  // the Libraries tab: the node's prompt is elsewhere
  assert.deepEqual([...defaultSends("slot", both)], ["prompt"]);  // frames only when asked (a slot names its own)
  assert.ok(promptLocked("slot") && promptLocked("continue") && !promptLocked("entries") && !promptLocked("story"));
});

test("a writer's sheet lists the scenes and says where Replace and Insert put its takes, where it has a place (#333, #342, #343)", async () => {
  const { writerPlaces } = await import("../../comfyui/web/app/takes.js");
  const { sceneTitles } = await import("../../comfyui/web/app/model.js");
  const reel = "@h3 t2va\nSCENE one\nSHOT 5s\nA.\n  SCENE two ×3\nSHOT 5s\nB.\nCHUNK three repeat forever (test)\nSHOT 5s\nC.";
  const scenes = sceneTitles(reel);
  assert.deepEqual(scenes, ["one", "two", "three"]);
  assert.deepEqual(sceneTitles("a photo of a fox"), []);
  assert.deepEqual(writerPlaces("continue", { scenes }), { replace: null, insert: "after SCENE 3 (three)" });  // the end
  assert.deepEqual(writerPlaces("continue", { scenes, after: 0 }), { replace: "after SCENE 1 (one), in place of SCENE 2 (two) to SCENE 3 (three)",
    insert: "after SCENE 1 (one), SCENE 2 (two) to SCENE 3 (three) stay after them" });
  assert.equal(writerPlaces("continue", { scenes, after: 1 }).insert, "after SCENE 2 (two), SCENE 3 (three) stays after them");
  assert.deepEqual(writerPlaces("continue", { scenes: [] }), { replace: null, insert: "after the screenplay, which becomes the first scene" });
  assert.equal(writerPlaces("story", { scenes, from: 0, to: 2 }).replace, "after SCENE 1 (one), in place of SCENE 2 (two)");
  assert.deepEqual(writerPlaces("story", { scenes, from: 1, to: 2 }), { replace: null, insert: "after SCENE 2 (two)" });  // nothing between
  assert.equal(writerPlaces("story", { scenes }).replace, "before the first scene, in place of SCENE 1 (one) to SCENE 3 (three)");
  assert.deepEqual(writerPlaces("story", { scenes: [] }), { replace: "in place of the shots below the header", insert: "above the shots, which stay" });
  assert.deepEqual(writerPlaces("story", { scenes: [], count: 3 }), { replace: "in place of the shots below the header", insert: "before the shots, which become the scene after them" });
  assert.deepEqual(writerPlaces("story", { scenes: [], to: "prompt", count: 3 }), { replace: null, insert: "before the screenplay, which becomes the scene they lead into" });
  assert.deepEqual(writerPlaces("story", { scenes: [], from: "prompt" }), { replace: null, insert: "after the screenplay, which becomes the first scene" });
  assert.deepEqual(writerPlaces("story", { scenes, to: "prompt" }), { replace: null, insert: "before the first scene" });  // a prequel
  assert.deepEqual(writerPlaces("story", { scenes, from: "prompt" }), { replace: null, insert: "after SCENE 3 (three)" });  // a sequel
  assert.equal(writerPlaces("story", { h3: false, to: "prompt" }).insert, null);
  assert.match(writerPlaces("story", { h3: false, to: "prompt" }).replace, /^in place of the prompt, on a grid/);
  assert.deepEqual(writerPlaces("describe", { scenes: [] }), { replace: "in place of the shots below the header", insert: "above the shots, which stay" });
  assert.deepEqual(writerPlaces("describe", { scenes }), { replace: null, insert: "under the line your cursor was on" });
  assert.deepEqual(writerPlaces("describe", { h3: false }), { replace: "in place of the prompt, its comments and `: …` lines kept", insert: null });
});

test("several takes go in as a choice, what the language reads as its own written as itself (#336)", async () => {
  const { asChoice, insertTake } = await import("../../comfyui/web/app/takes.js");
  assert.equal(asChoice(["a red scarf", "a lantern"]), "{a red scarf|a lantern}");
  assert.equal(asChoice(["50% off | $5", "a {brass} key", "the __init__ file"]), "{50% off \\| \\$5|a \\{brass\\} key|the \\__init\\__ file}");
  const line = "A woman with --what she carries-- walks on.";
  assert.equal(insertTake(line, { kind: "slot", what: "what she carries", line: 0 }, asChoice(["a fan", "a cane"])),
    "A woman with {a fan|a cane} walks on.");
});

test("a reel's shot from a writer goes in under the caret's line, never inside it (#334)", async () => {
  const { atCaret } = await import("../../comfyui/web/app/cells.js");
  const reel = "SCENE a\nSHOT 5s: static\nA fox.\nSCENE b\nB.";
  assert.equal(atCaret(reel, reel.indexOf("A fox") + 2, "SHOT 3s: static\nShe smiles."),
    "SCENE a\nSHOT 5s: static\nA fox.\nSHOT 3s: static\nShe smiles.\nSCENE b\nB.");
  assert.equal(atCaret(reel, null, "SHOT 3s: static\nEnd."), `${reel}\nSHOT 3s: static\nEnd.`);  // no caret: at the end
  assert.equal(atCaret("A.\n", 0, "B."), "A.\nB.\n");
});

test("the seed a run gets is read where it is set: the node's own, or the widget a linked seed comes from (#346)", async () => {
  const { seedSource } = await import("../../comfyui/web/app/model.js");
  const own = { name: "seed", value: 0 };
  const node = (inputs = []) => ({ widgets: [own, { name: "control_after_generate", value: "fixed" }], inputs });
  const graph = (nodes, links) => ({ links: new Map(Object.entries(links).map(([k, v]) => [Number(k), v])), getNodeById: (id) => nodes[id] });
  assert.equal(seedSource(node(), graph({}, {})).widget, own);  // not linked
  const setter = { type: "ReservedVRAMSetter", outputs: [{ name: "anything" }, { name: "seed" }],
    widgets: [{ name: "reserved", value: 8 }, { name: "seed", value: 1010 }] };  // Pyro's: the seed passes through it
  const linked = node([{ name: "seed", widget: { name: "seed" }, link: 7 }]);
  assert.equal(seedSource(linked, graph({ 459: setter }, { 7: { origin_id: 459, origin_slot: 1 } })).widget.value, 1010);
  const reroute = { type: "Reroute", inputs: [{ link: 8 }] }, primitive = { type: "PrimitiveNode", outputs: [{ name: "connect to widget input" }],
    widgets: [{ name: "seed", value: 42 }, { name: "control_after_generate", value: "increment" }] };
  const via = seedSource(linked, graph({ 1: reroute, 2: primitive }, { 7: { origin_id: 1, origin_slot: 0 }, 8: { origin_id: 2, origin_slot: 0 } }));
  assert.equal(via.node, primitive);
  assert.equal(via.widget.value, 42);  // through a reroute, from a primitive
  const math = { type: "SimpleMath", outputs: [{ name: "INT" }], widgets: [{ name: "expression", value: "a*2" }] };
  assert.equal(seedSource(linked, graph({ 3: math }, { 7: { origin_id: 3, origin_slot: 0 } })).widget, own);  // computed: no widget holds it
});
