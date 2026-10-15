// The editor's textareas hold their hints too (#416, hintroom.js), so a hint wraps as text. For everything else a
// textarea still speaks the template: its value, selection and setSelectionRange leave the hints out, the caret
// steps over a hint, a copy or a cut takes the template's text, and Undo is the textarea's own (the browser's would
// undo the hints as well, which are put in and taken out as the annotations come).
import { clampCaret, layout, reconcile, toDisplay, toSource } from "./hintroom.js";

const P = globalThis.HTMLTextAreaElement?.prototype;  // none where the tests load this module
const VALUE = P && Object.getOwnPropertyDescriptor(P, "value");
const START = P && Object.getOwnPropertyDescriptor(P, "selectionStart");
const END = P && Object.getOwnPropertyDescriptor(P, "selectionEnd");
const SELECT = P?.setSelectionRange;
const GROUP_MS = 700;  // typing within this joins one step of Undo
const FORWARD = new Set(["ArrowRight", "ArrowDown", "PageDown"]);
const states = new WeakMap();

// The textarea's own text and caret, hints and all: for measuring where the caret sits on screen.
export const shownValue = (ta) => VALUE.get.call(ta);
export const shownEnd = (ta) => END.get.call(ta);

// The textarea's text written anew from the template, the selection given in template offsets, its scroll kept.
function write(ta, st, a, b) {
  const top = ta.scrollTop;
  VALUE.set.call(ta, st.text);
  SELECT.call(ta, toDisplay(st.spans, a), toDisplay(st.spans, b));
  ta.scrollTop = top;
}

// What the textarea holds now, in the template's terms: an edit the browser made is worked into the template.
function sync(ta) {
  const st = states.get(ta), now = VALUE.get.call(ta);
  if (now === st.text) return st;
  const r = reconcile(st.text, st.spans, st.source, now, st.at);
  Object.assign(st, { source: r.source, spans: r.spans, rooms: r.rooms, text: r.text, at: null });
  if (r.text !== now) write(ta, st, r.caret, r.caret);
  return st;
}

const selection = (ta, st) => [toSource(st.spans, START.get.call(ta)), toSource(st.spans, END.get.call(ta))];

// The template set anew, the selection at `a`..`b` (template offsets), the rooms kept by line.
function put(ta, st, source, a, b) {
  st.source = source;
  Object.assign(st, layout(source, st.rooms));
  write(ta, st, Math.min(a, source.length), Math.min(b, source.length));
}

// One step of Undo: the template and its selection before an edit.
function remember(ta, st, force = false) {
  const now = Date.now();
  if (force || now - st.last > GROUP_MS) {
    const [a, b] = selection(ta, st);
    st.undo.push({ source: st.source, a, b });
    if (st.undo.length > 500) st.undo.shift();
    st.redo = [];
  }
  st.last = now;
}

function step(ta, back) {
  const st = sync(ta), from = back ? st.undo : st.redo, to = back ? st.redo : st.undo, entry = from.pop();
  if (!entry) return;
  const [a, b] = selection(ta, st);
  to.push({ source: st.source, a, b });
  Object.assign(st, { last: 0, kind: null });
  put(ta, st, entry.source, entry.a, entry.b);
  ta.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: back ? "historyUndo" : "historyRedo" }));
}

// The caret off a hint: after a key, a click or focus.
function clamp(ta, forward) {
  const st = sync(ta), len = st.text.length, s = START.get.call(ta), e = END.get.call(ta);
  const s2 = clampCaret(st.spans, s, forward, len), e2 = clampCaret(st.spans, e, forward, len);
  if (s2 !== s || e2 !== e) SELECT.call(ta, Math.min(s2, e2), Math.max(s2, e2), ta.selectionDirection);
}

