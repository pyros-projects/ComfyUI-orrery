// Help tab: the DSL at a glance, the tutorial lessons, and model-specific writing tips.
import { esc, highlight } from "./highlight.js";
import { icon } from "./icons.js";

const REF = [
  ["Wildcards", [
    ["__creature__", "one entry from a library, weighted by what you rated", "a __creature__ at dusk"],
    ["__creature[myth]__", "only entries tagged myth", "a __creature[myth]__ asleep"],
    ["__creature[myth, !bird, size=small|tiny]__", "a predicate: commas all of, | either, ! not, key=value a property (habitat=$a.habitat: what rolled before)", "a __creature[myth, !bird]__ asleep"],
    ["__clothing/*__", "a library of the folder at random (** and below, features* a name's start), then its entry", "wearing __clothing/*__"],
    ["__film/genre__", "a library in a folder: library/film/genre.yaml or .txt (one entry per line); the language model creates folder and file when they don't exist", ""],
    ["__runway_shoes:20__", "with a language model set (the gear): an unknown library is created when the node runs, and :20 tops it up to at least 20 entries; Write now in the footer writes them before the run (an API endpoint all at once; a text encoder a run each, at the queue's front)", ""],
    ["__runway_shoes__ 🎲", "a library you don't have: a run writes it (it waits in Libraries for Accept or Discard), or with an API endpoint its 🎲 writes it in a sheet: steer, pick, Keep as the library; Keep the direction keeps its directions with it (the earlier __name__(directions) still works)", ""],
    ["__characters/noir#gender:female__", "only entries with that property: props in the YAML, or key:value typed into an entry's tags in Libraries", "__characters/noir#gender:female__"],
    ["__world/habitats#habitat:$animal.habitat__", "a filter that reads an earlier roll: the place is one the animal lives in", "$animal = __subjects/animals__\na photograph of $animal in __world/habitats#habitat:$animal.habitat__"],
    ["{misty|frozen:3}", "inline choice; :3 makes frozen three times as likely", "a {misty|frozen:3} forest"],
    ["{|red }car", "an empty option makes a word optional", ""],
    ["{30% in the rain}", "the words three times in ten, nothing otherwise (the space before goes too)", "a fox {30% in the rain}"],
    ["{2$$__material__}", "two different picks, joined with commas", "built from {2$$__material__}"],
    ["{1-3$$a|b|c}", "one to three of the options", "a bouquet of {1-3$$roses|thistles|ferns}"],
    ["{a {b|c}|d}", "choices nest; inner ones roll first", "a {lighthouse {keeper|cat}|night ferry}"],
    ["{0.4-0.9}", "a number in between, at the decimals written ({2-6} for whole ones); recorded and learned like any pick", "at {0.4-0.9} strength"],
  ]],
  ["Bindings and extras", [
    ["$hero = __creature__", "roll once on its own line, reuse everywhere as $hero", "$hero = __creature__\n$hero meets another $hero"],
    ["@lib crowd", "a library of this template's own: indented lines under it are its entries; use it as __crowd__", "@lib crowd\n  a few __creature__s\n  a lone __creature__\nA meadow with __crowd__"],
    ["Ctrl+Space", "opens the completion where the caret is; a keyword's first letters offer every form of it, $hero. the fields of what it rolls, image in a CAST the gallery's characters", ""],
    ["line ends, hover", "each line shows at its end what it gives at the node's seed (a binding's roll, an export, a grid's cells, where a member's pictures go); hovering a keyword shows its forms, a CAST member who it is in this clip", ""],
    ["knobs (beside the dials)", "the template's LoRAs, RefMods, pictures and members, grouped where they hold (All clips, then each scene): step a strength, a start or an end by 0.05 (start 0 and end 1 unless written; a share of sampling), click a sweep's value to take it out or back in; a LoRA's M mutes it and S solos it (only the soloed play, in every clip), its strength kept for the click that gives it back; the template stays as written, Save bakes in what plays", ""],
    ["$hero → dial", "every binding is a dial in the sidebar beside the editor, with what it rolls at this seed: pick an entry (it keeps its properties), tick several to roll among them (its menu's filter is a regex over text, properties and tags; All, None) ({a|b}), or type any expression; empty = its default roll; Save bakes dials in (CLI: --set hero=owl)", ""],
    ["EXPORT:\n  mood = __moods__", "what the run keeps beside its prompt, never in it: rolled like a binding, kept with the picture in the gallery (its sheet), read by other systems and by screenplays that cast the picture ($hero.mood); EXPORT: $who exports a binding, with its entry's fields", "EXPORT:"],
    ["> make it moody and cinematic", "with a language model set (the gear), it rewrites the rolled prompt as asked; in a screenplay a > before the first SHOT covers every shot's prose, one inside a SHOT only that shot, never dialogue", "> make it moody and cinematic"],
    ["🎲 the takes sheet", "every ask of the language model: a slot's, a library's, a > rewrite's and the Write menu's (Continue the reel after any scene in N scenes of S seconds, the Story interpolator from a frame, the prompt or a scene to a frame, the prompt or a scene in N scenes or keyframes (it waits for them: More takes), Prompt from image, none waiting for an input: select any number, Prepend or Append to the prompt, Replace or Insert where the writer has a place, as written or as a choice). N takes as the gear says, × takes one out of the list, a steer, More takes; Send along: the prompt, first_frame, last_frame, the video (4 stills), any Gallery picture or video; a slot's or a library's Use selected puts one in, Insert as a choice several one-line takes as {a|b|c}", ""],
    ["--one detail, 5 to 8 words--", "a slot the language model writes where it stands, seeing the whole rolled prompt (and, in a reel, the clip before); image first_frame, image 3 or a gallery name in it shows the model that picture; image output waits in EXPORT: for the picture the run makes, written from the Gallery; with an API endpoint the 🎲 at its line's end offers takes (hovering it outlines its slot; Ctrl+click on the slot does the same); a library's roll at the line's end (or Ctrl+click on its name) offers its rolls and new entries for it", ""],
    ["$w.sfx", "a property of whatever $w rolled: the sound follows the weather. A property may hold {a|b}, __lib__ or LoRAs (LORA: $p.loras with $p.action); it rolls once when $w is bound", "SFX: $w.sfx"],
    ["IF $w is rain, snow: …", "a line kept only when $w rolled either of them (is not: neither); against its value, tags and properties; works for SFX lines too", "IF $w is "],
    ["{IF $w.kind is rain: wet | dry}", "a choice made by a condition instead of the dice; $w.kind compares a property", ""],
    ["IF $c[myth, size=small]: …", "the filter brackets as a condition: all of them (, ), either (|), not (!)", "IF $c["],
    ["@include effects/living_clay", "embeds a preset where it stands; indented key = value lines under it turn its dials", "@include "],
    ["# a note", "a comment: a note for you that never reaches the model", "# "],
    ["\\{OPEN\\}  \\__init__", "a backslash writes the next character as it is: { } | $ _ @ # [ ] \\ < >", ""],
    ["<lora:style:0.5,0.7,1.0>", "a LoRA sweep: Roll runs once per strength, one seed for all; 0-1;0.1 is a range with a step, several swept LoRAs combine, and the gallery shows their outputs as one album", ""],
    ["<lora:a:0.5,1.0:solo>", "solo: the solo LoRAs take turns, the others off (2 + 2 runs, not 2 × 2); <lora:a:test> is 1.0,0.7,0.5:solo", ""],
    ["<lora:style:0.4-0.9>", "a range without a step: the strength rolls per run and is recorded as a pick", ""],
    ["@style(0.8)", "short for <lora:style:0.8>, with every strength form: @style(0.4-0.9), @style(0.5,0.7)", ""],
    ["LORA: __my_lora_sets__", "a library of LoRA sets: each entry one or more tags (or \"\" for none); the set that rolled is a pick, and @grid __my_lora_sets__ runs each once", "LORA: __"],
    ["@grid __style__ × {dawn|noon}", "every combination, one run each; the rest rolls the same in all. Axes: a library, a choice or a $binding (dialed to one value: a grid of one). Roll queues them all (times a LoRA sweep)", "@grid "],
    ["@unique $hero", "seeds in a row never repeat it (8 seeds, 8 heroes); the seed's control after generate goes to increment", "@unique "],
    ["@size 832x1216", "the node's width and height outputs (wire them into your latent)", "@size 832x1216"],
    ["@batch 8  @seed 100", "CLI only (orrery expand); in ComfyUI use the Run count and the seed widget", ""],
    ["@rng 1", "the dice of before 2026-10-02: one stream for every pick (History and Gallery add it to runs from back then)", ""],
    [": x8 seed=100 w832 h1216", "the older form of the directives above; still works", ""],
    ["a __creature__", "a/an follows the picked word: “an axolotl”", ""],
  ]],
  ["H3 screenplays", [
    ["@h3 text 16:9", "first line: what the clip is made from (text, image, first-last, last, references) and the ratio", "@h3 text 16:9"],
    ["style: live-action, cinematic", "the look; opens Shot 1 as its own sentence", "style: __h3style__"],
    ["SHOT 5s: dissolve, arc, slow", "duration · optional transition · camera · small/large · slow/fast", "SHOT 4s: cut, push in, small, slow"],
    ["@h3 text 9:16", "the ratio sets width and height; all SHOT durations set length, in frames at 24 fps, for the MiniMax H3 latent", ""],
    ["@h3 text 16:9 0.6MP", "0.6MP sizes width and height by area in that ratio; the node's megapixels output carries it for resolution and scale nodes", ""],
    ["@KEEPER (raspy voice, voiceover): [French] Bonjour.", "a line of speech; off-screen or voiceover after the voice", "@KEEPER (warm, raspy old voice): The ships stopped coming."],
    ["SFX: rain drums on glass; a gong clatters", "sounds separated by semicolons; they join into “A, B, and C”", "SFX: wind worries the shutters"],
    ["MUSIC: solo cello at a slow tempo, fading out", "instruments, tempo, dynamics; no mood words", "MUSIC: a slow, sparse __instrument__ line that fades out"],
    ["<Picture 1>", "@h3 image: anchor the start frame in Shot 1", "The scene begins exactly as in <Picture 1>."],
  ]],
  ["Cast and references", [
    ["CAST", "names your references once; mention them as @NAME in shots and the summary (@ lists them, and they show in brass)", "CAST\n@MAYA (image 1): the young blonde woman, in a light-pink shirt"],
    ["@DOG (image 2, image 3): the white Samoyed, with a curved tail", "sources in parentheses (image N, video N, video N + audio, refmod NAME), then the description; later mentions use its head noun (“the white Samoyed”)", ""],
    ["@HERO (image __pictures/krea/09_character_creator__)", "a picture of the gallery by name (preset/seed brings all its views, preset/file one picture), or a character rolled from a preset's pictures; Orrery Refs loads it into a free slot from the top, no Load Image needed", "@HERO (image "],
    ["@JINX (refmod minimaxh3_jinx_v1_refmod): a young woman", "a RefMod from models/refmods (Jinx's ships with orrery). A clip that does not name @JINX leaves her out; always keeps her in every clip; a scene's own CAST replaces her for that clip", "@NAME (refmod name): "],
    ["SET: @JINX(0.6, refmods)", "a member's dials: all her pictures and RefMods, or the ones a word chooses (refmods, images, image 1, refmod NAME); (strength, start) or (strength, start, end): 0.5 holds looser, from 35% waits while the picture is laid out (a character needs the first steps), to 10% lets the prompt take over", "SET: @"],
    ["SET: image_1(0.5, 35%), refmods(1, 35%)", "one picture's or RefMod's dials by its name, and refmods(…) for the RefMods without their own: in the head for every clip, in a scene for that clip; the later line wins. No CAST needed: it dials an image named in the text (<Image 1>), and brings a RefMod in. LoRAs too: SET: turbo(0.8, 0%, 50%); the long forms <lora:…>, <refmod:…>, <image:1:…>, <cast:NAME:…> name the kind; 0.3|0.6 sweeps A picture at 0 leaves the clip; between 0 and 1 most of the change comes below 0.3", "SET: "],
    ["@h3 references 16:9 full", "the prompt's format: lite by default (one <Subject N> = … line per cast member, then three fields where each is only its label); full writes the six sections of MiniMax's guide, with summary: and retention. Works in every mode", "@h3 references 16:9 full"],
    ["keep: face, outfit", "under a cast member: a retention block goes into the prompt (lite too). Macros: all · face, hair, body, outfit (combined) · style · place · loose; or partially_preserved - your own reason", "keep: "],
    ["voice: audio 1", "on the line after a member: the voice timbre it speaks with", ""],
    ["keep: partial - only the fur colour is kept", "optional retention marker and reason (full, partial, transfer, weak)", ""],
    ["summary: @MAYA feeds @DOG in @CAFE.", "the summary of full references (a summary in lite warns); the task types are added for you", "summary: "],
    ["SHOT 5s: from image 5", "references: the shot begins from a reference picture (to image N: ends on it)", ""],
    ["[audio 1]", "a reference slot in prose; orrery writes the label the node uses", ""],
  ]],
  ["Reels (Orrery Continue)", [
    ["SCENE the salon", "one clip, continuing the one before; everything before the first SCENE (style, CAST, bindings) is the world and holds for every clip", "SCENE \nSHOT 5s: push in, slow\n"],
    ["⏮ ▶ +1 ⏭ 🔒 📊 ⧉ 🗑 (a scene's divider)", "the transport, the footer's controls where you are, for this scene: a click on a SCENE line or its divider makes its clip Next clip first; ▶ Roll this scene, ⏮ ⏭ Next clip to the first clip of the scene before or after it, +1/+2/+4 the clips a Roll plays, 🔒 hold this scene's clip; ⧉ duplicate the scene, 🗑 delete it (with Undo); 📊 the scene in numbers (where and how often it plays, what leads to it, what it rolls, what it made). What makes takes is in each clip's strip (+ take, ×N, 📌)", ""],
    ["+ take ×4 📌 (under a template without scenes)", "its results in the preview under the prompt and the dials (its grip sizes it): the live preview while it samples, then what it made; every run a take under the result, a click shows it, Circle this take makes it the one that counts (golden); the strip's head is a reel clip's too; × takes one off the list (the files stay). The takes make a shoot: finish shoot folds them into the earlier shoots under the strip, each shown by its circled take, and a click opens one again; a grid's views at one seed are one take", ""],
    ["+ take ×4 📌 ▶ all (a clip's takes)", "sample surfing, a reel clip's strip from its first take (#331: the clip itself is in the preview): + take renders 4 takes of that clip, which line up in it, the one being made last and live; a click shows one in the preview, Circle this take puts it in the film (golden), Pick frames writes frames of it into a REMEMBER: line. 📌 keeps the scene's rolled prompt (only the noise changes); without it each take rolls anew. The gear: numbered seeds or the node's control. A × on a take deletes it (it asks first). The head beside the takes: + take, ×N, 📌 and ▶ all (every take at once) on top, the clip in numbers in the middle, the others and all at the bottom; the grip at the takes' end sizes them", ""],
    ["Tree (under the reel)", "the take tree: every take of the reel, a column per clip, lines to the takes made on each, the film's path lit. A click makes the film the way through a take, and picking a take brings back the clips last made after it; ✂ ends the film after a take. Switching takes never changes the editor; ✎ marks a take made with another prompt: hover shows what changed, a click puts that prompt in the editor (with Undo). ▶ Film plays the film as clicked together above the tree, a timeline of its clips under it; hide < N after hides the takes fewer than N takes were made on (the film's and the last clip's stay)", ""],
    ["style: … (in a SCENE)", "that clip's own style, in place of the head's", "style: "],
    ["SCENE the walk ×8", "plays this scene 8 times (forever: until you stop); bindings inside a scene roll anew every clip", "SCENE the walk forever\n"],
    ["SCENE the forest (test)", "rendered and kept, but left out of the film, and it starts afresh: frames it REMEMBERs serve the scenes after it", "SCENE  (test)\n"],
    ["END ON: @MAYA reaches the door", "closes this scene and opens the next with the same words", "END ON: "],
    ["START WITH: the door bursts open", "this scene's own opening, in place of the END ON: before it", "START WITH: "],
    ["AFTER: 2", "continue scene 2's last clip (title or number) instead of the clip before: many scenes can branch off one clip, each with its own SET:", "AFTER: "],
    ["AFTER: the input video", "continue the video wired into the Orrery Prompt's video input (Orrery Continue needs the vae and audio_vae); an END ON: in the head says how the video ends, a REMEMBER: there keeps its frames for every clip", "AFTER: the input video\n"],
    ["CUT TO: the stairs ×2 (30%)", "at a scene's end: jump to that scene (title or number) instead of going on; ×2 twice, then on, without ×N for good; (30%) that often", "CUT TO: "],
    ["IF $w is a storm: CUT TO: the stairs", "a jump on what this clip rolled: each seed its own story; a divider names the next clip its scene plays at the node's seed, and its 📊 where and how often it plays", "IF $w is "],
    ["$look[-1]", "$look as it was one clip ago ([-2]: two clips); $look[\"the salon\"]: when that scene last played. With Orrery Film, as its take rendered it, like the head's bindings and the END ON: a clip opens with", "$look[-1]"],
    ["REMEMBER: first frame as @GIRL", "that frame of this clip becomes GIRL's picture for the clips after it: the CAST's image of hers, or a free one; wire the picks into Orrery Refs and it comes out there (a picture wired there stands in until then)", "REMEMBER: first frame as @"],
    ["REMEMBER: frames 0, 50 as @GIRL", "a picture of hers per frame: her CAST's first ones, then free ones; the clips view shows each frame and where it goes before any run, and under the takes as the scene's anchors: what it hands on to the clips after it (with keep_sent on in Orrery Refs, the stored anchor it holds)", "REMEMBER: frames 0, 50 as @"],
    ["REMEMBER: frames at 1s, 2s as image 4", "frames by second, by number (frames 2, 5, 34-46; -1 the last) or by word (first frame, last frame) as one picture of the CAST (a batch)", "REMEMBER: frame at 1s as image "],
    ["REMEMBER: every 10th frame as refmod outfit", "a RefMod of those frames (… of 1s-4s: of a range) for the clips after it, where the CAST names refmod outfit; Orrery RefMods builds it from the chain (it needs the VAE)", "REMEMBER: every 10th frame as refmod "],
    ["REMEMBER: last frame as image 5 in clips 4+", "only those clips (from 1: 4, 4-8, 4, 6, 7), or until a scene first plays (… until the stairs), so several lines can fill one picture in turns", "REMEMBER: last frame as image "],
    ["LORA: <lora:name:0.8>", "put on the model that passes through the node (no LoRA node needed): lines before the first SCENE always, a scene's own only there; after LORA: the editor lists your LoRA files", "LORA: "],
    ["context: 22", "the frames each clip continues from (Orrery Continue pins 22; Motion Context 5, 22, 39, 56); from the second clip on, Shot 1 and length include them", "context: 22"],
    ["Orrery Continue · Orrery Film", "picks and the H3 node's latent into Orrery Continue, its latent into the sampler; the sampled latent and the decoded clip into Orrery Film, which keeps the takes and joins the film, a clip's end as the next clip decoded it (no jump in picture or sound where they meet); the segment counts up by itself, so Roll next N clips plays the reel", ""],
    ["CHUNK · HANDOFF: · GOTO: · SEND: · $x~1 · ? $x[a]:", "the words of earlier orrery: they still work, with the same dice", ""],
  ]],
];

