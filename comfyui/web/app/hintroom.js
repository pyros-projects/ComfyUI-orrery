// Hints that wrap as text (#416). The editor is a textarea over its highlight, and the two must wrap alike. A hint
// drawn after its line takes room, so the textarea holds the very same characters in the same place, transparent
// like the rest of its text: both wrap a hint as they wrap the line. These are the pure parts: what a hint is made
// of, the textarea's text with the hints in it, how its offsets map to the template's, and what an edit of it did.

export const ROOM = "   ";  // a 🎲 key's or a picture's place: three spaces that never break

const oneLine = (s) => String(s ?? "").replace(/\s*\n\s*/g, " ");

// A line's hint as parts [{text, kind}] (#416): the keys of the places a language model writes for (`keys`, each
// {kind, what, dirs}), then the hint's pictures and its text, its rolls a part each when they open their takes
// (`llm`). A hint shown on hover draws nothing; nothing to draw: []. The parts' texts are what the textarea holds.
export function hintParts(h, { llm = false, keys = [] } = {}) {
  const parts = keys.map((place) => ({ text: ROOM, kind: "key", place }));
  const shown = h && !h.hover ? h : null;
  if (shown) {
    for (const url of shown.thumbs || []) parts.push({ text: ROOM, kind: "pic", url });
    const text = oneLine(shown.text), rolls = llm && shown.rolls?.length ? shown.rolls.map(([k, v]) => [k, oneLine(v)]) : [];
    const said = rolls.length ? `→ ${rolls.map(([, v]) => v).join(" · ")}` : "";
    const head = said && text.endsWith(said) ? text.slice(0, -said.length).trimEnd() : null;
    if (parts.length) parts.push({ text: " ", kind: "gap" });
    if (head === null) parts.push({ text, kind: "text" });
    else {
      if (head) parts.push({ text: `${head} `, kind: "text" });
      parts.push({ text: "→ ", kind: "rolls" });
      rolls.forEach(([k, v], n) => {
        if (n) parts.push({ text: " · ", kind: "rolls" });
        parts.push({ text: v, kind: "roll", k });
      });
    }
  }
  return parts.length ? [{ text: "  ", kind: "gap" }, ...parts] : [];
}

export const roomOf = (parts) => parts.map((p) => p.text).join("");

// The textarea's text: the template with each line's room after it (`rooms`: line index → text). `spans` say where
// the rooms sit: start and end in the textarea's offsets, `anchor` the template's offset there (its line's end).
export function layout(source, rooms) {
  const spans = [];
  let d = 0, s = 0;
  const text = source.split("\n").map((l, i) => {
    const room = rooms?.get(i) || "";
    if (room) spans.push({ start: d + l.length, end: d + l.length + room.length, anchor: s + l.length, room });
    d += l.length + room.length + 1;
    s += l.length + 1;
    return l + room;
  }).join("\n");
  return { text, spans };
}

// A textarea offset as the template's: in a room, or right after it, the end of its line.
export function toSource(spans, d) {
  let shift = 0;
  for (const sp of spans) {
    if (d <= sp.start) break;
    if (d <= sp.end) return sp.anchor;
    shift += sp.end - sp.start;
  }
  return d - shift;
}

// A template offset as the textarea's: a line's end is before its room.
export function toDisplay(spans, s) {
  let shift = 0;
  for (const sp of spans) {
    if (s <= sp.anchor) break;
    shift += sp.end - sp.start;
  }
  return s + shift;
}

// Where the caret may stand: never in a room or right after it. Stepping forward it goes on to the next line,
// else back to its line's end.
export function clampCaret(spans, d, forward, length) {
  const sp = spans.find((x) => d > x.start && d <= x.end);
  if (!sp) return d;
  return forward && sp.end < length ? sp.end + 1 : sp.start;
}

const lineAt = (text, at) => text.slice(0, at).split("\n").length - 1;

// The template after the textarea's own edit (typing, a paste, a cut): `before` its text then, with `spans` and the
// template `source` it held, `after` its text now. The edit is what differs between the two; in the template it is
// the same edit without the rooms' characters. The rooms around it stay where they are; one the edit cut into, or
// that no longer ends its line, goes, and the textarea's text is made anew (the next paint draws the hint again).
// `at`, where the selection began before the edit, settles where it was when the text alone cannot tell (a space
// typed before a hint that starts with spaces). Returns {source, spans, rooms, text, caret}: `text` the textarea's
// text as it must be, `caret` the template offset after the edit.
export function reconcile(before, spans, source, after, at = null) {
  const max = Math.min(before.length, after.length), lead = at === null ? max : Math.min(max, at);
  let p = 0;
  while (p < lead && before[p] === after[p]) p++;
  let q = 0;
  while (q < max - p && before[before.length - 1 - q] === after[after.length - 1 - q]) q++;
  const oldEnd = before.length - q, inserted = after.slice(p, after.length - q);
  const from = toSource(spans, p), to = Math.max(from, toSource(spans, oldEnd));
  const next = source.slice(0, from) + inserted + source.slice(to), grew = next.length - source.length;
  const delta = after.length - before.length, kept = [];
  let cut = false;
  for (const sp of spans) {
    const moved = sp.start >= oldEnd ? { ...sp, start: sp.start + delta, end: sp.end + delta, anchor: sp.anchor + grew }
      : sp.end <= p ? sp : null;
    if (moved && (moved.anchor === next.length || next[moved.anchor] === "\n")) kept.push(moved);
    else cut = true;
  }
  const rooms = new Map(kept.map((sp) => [lineAt(next, sp.anchor), sp.room]));
  if (!cut) return { source: next, spans: kept, rooms, text: after, caret: from + inserted.length };
  return { source: next, ...layout(next, rooms), rooms, caret: from + inserted.length };
}
