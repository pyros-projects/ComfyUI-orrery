import assert from "node:assert/strict";
import { test } from "node:test";

import { framePicks, hintsFor, hintText, rememberLines, setFrame, shown, stripHTML } from "../../comfyui/web/app/remember.js";

test("the frames a line takes are chain.frame_picks', every step-th of them", () => {
  assert.deepEqual(framePicks(124, [[50, 50]]).picks, [50]);
  assert.deepEqual(framePicks(124, [[-1, -1]]).picks, [123]);  // the last frame
  assert.deepEqual(framePicks(124, [[24, 96]], 10).picks, [24, 34, 44, 54, 64, 74, 84, 94]);
  assert.deepEqual(framePicks(124, [[-24, -1]]).picks.length, 24);
  const past = framePicks(124, [[200, 200]]);
  assert.deepEqual(past, { picks: [123], dropped: [200] });  // past the end: dropped, the last stands in
});

test("a long range shows a dozen of its frames, spread out, first and last among them", () => {
  const all = Array.from({ length: 73 }, (_, i) => i);
  const some = shown(all);
  assert.equal(some.length, 12);
  assert.equal(some[0], 0);
  assert.equal(some.at(-1), 72);
  assert.deepEqual(shown([3, 4]), [3, 4]);
});

const LINES = [
  { line: 0, scene: 0, source: 0, said: "frame 0 as @WOMAN",
    fills: [{ what: "image 1", member: "WOMAN", frames: [[0, 0]], step: 1, clips: [[1, null]], replaced: { from: 1, by: 1 } }] },
  { line: 1, scene: 0, source: 0, said: "frames 10, 50 as @WOMAN",
    fills: [{ what: "image 1", member: "WOMAN", frames: [[10, 10]], step: 1, clips: [[1, null]], replaced: null },
      { what: "image 3", member: "WOMAN", frames: [[50, 50]], step: 1, clips: [[1, null]], replaced: null }] },
  { line: 2, scene: 1, source: 2, said: "every 10th frame as refmod pose",
    fills: [{ what: "refmod pose", member: null, frames: [[0, -1]], step: 10, clips: [[3, 5]], replaced: null }] },
  { line: 3, scene: 2, source: null, said: "last frame as image 4",
    fills: [{ what: "image 4", member: null, frames: [[-1, -1]], step: 1, clips: [], replaced: null }] },
];

test("a hint says what a line fills, for whom, in which clips, and what replaces it", () => {
  assert.equal(hintText(LINES[0], LINES), '→ image 1 · @WOMAN · clips 2+ · replaced from clip 2 by "frames 10, 50 as @WOMAN"');
  assert.equal(hintText(LINES[1], LINES), "→ images 1, 3 · @WOMAN · clips 2+");
  assert.equal(hintText(LINES[2], LINES), "→ refmod pose · clips 4–6");
  assert.equal(hintText(LINES[3], LINES), "never plays at this seed");
});

test("hints find their lines by their place among the REMEMBER: lines, across cells too", () => {
  const text = "@h3 references\n# REMEMBER: not this one\nSCENE a\nREMEMBER: frame 0 as @WOMAN\nSHOT 5s\nREMEMBER: frames 10, 50 as @WOMAN";
  assert.deepEqual(rememberLines(text), [3, 5]);
  const hints = hintsFor(text, { lines: LINES });
  assert.deepEqual([...hints.keys()], [3, 5]);
  assert.equal(hints.get(3).replaced, true);
  assert.equal(hints.get(5).replaced, false);
  const second = hintsFor("SCENE b\nSEND: every 10 frames to refmod pose", { lines: LINES }, 2);  // a cell after two lines
  assert.equal(second.get(1).text, "→ refmod pose · clips 4–6");
  assert.equal(hintsFor(text, null).size, 0);
});

test("a frame picked by eye rewrites just that frame of the line", () => {
  assert.equal(setFrame("REMEMBER: frame 50 as @WOMAN", 0, 20), "REMEMBER: frame 20 as @WOMAN");
  assert.equal(setFrame("REMEMBER: frames 10, 50 as @WOMAN in clips 2+", 1, 37), "REMEMBER: frames 10, 37 as @WOMAN in clips 2+");
  assert.equal(setFrame("REMEMBER: first frame as image 2", 0, 5), "REMEMBER: frame 5 as image 2");
  assert.equal(setFrame("REMEMBER: frame at 1.5s as @WOMAN", 0, 12), "REMEMBER: frame 12 as @WOMAN");
  assert.equal(setFrame("  SEND: frame 3 to image 1", 0, 4), "  SEND: frame 4 to image 1");
  assert.equal(setFrame("REMEMBER: frames 34-46 as image 3", 0, 40), null);  // a range is not one frame
  assert.equal(setFrame("REMEMBER: every 10th frame as refmod pose", 0, 40), null);
});


test("a scene's anchors: a head says what they are, a grip sizes them, keep_sent holds what has an anchor (#371)", () => {
  const app = { api: { anchorURL: (n, v) => `/orrery/anchor?image=${n}&v=${v}` }, data: { anchorV: 7, anchor_h: 120, remembered: { lines: LINES } } };
  const off = stripHTML(app, 0, "/clip.mp4");
  assert.match(off, /class="th-clip">anchors</);
  assert.match(off, /<i>images<\/i><b>1, 3<\/b>/);
  assert.match(off, /<i>keep_sent<\/i><b>off<\/b>/);
  assert.match(off, /--rm-h:120px/);
  assert.match(off, /data-rm-grip/);
  assert.doesNotMatch(off, /held · image/);  // off: the frames of the circled take are what goes on
  const on = stripHTML(app, 0, "/clip.mp4", { keep: true, stored: [1] });
  assert.match(on, /src="\/orrery\/anchor\?image=1&amp;v=7"/);
  assert.match(on, /<i>held<\/i><b>1<\/b>/);
  assert.doesNotMatch(on, /held · image 3/);  // no anchor stored: Orrery Refs fetches it fresh, as with keep_sent off
  assert.equal(on.match(/class="rm-line[^"]*held"/g).length, 1);  // the line that fills only image 1: its frames wait
  assert.match(stripHTML(app, 1, "/clip.mp4"), /<i>images<\/i><b>none<\/b>/);  // a RefMod has no anchor
  assert.equal(stripHTML(app, 2, "/clip.mp4"), "");  // never plays at this seed
});