const TIPS = [
  ["Krea 2", 'Write sentences, not tag lists. Name the medium and the shot in the first sentence ("A cinematic photograph: a head-and-shoulders portrait of …"), or Krea picks them for you. Describe only what the shot can show: whatever you name pulls the camera to include it. A second subject gets a sentence of its own, with its place. Say what is there, never what is not. Put words to render in quotes: a sign reading "OPEN".'],
  ["Krea 2 faces", "Expressions want Krea 2 Raw with the turbo LoRA: the Turbo checkpoint gives the same flat face whatever the prompt says."],
  ["H3 cuts", "Start shots 2+ with a noun phrase: the compiler writes “the camera cuts to …” in front of it."],
  ["Any prompt on H3", "A template without SHOT lines (a Krea prompt, say) compiles for h3-base as one 5 s shot. Add a SHOT line when you want to set the duration or the camera."],
  ["H3 length", "All shots together: 4–15 s. Up to four SFX lines. Wire the node's width, height and length into the MiniMax H3 latent node instead of copying them."],
  ["Weights", "(word:1.2) does nothing on H3 or Krea 2; use {a|b:3} to change the odds instead."],
  ["Ref2VA labels", "orrery numbers <Subject N>, <Picture i>, <Video k> and <Audio j> exactly like the Reference to Video node: images and videos by slot, audio after the video soundtracks. In the other modes, cast names expand to their descriptions."],
];

