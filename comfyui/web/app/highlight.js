// Syntax colouring for orrery templates. Pure: returns HTML for a <pre> under the editor.

import { castNames } from "../orrery-complete.js";
import { hintParts, roomOf } from "./hintroom.js";
import { icon } from "./icons.js";
import { chunkShort } from "./model.js";

export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const CLI_ONLY = "CLI only: in ComfyUI, use the Run count and the seed widget";
// a line's head: the screenplay words (the earlier CHUNK, HANDOFF:, GOTO:, SEND: too), IF before a
// condition, and a name with a colon (a CAST member, a speaker), `@` before it or not
const HEAD = /^(\s*)(SHOT\s+[\d.]+\s*s\b:?|EXPORT:|SFX:|MUSIC:|LORA:|END ON:|START WITH:|REMEMBER:|CUT TO:|AFTER:|HANDOFF:|SEND:|GOTO:|SET:|style:|summary:|voice:|keep:|context:|refmods:|(?:SCENE|CHUNK)(?=\s|$)|IF(?=\s+\$)|CAST(?=\s*$)|@?[A-Z][A-Z0-9 _-]*?(?:\s*\([^)]*\))?\s*:(?=\s))/;
const TOKEN = /(\\[{}|$_@#[\]\\<>])|((?<!\\)__([\w*]+(?:\/[\w*]+)*)(?:\[[^\[\]\n]+\])?(?:#[\w-]+:\$?[\w.-]+)*(?::\d+)?__(?:\([^()]*\))?)|(\$[A-Za-z_]\w*(?:~\d+)?(?:\.[A-Za-z_][\w-]*)?)|(\d+(?:-\d+)?\$\$)|([{}|])|([^_${}|]+|[_$])/g;

// A glob (`clothing/*`, `clothing/**`) is known when it matches a library.
function isKnown(name, known) {
  if (!name.includes("*")) return known.has(name);
  const part = (p) => (p === "**" ? ".+" : p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*"));
  const rx = new RegExp(`^${name.split("/").map(part).join("/")}$`);
  return [...known].some((n) => rx.test(n));
}

const TO_MAKE = "Not a library yet: the language model creates it when the node runs";

// The members of the CAST, `@` before them or not, as a pattern (null without a CAST).
const memberPattern = (names) => (names.length
  ? new RegExp(`(?<![\\w@])@?(?:${[...names].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\w-])`, "g")
  : null);
const brass = (html, members) => (members ? html.replace(members, (m) => `<span class="t-cast">${m}</span>`) : html);

function line(text, known, llm, members) {
  if (/^\s*#/.test(text)) return `<span class="t-comment">${esc(text)}</span>`;
  if (/^\s*@h3\b/.test(text)) return `<span class="t-head">${esc(text)}</span>`;
  if (/^\s*>/.test(text)) return `<span class="t-enh">${esc(text)}</span>`;
  if (/^\s*@(seed|batch)\b/.test(text)) return `<span class="t-cli" title="${CLI_ONLY}">${esc(text)}</span>`;
  if (/^\s*(:\s*(x\d|seed=|w\d|h\d|grid\b|unique=)|@(grid|unique|size|seed|batch|rng)\b)/.test(text)) {
    return text.replace(/(\S+)|(\s+)/g, (m, word) => {
      if (!word) return m;
      if (/^(x\d+|seed=\d+)$/.test(word)) return `<span class="t-cli" title="${CLI_ONLY}">${esc(word)}</span>`;
      return `<span class="t-param">${esc(word)}</span>`;
    });
  }
  let out = "";
  let rest = text;
  const head = text.match(HEAD);
  if (head) {
    const name = /^@?([A-Z][A-Z0-9 _-]*?)\s*(?:\(|:)/.exec(head[2]);
    const member = members && name && new RegExp(`^${members.source}$`).test(`${name[1]}`);
    out = esc(head[1]) + (member ? `<span class="t-kw">${brass(esc(head[2]), members)}</span>` : `<span class="t-kw">${esc(head[2])}</span>`);
    rest = text.slice(head[0].length);
  }
  // <lora:…> tags and their @name(0.8) short form are opaque (file names may contain __), as orrery's expander treats them
  const lora = (part) => (members && new RegExp(`^${members.source}\\(`).test(part) ? brass(esc(part), members)  // SET: @JINX(0.6)
    : `<span class="t-lora">${esc(part)}</span>`);
  const words = (s) => s.split(/((?<!\\)<(?:lora|refmod|image|cast):[^<>]*>|(?<![\w@<\\])@[\w./\\-]+\([^()<>]*\))/).map((part, i) => (i % 2 ? lora(part)
    : part.replace(TOKEN, (m, escaped, lib, name, v, multi, brace) => {
      if (escaped) return `<span class="t-esc" title="Written as it is: the backslash keeps it from being syntax">${esc(m)}</span>`;
      if (lib) return isKnown(name, known) ? `<span class="t-lib">${esc(lib)}</span>`
        : llm ? `<span class="t-lib t-new" title="${TO_MAKE}">${esc(lib)}</span>` : `<span class="t-lib t-miss">${esc(lib)}</span>`;
      if (v) return `<span class="t-var">${esc(v)}</span>`;
      if (multi || brace) return `<span class="t-brace">${esc(m)}</span>`;
      return brass(esc(m), members);
    }))).join("");
  // a --slot-- in violet, what is in it coloured as ever (#280)
  return out + rest.split(/(--(?=[^\s-])[^\n]*?[^\s-]--)/).map((part, i) => (i % 2 ? `<span class="t-slot">${words(part)}</span>` : words(part))).join("");
}

const SLOT = /--(?=[^\s-])([^\n]*?[^\s-])--/g;
export const LIBRARY = /(?<!\\)__([\w]+(?:\/[\w]+)*)(?:\[[^\[\]\n]+\])?(?:#[\w-]+:\$?[\w.-]+)*(?::\d+)?__(?:\(([^()]*)\))?/g;
const ASK = { slot: "Takes for this slot: then more, steered; pick one and Use selected puts it in", library: "Takes for this library still to be written: "
  + "entries that could stand here; Use selected puts one in, or keep a direction for the list",
  enhance: "Takes for this rewrite: what it does at this seed, steered; Use selected keeps one for this roll",
  entries: "This library's takes: its rolls and new entries from the language model; Use selected puts one in, Add to the library keeps new ones (Ctrl+click on a library's name does the same)" };

// The places on a line the language model writes for (#173): a `>` line's rewrite, its slots, its libraries still
// to be written; each with what names it (`what`) and a library's own directions (`dirs`).
export function llmPlaces(text, known) {
  if (/^\s*#/.test(text)) return [];
  const enhance = /^\s*>\s*(.*\S)\s*$/.exec(text);
  if (enhance) return [{ kind: "enhance", what: enhance[1] }];
  return [...[...text.matchAll(SLOT)].filter((m) => !/\bimage\s+output\b/.test(m[1]))  // written from the Gallery (#175)
    .map((m) => ({ kind: "slot", what: m[1], at: m.index })),
    ...[...text.matchAll(LIBRARY)].filter((m) => !isKnown(m[1], known)).map((m) => ({ kind: "library", what: m[1], dirs: m[2] || "", at: m.index }))]
    .sort((a, b) => a.at - b.at);
}

// The divider on a SCENE line: absolutely placed, so the text keeps its place under the textarea's caret;
// first in the line, so its static top is the line's top.
function chunkLine(html, c, segment, acts = "") {
  const now = segment !== null && (c.segs ? c.segs.includes(segment) : c.first !== null && segment >= c.first && segment <= c.last);
  const turn = !now ? "" : c.segs ? (c.segs.length > 1 ? ` ${c.segs.indexOf(segment) + 1}/${c.segs.length}${c.endless ? "+" : ""}` : "")
    : c.repeat > 1 ? ` ${segment - c.first + 1}/${c.repeat === Infinity ? "∞" : c.repeat}` : "";
  const title = `${now ? `next${turn} · ` : ""}${c.label}`;  // the whole story on hover; the divider names one clip (#219)
  return `<span class="chunkline${now ? " now" : ""}"><span class="chunkinfo"><span title="${esc(title)}">${esc(chunkShort(c, segment))}</span>${acts}</span>${html}</span>`;
}

// options.llm: a language model is set, so unknown libraries are to be made, not missing.
// options.chunks (model.chunkInfo): SCENE lines get dividers; the one playing options.segment is marked.
// options.sceneActs(c, index): a scene's buttons in its divider (#204), the chunk's index in the reel `c.index` when
// the chunks are a cell's own.
// options.cast: the CAST's names, in brass (a cell passes the whole template's); else read from src.
// A hover hint (#203) on what it belongs to, quietly marked: each library's roll on its `__…__` (`rolls`, by its
// place in the line), what the line says besides (`note`) on its first word that has a card: a keyword, a
// binding's name, a directive.
export function onHover(html, h) {
  let k = -1;
  const rolls = new Map(h.rolls || []);
  html = html.replace(/<span class="t-lib/g, (m) => (++k, rolls.has(k) ? `<span data-roll="${esc(`at this seed: ${rolls.get(k)}`)}" class="t-has t-lib` : m));
  return h.note ? html.replace(/<span class="(t-kw|t-var|t-param)/, (m, kind) => `<span data-roll="${esc(h.note)}" class="t-has ${kind}`) : html;
}

// A line's hint drawn after it, wrapping as text (#416): the 🎲 keys of the places a language model writes for (#173),
// the hint's pictures and its text, its rolls each opening their library's takes (#273). The textarea holds the same
// characters there (hintRooms), so both wrap alike.
function hintHTML(parts, h, i) {
  if (!parts.length) return "";
  const inner = parts.map((p) => {
    if (p.kind === "key") {
      return `<span class="hkey">${p.text}<span class="llm-key" role="button" data-llm="${p.place.kind}" data-what="${esc(p.place.what)}" `
        + `data-dirs="${esc(p.place.dirs || "")}" data-line="${i}" title="${esc(ASK[p.place.kind])}">${icon("dice")}</span></span>`;
    }
    if (p.kind === "pic") return `<span class="hpic" style="background-image:url(&quot;${esc(p.url)}&quot;)">${p.text}</span>`;
    if (p.kind === "roll") return `<span class="lroll" role="button" data-lroll="${p.k}" data-line="${i}" title="${esc(ASK.entries)}">${esc(p.text)}</span>`;
    return `<span class="h-${p.kind}">${esc(p.text)}</span>`;
  }).join("");
  const shown = h && !h.hover ? h : null;
  return `<span class="hint${shown?.replaced ? " replaced" : ""}${shown?.kind ? ` ${shown.kind}` : ""}">${inner}</span>`;
}

// What the textarea holds after each line in place of its hint (#416): line index → text (hintroom.roomOf).
export function hintRooms(src, known, { llm = false, hints = null } = {}) {
  const out = new Map();
  src.split("\n").forEach((l, i) => {
    const room = roomOf(hintParts(hints?.get(i), { llm, keys: llm ? llmPlaces(l, known) : [] }));
    if (room) out.set(i, room);
  });
  return out;
}

// `hints`: line index → { text, replaced } drawn after the line (REMEMBER: lines say where their frames go); the
// textarea holds them too (hintRooms), so the text wraps exactly as the textarea's. One with `hover` goes on the
// line's words.
export function highlight(src, known, { llm = false, chunks = null, segment = null, cast = null, hints = null, sceneActs = null } = {}) {
  const at = new Map((chunks || []).map((c, i) => [c.line, { ...c, index: c.index ?? i }]));
  const members = memberPattern(cast ?? castNames(src));
  const words = (l, i) => (hints?.get(i)?.hover ? onHover(line(l, known, llm, members), hints.get(i)) : line(l, known, llm, members));
  const tail = (l, i) => hintHTML(hintParts(hints?.get(i), { llm, keys: llm ? llmPlaces(l, known) : [] }), hints?.get(i), i);
  return src.split("\n").map((l, i) => (at.has(i) ? chunkLine(words(l, i), at.get(i), segment, sceneActs ? sceneActs(at.get(i), at.get(i).index) : "")
    : words(l, i)) + tail(l, i)).join("\n");
}
