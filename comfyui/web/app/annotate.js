// Annotations at line ends (#163): what a line gives at the node's seed, from /orrery/annotate. A binding
// shows what it rolled, an EXPORT what it keeps, a grid its cells, a CAST member where its pictures go, and every
// library in a line its own roll (#202). The setting says where they show (#203): at the line ends, on hover, or not.

const BINDING = /^\s*\$([A-Za-z_]\w*)\s*=\s*(.*)$/;
const EXPORT = /^\s*EXPORT:\s*(.*)$/;
const EXPORT_LINE = /^\s+(?:\$([A-Za-z_]\w*)|([A-Za-z_]\w*)\s*=)/;
const GRID = /^\s*(?:@grid\b|:\s*grid\b)/;
const MEMBER = /^\s*@?([A-Z][A-Z0-9 _-]*?)\s*(?:\([^)]*\))?\s*:\s*\S/;
const ENDS_CAST = /^\s*(?:SHOT|SCENE|CHUNK)\b/;

// line index → { text, kind: "note", thumbs, note, rolls }; `thumb(id)` makes a gallery picture's thumbnail URL,
// so a CAST line with named pictures shows them after it (#137). `offset`: the first line's index in the template
// (a cell's), as the server counts the lines of its libraries' rolls: `rolls` [[k, roll]], the line's k-th
// `__…__` and what it rolled; `note` what the line says besides.
export function annotationLines(text, ann, thumb = null, offset = 0) {
  const out = new Map();
  if (!ann) return out;
  const put = (i, value) => { if (value) out.set(i, { text: value, kind: "note", note: value }); };
  let block = false, cast = false;
  text.split("\n").forEach((line, i) => {
    if (block && EXPORT_LINE.test(line)) {
      const m = EXPORT_LINE.exec(line);
      return put(i, ann.exports?.[m[1] || m[2]] && `→ ${ann.exports[m[1] || m[2]]}`);
    }
    block = false;
    if (line.trim() === "CAST") { cast = true; return; }
    if (ENDS_CAST.test(line)) cast = false;
    let m;
    if ((m = EXPORT.exec(line))) {
      if (!m[1].trim()) { block = true; return; }
      const names = /^\s*([A-Za-z_]\w*)\s*=/.exec(m[1]) ? [/^\s*([A-Za-z_]\w*)/.exec(m[1])[1]]
        : [...m[1].matchAll(/\$([A-Za-z_]\w*)/g)].map((x) => x[1]);
      return put(i, names.map((n) => ann.exports?.[n]).filter(Boolean).map((v) => `→ ${v}`).join("  "));
    }
    if ((m = BINDING.exec(line))) {
      const value = ann.bindings?.[m[1]];
      return put(i, value && value.trim() !== m[2].trim() ? `= ${value}` : "");  // a plain text says itself
    }
    if (GRID.test(line)) return put(i, ann.grid && `→ ${ann.grid}`);
    if (cast && (m = MEMBER.exec(line)) && ann.cast?.[m[1].trim()]) {
      const own = [...(/\(([^)]*)\)/.exec(line)?.[1] || "").matchAll(/\bimage\s+(\d+)/gi)].map((x) => +x[1]);
      if (ann.cast[m[1].trim()] === slotsText(own)) return;  // `(image 1)` → image 1 says nothing new
      put(i, `→ ${ann.cast[m[1].trim()]}`);
      const ids = (ann.members?.[m[1].trim()]?.pictures || []).map((p) => p.id).filter(Boolean);
      if (thumb && ids.length && out.has(i)) out.get(i).thumbs = ids.slice(0, 4).map(thumb);
    }
  });
  for (const [at, rolls] of Object.entries(ann.rolls || {})) {  // every library in a line, in its order (#202)
    const i = Number(at) - offset, lines = text.split("\n").length;
    if (i < 0 || i >= lines || !rolls.length || BINDING.test(text.split("\n")[i])) continue;
    const said = `→ ${rolls.map(([, v]) => v).join(" · ")}`, h = out.get(i);
    out.set(i, h ? { ...h, text: `${h.text}  ${said}`, rolls } : { text: said, kind: "note", note: "", rolls });
  }
  return out;
}

// The hints as the setting shows them (#203): `appended` at the line ends, `hover` on what they belong to (the
// highlighter marks it), `none` not at all.
export function shownHints(show, hints) {
  if (show === "none") return new Map();
  if (show !== "hover") return hints;
  return new Map([...hints].map(([i, h]) => [i, { ...h, hover: true, note: h.note ?? h.text }]));
}

// image 6–9, images 2, 5: as the server writes a member's slots (webapi._slots).
export function slotsText(numbers) {
  const n = [...new Set(numbers)].sort((a, b) => a - b);
  if (!n.length) return "";
  if (n.length > 2 && n.every((v, k) => v === n[0] + k)) return `images ${n[0]}–${n[n.length - 1]}`;
  return `image${n.length > 1 ? "s" : ""} ${n.join(", ")}`;
}

// REMEMBER's hints win where a line has both; `lines` maps a cell's lines into the template's (offset).
export function mergeHints(first, second) {
  const out = new Map(second);
  for (const [i, h] of first) out.set(i, h);
  return out;
}