// The Help tab in pages (#309): a page nav on the left, as the Settings have, each page with room for its text.
const slug = (h) => h.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const PAGES = [["start", "Start"], ...REF.map(([h]) => [slug(h), h]), ["models", "Writing for the models"], ["keys", "Keys in the editor"], ["settings", "Settings"]];

function pageHTML(app, page) {
  const known = app.known();
  if (page === "start") {
    const lessons = app.data.presets.filter((p) => p.name.startsWith("tutorial/"));
    return `<p class="flush">A template rolls words from a seed: libraries (<code>__animal__</code>), choices (<code>{dawn|dusk}</code>) and bindings (<code>$hero = __animal__</code>), and every pick is kept, so a run can be made again, rated and learned from. Write in <b>Prompt</b>, see what it rolls in <b>Test</b> without queueing anything, and <b>Roll</b> in the footer queues it. What comes out lands in the preview under the prompt and in the <b>Gallery</b>, where ratings teach the dice.</p>`
      + `<p class="muted flush">The lessons go from a first wildcard to a three-shot H3 scene: open one, press Test, change something.</p>`
      + `<div class="lessons">${lessons.map((p) => {
        const [num, ...rest] = p.title.split(" · ");
        return `<button class="lesson" data-load="${esc(p.name)}"><span class="ln">${esc(rest.length ? num : "")}</span><span>${esc(rest.join(" · ") || p.title)}</span></button>`;
      }).join("")}</div>`;
  }
  if (page === "models") return `<div class="tips">${TIPS.map(([k, tip]) => `<p><b>${k}.</b> ${esc(tip)}</p>`).join("")}</div>`;
  if (page === "keys") {
    return `<p class="muted flush"><code>__</code> libraries, by any part of the name (<code>__hai</code> finds <code>characters/gothic/hair</code>) · <code>__name[</code> tags · <code>__name#</code> properties and their values · <code>$</code> bindings · <code>SHOT 5s:</code> camera words · ↑↓ choose · ↵ or Tab insert · Esc close · Ctrl+Space opens the completion where the caret is</p>`
      + `<p class="muted flush">In a reel's preview (click into it): ← → the scene before or after, Shift+← → the take before or after in the scene. In its frame picker: ← → a frame back or on, M marks the frame.</p>`;
  }
  if (page === "settings") {
    return `<p class="muted flush">The gear opens them, the gear again brings the tab back: Home, Language model, Writers, Editor (with where the annotations go: at the line ends, on hover, or none), Clips (live preview, sample surfing), Log and Reset (ratings, history, gallery, presets, libraries or everything, each asked first). A setting is saved the moment it changes; the home folder, an API endpoint (checked first) and a writer's text have buttons of their own.</p>`;
  }
  const [, rows] = REF.find(([h]) => slug(h) === page) || REF[0];
  return `<div class="ref">${rows.map(([code, what, ex]) => `<div class="refrow"><pre class="codebox">${highlight(code, known)}</pre>`
    + `<span class="muted">${esc(what)}</span>${ex ? `<button class="btn ghost" data-insert="${esc(ex)}" title="Add to the end of your template">${icon("plus")}Insert</button>` : "<span></span>"}</div>`).join("")}</div>`;
}

