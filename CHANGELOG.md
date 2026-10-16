# Changelog

What changed for people who use orrery, one line per pull request. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). Changes to how orrery is developed (the dev flow, the
checks) are left out.

## [Unreleased]

### Added

- `orrery serve` (#439): orrery's HTTP API, the `/orrery/*` routes, on a server of its own, without ComfyUI and
  without loading a model, for the standalone studio. `--home` picks the home, `--output` ComfyUI's output folder for
  the take tree; a route that needs a running ComfyUI says so. `uv sync --extra serve` adds aiohttp.
- The preview steps through a reel (#430): ⏮ ⏭ to the scene before or after (its circled take), ‹ › through the
  scene's takes over its clips, and with the preview focused ← → for scenes, Shift+← → for takes. The frame picker
  keeps ← → for frames.
- A transport in every scene divider (#340): ⏮ ⏭ move Next clip to the scene before or after, ▶ Rolls, +1/+2/+4 sets
  the clips a Roll plays and 🔒 holds the clip, the footer's controls where you are, however tall the node; ⧉ duplicates
  the scene and 🗑 deletes it, with Undo (#344).
- One sheet for every ask (#333): the Write menu's writers open the 🎲 takes sheet a slot or a library opens, N takes
  as the settings say (a count for each writer), steered; nothing in the menu waits for an input any more
  (Continue makes a screenplay without scenes a reel; a writer without its pictures writes from what came along).
  Every sheet can **send along** the prompt, first_frame, last_frame, four stills of the video and any picture or video
  of the Gallery, and several one-line takes go in **as a choice**, `{a|b|c}`. A writer's sheet takes any number of takes (× takes one
  out of the list), **Prepends** or **Appends** them to the prompt in every mode, **Replaces** or **Inserts** them where
  the writer has a place, as written or as one choice (a `$take` binding and IF lines for shots and scenes); the prompt
  sent along is told what it is for, and the steer outweighs the rest. Prompt from image with the prompt sent along on
  a screenplay writes the next shot of it, with who the picture shows joining the story there. Continue picks the scene it continues
  after, a reel that plays on and on too, and how many new scenes of how many seconds, and Replace or Insert says whether the scenes after it stay (#342). Story
  between frames became the **Story interpolator** (#343): from first_frame, the prompt or any scene to last_frame, the
  prompt or any scene, in N scenes of S seconds (a cat's photo to the prompt: her walk into the screenplay's forest); on an image prompt N keyframe prompts on a grid, so one Roll renders the storyboard.
- Shoots (#320, under #318): a template's takes make a shoot, like a sitting in a photo studio. Finish shoot folds them
  into the earlier shoots under the strip, each shown by its circled take, and the next Roll starts a new one; a click
  opens an earlier shoot again. A grid's or a sweep's runs at one seed are one take: a creator's four views together.
  The Gallery shows a shoot as an album, its circled take first, a grid's runs together inside it (#321).
- Generate in the Libraries tab (#322): a yellow Generate beside Add opens the 🎲 sheet for a library of yours with new
  entries the language model writes, as many as the settings' "new for a library", none it has; steer them, ask for
  more and add the good ones.
- Surprise me (#149): `loops/surprise_me` casts a character of a Krea creator and a place of the landscape or setting
  creator from your gallery, rolls a genre (thirty, from soap opera to puppet show) and a director's hand told by what
  it does, and goes on for ever: every clip throws the hero into a wild scenario, every fourth the genre has its big
  moment. The landscape and setting creators export `cast = backdrop` and their sound, so a reel tells a place from a
  character.
- Wild scenarios (#150): eight libraries of situations under `scenarios/` (fantasy, sci-fi, pirates, fights, festive,
  everyday, dreamlike, abstract), sixty each, from tame through odd and wild to abstract, and two presets that roll
  one and let the model picture it: `krea/18_wild_scenarios` in a still look and `h3/16_wild_scenarios` in a video
  look. `$wild` dials how far from plausible it goes.
- A setting creator for Krea 2 (#145): `krea/17_setting_creator` rolls one of a hundred and fifty places people are
  in (rooms, halls, shops, streets, vehicles, ruins) in five worlds (everyday, fantasy, cyberpunk, sci-fi, noir), with
  what fills it, its light and its sound, empty; the grid shows it in four shots: the outside, the whole of it, one part
  with open floor in front for a character, and one thing in it up close.
- A landscape creator for Krea 2 (#144): `krea/16_landscape_creator` rolls one of eighty lands in a season of its
  climate, a sky the season allows, an hour the sky allows and one sign of life that belongs there, never a person,
  and the grid shows the place from four distances: establishing, wide, medium and the ground up close, with the trace
  the sign of life left. It exports the land, the sky and their sounds for a reel that casts it.
- The Gallery in albums (#290): on the left every output, every picture and every video, then the days (each with its
  images and videos) and the collections; a sweep's or a grid's runs, a reel's clips and each of its scenes are one
  album's card with up to eight of its pictures, opened with a click. Collections take the place of folders: they hold
  outputs without moving them, one output in as many as you like; folders from before are collections now.
- History says what a `> enhance` line did to a run: the instruction, the prompt before it, and whether the rewrite
  was kept with Use selected or written for the run (#290).
- Resets in the Settings (#290): the ratings, the history, the gallery, the presets or the libraries back to factory,
  or everything at once; what was made by hand goes to the home's trash, the logged files only when asked.
- The preview (#290): a section of its own under the prompt and the dials, sized by its grip; the live preview while a
  run samples, then the clip or take clicked, playing with its controls, or a template's result with its takes under
  it. A click only shows a take: the one that counts (the film's, a single run's output) is golden, and Put in the film
  or Use this take chooses another. A reel's clip picks frames for a REMEMBER: line of its scene. The preset's
  description folds to one line.
- Presets in a tree like the Gallery's (#290): every preset, the image presets, the video presets, the favorites and the
  recent ones, and the folders as collections, each with its images and videos; filters by name, kind (still, scene,
  reel), date and a regex over the template text, and in the Gallery by preset, kind, date and a regex over the prompt.
- Help in pages (#290): a start with the lessons, the language section by section, writing for the models (Krea 2's
  format and its faces), the keys and the settings.
- An expression creator for Krea 2 (#291): `krea/15_expression_creator` rolls a character in a close-up, and the
  grid shows it in the eight expressions of a set (basic, subtle, intense, social, inner, playful); each expression
  says what the face does and the muscles that do it, in FACS action units. Render it with Krea 2 Raw and the turbo
  LoRA: the Turbo checkpoint gives one flat face whatever the expression.
- A shelf of character creators for Krea 2 (#138): fantasy (`krea/10_fantasy_creator`: a human or one of sixty
  peoples, each with its own body, a class with its clothes and gear, a familiar), cyberpunk (`krea/11_…`: 32 roles,
  chrome, street fashion, gangs, a neon city), sci-fi (`krea/12_…`: forty species, thirty roles), creatures
  (`krea/13_…`: seventy kinds with coverings, features and habitats, and the sound each makes) and noir (`krea/14_…`:
  a 1940s city in black and white with one colour). They share new parts with the Character creator (facial hair,
  motifs, things in hand, companions), each roll the same character from four sides, the shot first and only what
  each view can show (gear, companions and the body's chrome in the full figure), and each exports what the picture
  cannot show for a reel that casts it.
- Local language models, one task per run (#171): with a text encoder, Roll queues a run of its own (Orrery Ask) for
  each of a run's language-model tasks ahead of it (each library, the rewrites, each slot), and the run takes their
  answers; Write now and the takes at the line work with a text encoder too, in runs of their own at the front of the
  queue.
- The language model at the line (#170): with an API endpoint, a 🎲 at the end of a slot's line, of a library still to
  be written and of a `> enhance` line opens three takes for that place at the node's seed; **More takes** asks for
  three more, a steer goes with them; a click selects a take, **Use selected** puts it in place and **Keep the
  direction** writes the steer into its directions, both with Undo; a `> enhance` take is kept for its roll, and the
  run uses it instead of asking. A library still to be written is written in its sheet (as many entries as a new
  library starts with): pick the good ones and **Keep as the library** writes them straight in; a library that exists
  opens from its roll at the line's end (or Ctrl+click on its name) with its rolls and new entries to **Add to the
  library**. Slots are violet in the editor, a 🎲 outlines its place while the pointer is on it, and Ctrl+click on a
  slot opens its takes. How many takes each 🎲 asks for is a setting. `__name__(directions)` is deprecated: it still works, and a
  library keeps its directions itself. A slot sees the pictures it names (`image first_frame`, `image last_frame`,
  `image 3`, a gallery name); one from `image output` waits in `EXPORT:` for the picture the run makes and is written
  from the Gallery, its 🎲 in the picture's sheet, or after every run (the gear's *Picture slots*). `docs/llm.md`
  holds every language-model feature on one page.
- A reel's past is what was rendered: each take keeps its bindings and its `END ON:`, and the clips after it read
  them (and the scenes the film went through) from the takes, not from a new roll with libraries, ratings or earlier
  scenes changed since; what has no take rolls as before (#261).
- A template without scenes, a Krea prompt or an `@h3` scene, has its results under the prompt: the live preview while
  it samples (an image model's preview sized by its own latent format), then what it made; every run a take under the
  result, a click shows it, and +, ×N and 📌 make takes as in a reel's scenes (#211).
- Every library in a line says what it rolled at the line's end, in order (`→ arcade · bob cut · tracksuit`), one in
  a branch that did not roll nothing; and the settings' *Annotations* puts them all at the line ends, on hover (what
  has one underlined quietly, its roll shown on hover) or nowhere (#201).
- The take tree: every take of a reel keeps its path, and picking it brings back the clips last made after it. **Tree**
  shows them all like a git graph with videos, the film's path lit; a click makes the film the way through a take, ✂
  ends it after one, ▶ Film plays the film as clicked together, a timeline of its clips under it, and a filter hides
  the dead ends (the takes fewer than N takes were made on). Switching takes
  never changes the editor; a take made with another prompt carries ✎, its hover shows what changed and a click puts
  that prompt back in the editor, with Undo. Beside a clip's takes, a column: play all, the clip in numbers, the
  others and all (#213).
- A clip's takes play all at once, from the start and in step, to compare their motion: play all, stop all (#227).
- The template's knobs beside its dials: LoRAs, RefMods, pictures and members, grouped where they hold (all clips,
  then each scene), with strength, start and end in number fields stepping 0.05 and a sweep's values as chips;
  turned as dials are, the template stays as written and Save bakes them in (#227).
- One way to turn the model's knobs: LoRAs, RefMods, pictures and members take (strength, start, end), in `SET:` or
  their own long form (`<lora:…>`, `<refmod:…>`, `<image:N:…>`, `<cast:NAME:…>`); a LoRA comes on at its start and
  goes off at its end, every field sweeps with `|` or a range, and `<` completes the long forms: `<refmod:` lists
  your RefMods, `<lora:` your LoRAs, `<cast:` the members (#227).
- A reference needs no CAST: `<Image N>` in the text, as H3's own prompts write it, hands the picture to H3 as
  `[image N]` does; `SET: image_N(…)` dials it, and `SET:` with a RefMod's name brings that RefMod in, with
  strength, start and end. Tutorial 19 shows it (#224).
- A clip's takes go at once: under their label, **the others** keeps only the one in the film, **all** deletes that
  one too and the film ends before the clip; each asks first (#234).
- The Orrery Prompt puts its `LORA:` lines on the model that passes through it, a clip's own and the head's, a
  sweep's run included: no LoRA node needed (#208).
- The language model can be an API endpoint (OpenAI, or a server that speaks its protocol), set in the gear
  with a key kept in the home's `.env`: a run's libraries, slots and `> enhance`, the Write menu and
  `orrery lib` go through it, beside ComfyUI (no VRAM, no queue). The Write menu answers while a render
  runs, and **Write now** writes a template's open libraries at once (#165).
- The editor remembers the language for you: a completion popup you can read (it wraps, previews in full,
  opens upward near the bottom, Ctrl+Space), every form of a keyword as you type its start, fields after
  `$hero.`, the gallery's characters with thumbnails after `image `, each line's result at its end (a
  binding's roll, an export, a grid's cells, where a member's pictures go), and hover help on keywords,
  CAST members, libraries and bindings (#132).
- A dial takes several choices: tick them in its menu, and it rolls among them (`{noir|gothic}`); on a
  library the chosen entries keep their properties (#156).
- `EXPORT:` keeps what a template rolled beside its prompt, never in it: the gallery, History and
  `orrery expand --json` hold it for other systems, the Gallery shows it as a sheet, and a picture
  carries it into the screenplays that cast it (`$hero.mood`). The Character creator exports who it
  drew (`$who`), a mood, a quirk, two skills and a voice (#157).
- Pictures by name in the CAST: `@HERO (image krea/09_character_creator/1283456183)` takes a character
  from the gallery with all its views, `image __pictures/<preset>__` rolls one (the gallery is a library,
  steered by ratings, `[origin!=$hero.origin]` for one who differs), Orrery Refs loads them without a Load Image, and a `--…--` description is written
  from the prompt that made them. A slot's commas in a CAST line stay inside the slot, two members' slots with the same
  directions get a text each, and the text reads as the member's definition (#128).
- A character creator for Krea 2 (`krea/09_character_creator`): an original character from about 800 parts
  (a silhouette, a signature colour carried through clothes and accents, one detail you remember, a face,
  hair that fits the age, seven genres, women in women's clothes and men in men's), every part a dial,
  shown from four sides as references. A grid axis dialed to one value is a grid of one (#121).
- The clips view is where a reel is worked: the default view, its clips big (a clip size in the
  settings sets their shorter side), the frames each `REMEMBER:` line takes cut from its clip as you
  type, where they go at the line's end, and a frame picked by eye written into the line (#97).
- Five presets for what no preset showed yet: The specimen (a Backrooms film that casts its monster
  in a test scene), Three endings (one setup, three genres with `AFTER:`), Cabinet of curiosities
  (`@unique` and `@grid` on Krea), And then… (your own video, going on forever) and Between two
  frames (first-last). The docs say what the language guarantees (`docs/dsl.md`), and the doc
  status lines what is built (#23).
- A reel can start from a video of your own: the Orrery Prompt's `video` input, the head's `END ON:`
  and `REMEMBER:` for it, and `AFTER: the input video`; Orrery Continue encodes its last 22 frames
  and their sound (#87).
- DSL 2.0, the film words: `SCENE`, `END ON:`, `START WITH:`, `AFTER:`, `CUT TO:` with `×N` and
  chances, `IF $x is …:`, `REMEMBER: … as @NAME`, `SET: @NAME(…)`, `@NAME` members, `(test)` scenes
  and history by title (`$x["the stairs"]`); the earlier words still work (#81).
- A picture's strength also reaches the vision tokens its text encoder writes into the text, so
  `SET: image_1(0.5)` turns down the whole picture (#66).
- RefMod memory for reels: a clip gets the RefMods its CAST names, with a strength, a start and an
  end, including RefMods made from the reel's own frames (#59).
- orrery's boot banner stands out in the ComfyUI console, with what loaded and what did not (#60).

### Changed

- orrery installs on Python 3.12 as well as 3.13 (#365): many ComfyUI installs run on 3.12, which orrery refused.
- A scene shows its clips as their strips of takes only (#331): the box of the clip above them is gone, the clip
  big is in the preview, and the take being made forms at the end of its strip, small, beside the preview's big one. The
  Clip size setting went with the box.
- One strip of takes everywhere (#319, under #318): a reel's clip has the head the results have (+ take, ×N, 📌, ▶ all
  for videos, the clip in numbers, the others and all), from its first take; its + take renders a take of that very
  clip. The scene divider keeps 📊 and loses its jump buttons. The take chosen is **circled**: Circle this take replaces
  Use this take and Put in the film.
- Infinite backrooms goes all out (#217): nearly sixty levels, forty ways from one to the next, forty things that happen
  on the walk, forty things of orrery's own that find the camera besides the SCPs, each with its way out (look away,
  hold your breath, run, the water, hide, the camera light, follow it, a kindness), and the hiding places, chase routes
  and approaches rolled. The levels and exits are shared, so `loops/backrooms` and `the_specimen` roll from the larger
  lists too and their picks move.
- The Character creator puts the shot first (#138): "A studio photograph: a head-and-shoulders portrait of …", and
  each view says its pose in a sentence of its own, the way Krea 2's own samples are written; the picks stay the same.
  How a Krea 2 preset is written is in docs/presets.md ("Writing a Krea 2 preset").
- The language model is the one chosen in the gear: the Orrery Prompt (and Orrery Write) have no `clip` input any
  more, and a workflow that wired one loses the link when it loads (#282).
- The settings are a tab of their own, behind the gear: their sections on the left (Home, Language model, Writers,
  Editor, Clips, Log), the one chosen on the right. A setting is saved the moment it changes, no Save at the end of a
  long page; the home folder, an API endpoint and a writer's text keep buttons of their own, and a setting changed on
  its own no longer asks the endpoint (#212).
- A sweep's values are separated by `|` (`<lora:x:0.5|1.0>`), since commas separate a knob's fields now; the
  comma lists of before still sweep as they did, and the log suggests `|` (#227).
- The `lora_stack` output is gone, since a LoRA stack needed a third-party node: the LoRAs go on the model through
  the node. A workflow saved with it loses it when it opens, and its other outputs keep their links (#208).
- A reel keeps its clips in a folder named after it, `output/reels/<preset>` or `reels/untitled/<date time>`, which
  moves with Save as; two reels no longer write into one `h3_context`. The Orrery Prompt's `latent_path` input
  is gone (#197).
- A scene's divider names the next clip it plays (its hover all of them), and its 📊 shows the scene in numbers: where
  and how often it plays on the walk, how long, what plays before and after it, what it rolls, what it made (#197).
- A scene's divider adds takes of its clip (+) and stays on it, goes to the next scene, or both; the clip rendering now
  shows the sampler's preview and its step under its scene (KJNodes' Model Preview Override, or ComfyUI's own) (#197).
- Sample surfing: a scene's + adds ×1, ×2, ×4 or ×8 takes of its clip, you pick the best under it, and the
  film, `REMEMBER:` and the next clip use that one; 📌 keeps the scene's rolled prompt so only the noise changes, and
  the gear numbers the takes' seeds; a × deletes a take, under the clip or in its box, and a grip sizes the takes,
  in the clip's shape. Clip 1 too: rendering it again stays in its run beside its other takes; another size or
  sound starts a new run (#197).
- The Orrery Prompt takes the model through it: the clip being sampled then plays in orrery's clip box as it
  forms, in real time (the tiny VAE taeh3, else Latent2RGB), light or smooth at the pictures a second the gear's
  Live preview sets, at the size it sets (1024 px on the long side unless set, 0 as sampled). Without it, ComfyUI's own preview reaches the clip box in every open tab (#197).
- The dials are a list in a sidebar beside the editor, one a row with what it rolls at this seed, to widen,
  fold or clear; a dial's menu filters by a regex over text, properties and tags, with All and None; a reel's
  clips show only under its scenes, and the column beside the editor is gone; the node's segment widget is
  orrery's own now, set in the footer with Next clip and Hold, and a template without scenes stays at clip 1
  and never continues an old clip (#183).
- `REMEMBER: frames 0, 50 as @NAME` gives her one picture per frame (it was one batch, of which
  Reference to Video read only the first); the lint names the two lines that fill one picture (#97).
- The galaxy is the gallery now, and Generate is Roll, with how many runs it queues after it:
  **Roll** next 3 clips, next 8 images (#23). Ratings and folders on disk stay as they are.

### Fixed

- An annotation at a line's end wraps with its line like text instead of being cut off at the editor's edge (#416).
  The textarea holds the annotation's characters too, so both layers wrap alike; the template stays as typed, the
  caret steps over an annotation, a copy leaves it out, and the editor has an Undo of its own.
- A screenplay line that names a CAST member past its start (`… portrait of @ELARA wearing __couture_adjective__`)
  shows what its libraries rolled again (#428): the editor found the line only when `@NAME` began it.
- A scene's divider acts on its own scene (#414): a click on a `SCENE` line, its words or its divider, makes that
  scene's clip *Next clip*, and its transport starts there: ▶ rolls this scene, ⏮ ⏭ go to the scene before or after
  this one, 🔒 holds this scene's clip (from another scene's divider the hold moves there). A scene that never plays at
  the seed has no clip, so its ▶ ⏮ ⏭ 🔒 are off.
- A knob turned in the sidebar reaches the run (#418): the node kept only the bindings' dials, so since the knobs came
  (#226) every run loaded its LoRAs, RefMods, pictures and members at the strengths as written. The writers read the
  knobs too.
- A clip whose clip before is not in the film starts afresh (#415), as clip 1 and a test scene do, instead of
  failing in Orrery Continue: no pinned frames, no opening sentence from the `END ON:` before it, no context in its
  length, nothing sent from clips that were never made. The film keeps it at its place and cuts to it; the clips
  after it continue it, and + take makes any clip of a scene. A scene's `AFTER:` reaches its clip though the clips
  between were never made (it asked for all of them, and named the wrong one).
- The anchors are back (#371), under a scene's takes, in a strip like theirs: what its `REMEMBER:` lines hand on to the
  clips after it, the frames of the circled take or, with Orrery Refs' `keep_sent` on, the stored anchor it holds; a
  head says which images and whether `keep_sent` is on, and a grip sizes it. They went with the clips column (bac51f4).
- No seams in Orrery Film's film (#361, #362, under #359): a clip's last frames and the end of its sound are played as
  the next clip's decode has them, as one decode of the whole film would, so the brightness jumps and the clicks where
  clips met are gone, and the sound's level eases across the seam (up to 1.5 dB, as H3 Continuum's seam guard does).
  Measured with the Orrery Seam Meter against H3 Continuum and H3 Motion Context (`experiments/seams/`).
- A clip's takes list in the order they were saved (#348): each take has its number in the run, so a clock set back
  between two saves (WSL resyncs its clock now and then) no longer mixes them up.
- An `END ON:` under IF (#347): `IF $take is 1: END ON: …` is the scene's END ON: when the condition holds, and the clip
  after it opens there; it was ignored ("END ON: only works inside a SCENE"). `START WITH:` too.
- A binding's escaped brace is no leftover (#353): `$k = {a \{b\} c|d}` rolled `a {b} c` with a warning that a choice
  was missing its other half; the braces of a binding's value are text where it is used.
- A grid over a choice with escaped signs (#345): `\|`, `\{ \}` inside an option are part of it, as a roll reads them,
  so `@grid` makes one cell per option instead of failing ("neither one library nor one choice", or a crash).
- A seed that comes in through a link is the seed the app uses (#346): the node's own seed widget stays at what it was
  while the run rolls the linked one, so the editor's annotations, a sheet's "at seed …", the takes and writers over an
  API endpoint, History's and the Gallery's "use this seed", a clip's takes and Roll's batches went by a stale seed. The
  app now reads and sets the seed where it is set: a primitive, or the widget named as the sending output, `seed`,
  `noise_seed` or `value` on the node it comes from (through reroutes).
- Requests to an API endpoint asked at once each adapt to what the model refuses (#333): with a model that wants
  `max_completion_tokens` (gpt-5 and later), the first takes of a sheet, or libraries written together, failed with
  "Unsupported parameter: 'max_tokens'" while the one that learned it went through.
- A takes sheet stays inside the node as its takes come in (#338): it moves up as it grows, and scrolls inside when it
  is taller than the room there is (Generate at the bottom of the Libraries tab ran out of the node).
- Takes find a slot in a CAST member's description (#328): its `(for NAME)` no longer hides it ("has no slot … to write
  for").
- A reel clip's one take shows in its strip (#329); before, a clip's takes showed only once it had two.
- Takes with a text encoder no longer repeat the same take forever (#330): every run of the sheet is sampled at a seed
  of its own.
- A library list the language model keys back a little differently (`80s/80s photographers` for
  `80s/80s_photographers`, another case, `__…__`) lands in its library instead of being lost (#324); one library
  asked for and one list answered, that list.
- The H3 example workflows run their model through the Orrery Prompt, so their `LORA:` lines take effect and the
  results show the live preview (#314).
- A text template's `LORA:` line (a Krea prompt) goes on the model that passes through the Orrery Prompt, as in a
  screenplay, instead of landing in the prompt (#311).
- Ticking a choice in a dial's menu no longer throws its list back to the top (#290).
- Presets has a reload button, and every tab reads what it shows again when it opens (#290).
- The results under the prompt show the picture of a run with Orrery Log; the Krea example runs its model through the
  Orrery Prompt for the live preview (#290).
- Typing at the bottom of the editor no longer scrolls it up when the completion opens (#290).
- The Libraries tab is no longer covered by a dark box (a placeholder bar the takes' question overlay spread over it) (#290).
- Roll runs a grid and a LoRA sweep again: the mini-runs' plan (#171) had taken the place of theirs in the app's
  API client, so Roll queued one run per seed instead of the grid's cells (#288).
- A template without scenes takes the editor's free height with its text, and its results sit at the bottom, instead
  of an empty band under them (#271).
- A library still to be written no longer shows placeholder characters as its roll in the annotations, and an
  entry's escaped characters show as written (#269).
- The example workflows run as they load: their Orrery Prompt saved its values from before `take`, so `take` got
  `''` and the prompt failed validation (#277).
- Rating an output while a run logs its own no longer loses the new one: the gallery's log and the learned weights
  have one writer at a time, and two writes of one file never share a temp file (#260).
- History's and the Gallery's restore no longer promise that the next run reproduces a run: it rolls again with today's
  libraries and learned weights, and says so (#259).
- Taking ratings back gives an entry's weight back: many outputs with one pick, rated and cleared, no longer leave it
  off (twenty hates and their clearing left it a hundredfold), and the same ratings in any order give the same weight
  (#257).
- Typing in a long reel no longer lags: the editor highlights a scene again only when something it shows
  changed, and works out once what every scene reads, instead of every scene on every keystroke (#218).
- Save as, the gear and the app's other sheets open at the top of the app, where their buttons are, not at the
  bottom edge of the node, which a tall node puts out of sight (#220).
- The editor's annotations follow a seed or target changed in the node, not only an edit or a run (#187).
- A new Orrery Prompt starts 1300 px wide, so the footer of a prompt or an H3 scene fits on one line (#181).
- The gear saves again when `max_tokens` in `orrery.yaml` is not a multiple of 500 (the browser refused the
  form); the API endpoint's text no longer looks like a label, and its model list waits for a pick (#179).
- A dial's list of choices opens every time: a menu of its own shows every choice while the dial holds
  one of them, filters what you type, and a library's choices come back after a run (#155).
- The Libraries tab opens at once with a home of a hundred thousand entries (it loaded all of them,
  30 MB, and after every run), keeps its place when a folder unfolds, and shows tags and properties
  on a line under each entry (#152).
- A dial set to a library entry keeps the entry's properties and tags, so what reads them (a
  photo look's lens in One button) still works (#122).
- After a grid or a LoRA sweep the seed steps as its control after generate says, so the next Roll
  starts on a seed of its own instead of repeating the last one (#125).
- The docs name DSL 2.0 as the language's version, apart from the package's, and `docs/h3.md`
  describes the Ref2VA writer as built (#123).
- Frequencies and Rolls load the libraries once per request instead of once per roll (#47).
- A gallery picture's EXPORT list sits in the detail under its prompt again, instead of opening as a blurred overlay
  over the whole app that hid the close button (#278).

## [0.1.0] - 2026-10-02

The first version, v0 (#1).

### Added

- A seeded prompt language that records every pick: wildcard libraries (YAML or Dynamic Prompts
  `.txt`, in folders, globs), inline choices, bindings and fields, tags and properties with one
  predicate language for filters and conditions, number ranges and chances, a template's own
  libraries (`@lib`), `@include` with dials, `@grid`, `@unique`, LoRA tags with strength ranges
  and sweeps; every pick has its own dice, so an edit moves only what it touches.
- The MiniMax H3 compiler: a screenplay of shots, camera moves, voices and sound turned into H3's
  official format for text, image, first-last, last and references, `lite` by default, with
  `keep:` macros and lint for what H3 would ignore.
- Reels: chunks chained clip by clip with Orrery Continue and Orrery Film (or H3 Motion Context),
  `SEND:` frames as references for later clips, `GOTO:` jumps that can hang on what a clip rolled.
- One ComfyUI node with an app in it (Prompt, Test, Galaxy, History, Libraries): an editor with
  syntax colours and completion, test rolls and frequencies, ratings that steer later rolls, and a
  language model that writes missing libraries, slots, `>` rewrites and the next chunk.
- Orrery Refs, Orrery Continue, Orrery Film and Orrery Log; example workflows for every mode; 75
  presets and the `orrery` CLI.