// Makes a textarea hold its hints (once): from here its value and selection are the template's.
export function bindRoom(ta) {
  if (states.has(ta)) return ta;
  const text = VALUE.get.call(ta);
  const st = { source: text, text, spans: [], rooms: new Map(), undo: [], redo: [], last: 0, composing: false, pending: null, at: null };
  states.set(ta, st);
  Object.defineProperties(ta, {
    value: {
      configurable: true,
      get: () => sync(ta).source,
      set: (v) => {
        const s = sync(ta), source = String(v ?? "");
        if (source === s.source) return;
        if (document.activeElement === ta) remember(ta, s, true);  // the completion's insert, say: a step of Undo
        Object.assign(s, { last: 0, kind: null });  // the typing after it is a step of its own
        put(ta, s, source, source.length, source.length);
      },
    },
    selectionStart: { configurable: true, get: () => toSource(sync(ta).spans, START.get.call(ta)), set: (v) => START.set.call(ta, toDisplay(sync(ta).spans, v)) },
    selectionEnd: { configurable: true, get: () => toSource(sync(ta).spans, END.get.call(ta)), set: (v) => END.set.call(ta, toDisplay(sync(ta).spans, v)) },
    setSelectionRange: { configurable: true, value: (a, b, dir) => { const s = sync(ta); SELECT.call(ta, toDisplay(s.spans, a), toDisplay(s.spans, b), dir); } },
  });
  ta.addEventListener("beforeinput", (e) => {
    if (e.inputType === "historyUndo" || e.inputType === "historyRedo") {
      e.preventDefault();
      return step(ta, e.inputType === "historyUndo");
    }
    const kind = e.inputType.startsWith("delete") ? "delete" : "insert";  // typing, then deleting: two steps of Undo
    remember(ta, sync(ta), kind !== st.kind || e.inputType === "insertLineBreak" || e.inputType.startsWith("insertFromPaste")
      || e.inputType.startsWith("deleteBy"));
    st.kind = kind;
    st.at = START.get.call(ta);  // where the edit begins, for sync to tell
  });
  ta.addEventListener("input", () => sync(ta), true);  // before the editor's own listeners read the value
  ta.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (k === "z" || k === "y")) {
      e.preventDefault();
      return step(ta, k === "z" && !e.shiftKey);
    }
    const d = START.get.call(ta);
    if (e.key === "Delete" && d === END.get.call(ta)) {  // at a line's end: past its hint, so Delete takes the line break
      const sp = sync(ta).spans.find((x) => x.start === d);
      if (sp) SELECT.call(ta, sp.end, sp.end);
    }
    if (e.key.startsWith("Arrow") || e.key.startsWith("Page") || e.key === "Home" || e.key === "End") {
      const forward = FORWARD.has(e.key);
      setTimeout(() => clamp(ta, forward), 0);
    }
  });
  for (const kind of ["mouseup", "focus", "select"]) ta.addEventListener(kind, () => setTimeout(() => clamp(ta, false), 0));
  ta.addEventListener("copy", (e) => {
    const s = sync(ta), [a, b] = selection(ta, s);
    if (a === b) return;
    e.clipboardData.setData("text/plain", s.source.slice(a, b));
    e.preventDefault();
  });
  ta.addEventListener("cut", (e) => {
    const s = sync(ta), [a, b] = selection(ta, s);
    if (a === b) return;
    e.clipboardData.setData("text/plain", s.source.slice(a, b));
    e.preventDefault();
    if (ta.readOnly) return;
    remember(ta, s, true);
    s.kind = null;
    put(ta, s, s.source.slice(0, a) + s.source.slice(b), a, a);
    ta.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteByCut" }));
  });
  ta.addEventListener("compositionstart", () => { st.composing = true; });
  ta.addEventListener("compositionend", () => {
    st.composing = false;
    if (st.pending) setRooms(ta, st.pending);
  });
  return ta;
}

const sameRooms = (a, b) => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);

// The hints a textarea holds (`rooms`: line index → the text drawn after that line, hintroom.roomOf).
export function setRooms(ta, rooms) {
  const st = states.get(ta);
  if (!st) return;
  if (st.composing) { st.pending = rooms; return; }
  st.pending = null;
  sync(ta);
  if (sameRooms(st.rooms, rooms)) return;
  const [a, b] = selection(ta, st);
  st.rooms = rooms;
  Object.assign(st, layout(st.source, rooms));
  write(ta, st, a, b);
}