export function renderHelp(app) {
  const s = app.state;
  s.helpPage ??= PAGES.some(([k]) => k === app.bridge.props.orrery_help) ? app.bridge.props.orrery_help : "start";
  const [, title] = PAGES.find(([k]) => k === s.helpPage);
  app.view.innerHTML = `<div class="settings help-pages"><nav class="set-nav" aria-label="Help">${PAGES.map(([k, label]) =>
    `<button type="button" class="${k === s.helpPage ? "on" : ""}" data-hpage="${k}" aria-current="${k === s.helpPage}">${esc(label)}</button>`).join("")}</nav>`
    + `<div class="set-main scroll"><div class="set-head"><h4>${esc(title)}</h4></div><div class="help">${pageHTML(app, s.helpPage)}</div></div></div>`;
  app.view.onclick = (e) => {
    const page = e.target.closest("[data-hpage]");
    if (page) { s.helpPage = page.dataset.hpage; app.bridge.props.orrery_help = s.helpPage; return renderHelp(app); }
    const lesson = e.target.closest("[data-load]");
    if (lesson) return app.loadPreset(lesson.dataset.load);
    const ins = e.target.closest("[data-insert]");
    if (!ins) return;
    const text = app.text.replace(/\s*$/, "");
    app.text = `${text}${text ? "\n" : ""}${ins.dataset.insert}`;
    app.go("prompt");
    const ed = app.view.querySelector("textarea");
    ed.focus();
    ed.setSelectionRange(ed.value.length, ed.value.length);
    app.toast("Added to the end of your template");
  };
}
