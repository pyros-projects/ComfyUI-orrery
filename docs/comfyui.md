# The ComfyUI nodes

Everything the Orrery Prompt node puts out, the tabs of its app and its settings, Roll and Restart, Orrery Log and Orrery Refs.

```bash
cd /path/to/ComfyUI/custom_nodes && git clone https://github.com/pyros-projects/orrery.git
# or keep it elsewhere and link its node folder:
ln -s /path/to/orrery/comfyui /path/to/ComfyUI/custom_nodes/orrery   # Windows: mklink /J …\custom_nodes\orrery …\orrery\comfyui
```

Restart ComfyUI. While it loads, orrery prints its banner in the console: a
small orrery in brass, then its boot lines (the nodes it registered, its home,
whether RefMod strengths are on and the RefMod pack is there, and anything that
did not come up, marked with a red `!`); `NO_COLOR` prints
it without colour. **Templates → orrery** (or `example_workflows/` in the
repository) holds a workflow per mode, built from ComfyUI's own nodes plus
orrery's: Krea 2 (`text`), MiniMax H3 t2va, i2va, fl2va, l2va, ref2va, reels
on t2va and on ref2va with Orrery Continue / Orrery Film, a reel with
RefMods (Orrery RefMods, with the Jinx RefMod that ships with orrery) and a reel
that goes on from a video of your own. Their notes name the
models and where they go; sampling follows ComfyUI's own templates (H3:
`res_multistep`, 20 steps; Krea 2 Turbo: 8 steps). Each puts ComfyUI's Model
Attention Backend on `comfy kitchen attention` after the model loader: INT8
attention, much faster on Nvidia and AMD GPUs; elsewhere the node falls back to
PyTorch attention by itself. With the repository linked
as its `comfyui` folder, the template browser does not list them; drag the
files in instead.

Nodes under **orrery**:

- **Orrery Prompt**: seed and target (`text`, `h3-base`, `flat`), optional
  `model`, `first_frame`, `last_frame` and `video` → `text`, `picks`, `seed`, `width`,
  `height`, `length`,
  `megapixels` and `model`. Wire the model through it (loader → Orrery Prompt
  → guider or sampler) and the clip being sampled plays in the preview as it
  forms, in real time (and small as the take being made in its strip of takes), decoded with the tiny VAE for the model's latents
  (`taeh3` in `models/vae_approx` for MiniMax H3, else Latent2RGB). The gear's
  **Live preview** makes it light (a few pictures spread over the clip) or
  smooth (so many pictures a second as you set, as far as the clip gives them:
  taeh3 and Latent2RGB have one a latent frame, about 7 a second), and its
  **Preview size** sets the long edge, 1024 px as KJNodes' (0: as sampled;
  bigger is sharper and takes longer each step); the model
  output is the same model with that preview, nothing loads again. Without it
  the preview shows ComfyUI's own, which orrery passes to every open tab. A picture wired into `first_frame` (else
  `last_frame`), the same one the H3 node gets, gives `width`/`height` its shape
  at the header's megapixels (else H3's canvas area), on the 32 grid as close to
  its shape as the grid allows: H3 stretches a first frame and crops a last one
  into any other shape. A written `: w… h…` still wins, and the lint says when
  the header's ratio is set aside or two frames differ in shape.
  Wire `text` into your text encoder or the MiniMax H3 prompt input;
  `width`/`height` come from `: w… h…` or the `@h3` ratio (`@h3 references 16:9 0.6MP`
  sizes the canvas by area, and `megapixels` puts that out for resolution and
  scale nodes), `length` is the
  screenplay's duration in frames for the H3 latent. The `LORA:` lines go on
  the model that passes through the node (model strengths, as
  LoraLoaderModelOnly puts them: a clip's own LoRAs, the head's, a sweep's run),
  so no LoRA node is needed; without the model wired through, they change
  nothing (the log says so). Unknown or ambiguous names are reported in the log
  and in the Test tab. A workflow saved with the earlier `lora_stack` output
  loses it when it opens, and the outputs after it keep their links. A reel (`SCENE` blocks, `×N` and
  `forever`, `$x[-1]`, `AFTER:`, `(test)`; see [h3.md](h3.md) 1d) writes one clip per run:
  the next clip counts up by itself (the Prompt tab's **Next clip**, and **Hold**
  for takes; the node's `segment` input is orrery's, hidden), and Orrery Continue / Orrery Film (below)
  chain the clips. A video wired into `video` (Load Video) is the scene before
  the reel's first: the node keeps it at 24 fps beside the clips, a head
  `REMEMBER:` keeps its frames, and a scene with `AFTER: the input video`
  continues it ([h3.md](h3.md) 1d, *The input video*). The node is the whole of orrery, in seven tabs and its settings (⤢ opens the
  same app over the canvas, Esc brings it back). Opening a tab reads what it shows
  again, and Presets, Libraries, Gallery and History have a ⟳ that does it any time (#301):
  - **Prompt**: the template editor with syntax colours and completion
    (`__` libraries, `__creature[` tags, `__creature#` properties and their
    values, `$` bindings, the CAST after `@` (`@KEEPER`; at a line's start also
    `@KEEPER (…): ` for speech; every member shows in brass), camera words after
    `SHOT 5s:`, your LoRA files after `LORA:`, your RefMods after `refmod ` in
    a CAST member's parentheses, the scenes after `CUT TO:` and `AFTER:`, what to
    keep after `REMEMBER:`, the dials after `SET:` (`@JINX(1)`, and inside it the
    words `refmods`, `images` …), the mode words after `@h3 `, the gallery's
    characters with their pictures after `image ` in a CAST member's parentheses,
    a binding's fields after `$hero.`). Typing a keyword's start offers the
    keyword and every form of it (`REME` → `REMEMBER: frames 0, 50 as @NAME` …),
    `EXPORT:` and `IF` in text templates too; Ctrl+Space opens the completion where
    the caret is. Each line shows at its end what it gives at the node's seed: a
    binding what it rolled, every library in a line its own roll, in order
    (`→ arcade · bob cut · tracksuit`; one in a `{…|…}` branch that did not
    roll says nothing, #202), an EXPORT what it keeps, a grid its cells, a CAST
    member where its pictures go (gallery pictures as thumbnails), a REMEMBER:
    line where its frames go. *Annotations* in the settings' *Editor* says where
    they go (#203): **Appended** (at the line's end, the default; a long one wraps
    with its line like text, and the caret steps over it, #416), **Hover**
    (nothing at the line ends: what has one is underlined quietly, a dotted line
    as for a footnote, and hovering it shows the roll first) or **None**. A
    screenplay's lines say what they roll for the scene of the next clip. Hovering a keyword shows what it does and its
    forms; a CAST member who it is in this clip (description, pictures and their
    strengths, RefMods, voice); a library its size and entries; a binding what it
    rolled. **New** starts a fresh
    template linked to no preset: an H3 scene, an H3 reel,
    H3 references, H3 keyframes (image, first-last, last) or a Krea prompt,
    each with a quickstart of the essentials as `#` comments on top (the gear
    turns the quickstart off). Open a preset from the bar above it; ● marks unsaved
    edits; Save, Save as…, Revert. Beside the editor, in a sidebar, every
    binding is a **dial**, one a row, with what it rolls at the node's seed:
    pick a library entry or choice, tick several to roll among them
    (`{noir|gothic}`), or type any expression; empty means its default roll,
    and **Clear** sets them all back. A dial's menu has a filter, a regex over
    the choices, their properties (`genre: noir`) and tags, and **All** (roll
    among every choice it shows) and **None**. Drag the sidebar's edge to widen it, or
    fold it to a strip. Saving bakes the dials in, and a gallery output
    restores them. Under the dials, the template's **knobs** (#226): its
    LoRAs, RefMods, pictures and members, grouped where they hold, *All
    clips* first and then each scene with knobs of its own (the scene of the
    next clip open; a scene's knob says when it overrides the head's), each
    with its strength, start and end in number fields whose little buttons
    step 0.05 (the start and the end a share of sampling, 0 and 1 unless
    written), and a sweep's values as chips to take out or back in. A knob turned there is the node's, as a
    dial is: the template stays as written, and saving bakes it in. **Test** jumps to the Test tab and rolls. **Write** has
    the language model write the reel's next scene, the shot between two
    frames or a prompt from a picture, in the 🎲 takes sheet every ask uses
    (#333): N takes at each **Generate takes**, steered, with what is sent along, one put in or several as
    a choice ([llm.md](llm.md)). With an
    API endpoint as the language model (the gear), it asks the endpoint
    directly, beside ComfyUI's queue, and **Write now** in the footer writes
    the libraries the template still needs, all at once.
    In a reel, every `SCENE` line carries a divider that names one clip of
    the film (counted from 1): the next clip where the scene plays it
    (`▶ next: clip 3 · 5 s`), else the clip it comes next as (`comes next as
    clip 41 · 10 s`). Its hover says every clip it plays, when and how much
    film is left (`clips 2–5 · 4 × 5 s · 0:05 → 0:25 · 1:35 left`), and its
    📊 explains them: where and how often the scene plays on the walk at the
    node's seed, drawn clip by clip, how long, what plays before and after it
    (and its lines that steer), what it rolls, and the clips it made.
    Beside 📊 every divider carries the **transport** (#341), the footer's
    controls where you are, however tall the node, acting on its own scene
    (#414): a click on a `SCENE` line, its words or its divider, makes that
    scene's clip *Next clip* (the one it plays next, else its first), and every
    button in the divider does so before it acts. **▶** rolls this scene,
    **⏮ ⏭** move *Next clip* to the first clip of the scene before or after this
    one, **+1 / +2 / +4** sets the clips a Roll plays (a click cycles them) and
    **🔒** holds this scene's clip (in another scene's divider it moves the hold
    there). A scene that never plays at the node's seed has no clip: its ▶ ⏮ ⏭ 🔒
    are off. **⧉** duplicates the scene,
    the copy right after it, and **🗑** deletes it (#344): unsaved edits, with Undo.
    **Jump** beside *Next clip* puts the caret on the scene of the next clip.
    Under the prompt and the dials, the whole width, sits the **preview** (#305); the grip
    above it sizes it, and the node keeps its height. While a run samples it shows the
    live preview, then what is shown: the clip or the take clicked under a reel's scene,
    playing with its controls, or a template's result. A click only shows: the take that
    counts, the **circled** one (the film's, in a reel), has the golden border, and the
    preview's **Circle this take** chooses another (#319; only circling gives the node a
    take's seed). In a reel, the buttons around **Clip N** step through what was made
    (#430). ⏮ ⏭ go to the scene before or after, to its first clip's circled take, and
    pass scenes with no clip yet. ‹ › go to the take before or after in the scene, over
    its clips in order. They show the take as a click does. With the preview focused
    (click into it), ← → step scenes and Shift+← → step takes. For a reel's clip in the
    film, **Pick frames** steps through it
    frame by frame (← →, M marks a frame) and **Write REMEMBER:** puts the frames marked
    into its scene as `REMEMBER: frames 12, 40 as …` (#223).
    A template without scenes (a Krea prompt, an `@h3` scene) has its
    **results** in the preview (#211, #305): the live preview
    while it samples (the model wired through the Orrery Prompt; an image
    model's tiny VAE or Latent2RGB, sized by its own latent format; with the model
    input unconnected the empty result says how to wire it), then what
    the run made, a picture, a clip or its sound, as its Save, Preview or Orrery Log
    nodes wrote it (#302). Every run becomes a **take**, lined up under the result like a
    photo viewer: a click shows it, a fresh run's take is circled. Beside the
    takes stands the strip's head, the same for a reel's clips (#319): **+ take** adds
    takes, **×N** says how many it makes and **📌** keeps the rolled prompt so only
    the sampler's noise changes; with two videos or more, **▶ all** plays them at
    once. The gear's *Sample surfing* numbers their seeds or follows
    the node's control. The takes are kept on the node, per preset, and saved
    with the workflow; × takes one off the list (**the others** and **all**
    take more), its files stay where they are. They make a **shoot** (#320), like a
    sitting in a photo studio: **finish shoot** folds its takes into the **earlier
    shoots** under the strip, each shown by its circled take, and the next Roll
    starts a new one; a click on an earlier shoot opens it again, and the next Roll
    adds to it. The node keeps the last twelve shoots of a preset. A grid's or a
    sweep's runs at one seed are one take: a creator's four views come in together,
    as a mosaic in the strip and side by side in the preview. A reel opens in the **clips view**: the editor cut into one cell
    per SCENE, each followed by that scene's clips as Orrery Film (or H3
    Motion Context's Chain Video) keeps them: each clip, made or the next to
    make, as its strip of **takes** with the results' head (#319, #331); the
    clip itself, big, is in the preview below. **+ take** renders a take of
    that clip (it forms at the end of the strip, small, and big in the preview:
    see Orrery Prompt's `model` below); a clip whose turn has not come yet waits for the one
    before it. **Sample surfing**: ×1 beside + turns to ×2, ×4, ×8, and + renders
    that many takes. They line up under the clip; hover plays one, a click shows it
    in the preview, whose **Circle this take** puts it in the film (the next clip and
    `REMEMBER:` then use it too), and the clips last made
    after it come back with it: no path is lost (#213). 📌 in a clip's strip keeps its scene's
    rolled prompt, so the takes change only the sampler's noise (the Orrery
    Prompt's `seed` output carries seed + take into the noise, as in the
    example workflows); without it each take rolls anew, and the one you pick
    gives the node its seed, so the clips after it roll the same world. The
    gear's **Sample surfing** numbers the takes' seeds (seed+1, seed+2 …: the
    same takes tomorrow) or follows the node's control after generate. The grip
    at the end of a clip's takes sizes them all, in the clip's shape. A × on
    a take deletes it from disk (it asks first): the
    film then plays the clip's newest other take, or ends before the clip.
    The strip's head stays with the takes as you scroll
    (#245): on top **+ take**, ×N, 📌 and **▶ all**, which plays every take of the clip at once, from the
    start and in step, to compare their motion (**■ stop** stops them, #238);
    in the middle the clip and its scene in numbers (its takes, the circled
    one, its seed, the newest, how many were made with another prompt); at the
    bottom **the others** deletes every take but the circled one, and
    **all** every one, the film then ending before the clip; each asks first,
    and takes made on another path stay (#234). **Tree**
    beside *Jump* opens the **take tree** (#213): every take of the reel's run,
    a column per clip, a line from each take to the takes made on it, and the
    film's path lit in brass; the rows stay where they are, only the light moves. Hover plays a take and shows the
    way the film would go through it; a click makes the film that way (to the
    take from clip 1, then on as it was last walked), and ✂ on a take of the
    film ends the film after it, so a film is clicked together along the tree.
    The prompt is the script and the takes are the footage: switching takes
    never changes the editor, and what renders next is shot with the editor's
    text on the film's path. A take made with another version of its scene
    carries ✎, in the tree and under its clip: hovering it shows what changed,
    and a click on ✎ (**Use this prompt**) puts that version of the scene in
    the editor, with Undo; the editor shows that scene, lit for a moment.
    **▶ Film** in the tree's head plays the film as it is clicked together
    (#243), in a section of its own above the tree that the split under it
    sizes: under the video a timeline of its clips with a playhead (a click
    plays the film from there), and the take playing glows in the tree.
    **hide < N after** in its head hides the dead ends (#246): the takes fewer
    than N takes were made on. The film's takes, the last clip's (nothing can
    come after them yet) and every take a shown take came after stay, so every
    path shown is whole; the head counts the hidden ones, 0 shows all. While a clip renders, the take
    being made at the end of its strip, and the preview, show the sampler's preview and the step it is at: KJNodes' Model Preview
    Override (a picture, or the whole clip as it forms), else ComfyUI's own
    preview when its live preview is on. Under a scene's clips come the frames its
    `REMEMBER:` lines take, cut from that clip in the browser as you type
    (`frame 50` → `frame 20` shows frame 20 at once, a range as a strip with
    its count, frames past the end in red), and each says where they go;
    the head's come from the input video. Each `REMEMBER:` line also says it
    at its end, in the editor (`→ image 1 · @WOMAN · clips 2+`, and `replaced
    from clip 2 by "frame 50 as @WOMAN"` when a later line fills the same
    picture), from the same resolution the compile uses. A click on a single
    frame opens its clip with a slider: **Use frame N** writes that frame into
    the line. Arrow keys cross from cell to cell, Backspace at a cell's start
    and Delete at its end join two, and a SCENE line typed or removed cuts
    the text anew. It reads the reel's folder (below) and refreshes after
    every run. The gear turns dividers and the clips off.
  - **Test**: what the template makes, without queueing anything. **Rolls**
    shows three seeds (a reel: six clips at one seed, pageable through a
    forever loop). **Frequencies** rolls it 50, 200 or 500 times, across seeds
    or across a reel's clips, and shows how often every value comes up, plus
    how often each lint warning fires.
  - **Presets**: every preset with your newest output as its preview. On the
    left (#307) **All presets**, **All image presets**, **All video presets**,
    the favorites and the recent ones, then the collections (the folders,
    `mine` the presets at the top), each with its `image` and `video`. Above
    the cards the filters (#308): a name (title, tag or note), a kind (still,
    scene, reel), how recently it changed, and a regex over the template text.
    A card opens a sample roll and the template.
  - **Libraries**: edit wildcard lists by hand: entries, their tags and
    properties (on a line under each entry), weights, and the weight each
    entry learned from your ratings. Libraries that share a name prefix sit in
    a folder (`couture_form`, `couture_house` → couture); what the language
    model wrote waits on top for review. Built-ins become yours with **Make it
    mine**. Under a library of yours, **Add** takes entries you type, and the yellow
    **Generate** opens the 🎲 sheet (#323), whose **Generate takes** asks the language model for new ones: none
    the library has, steered as you like, added when you pick them. A library's entries load when you open it, so a home of a hundred
    thousand entries opens at once; the search finds libraries by name and by
    entry. Drag the list's edge to widen it; a long property opens when you
    click it.
  - **Gallery**: every logged output. love / like / nope / hate multiply the
    learned weight of each pick by 1.5 / 1.2 / 0.8 / 0.5 (re-rating replaces
    the factor). **Use template + seed** restores an output's template and seed
    and sets the seed to fixed; the next run rolls them with today's libraries
    and learned weights (#259). An output whose template EXPORTed data shows it as a sheet
    under its prompt (**JSON** copies it). A slot there still to be written from the picture
    (`image output`, #175) has a 🎲: **Generate takes** writes takes from the picture, **Use selected** keeps one.
    On the left (#290): **All outputs**, **All images**, **All videos**, then the
    days, newest first, each with its `images` and `videos`, then the
    collections. What belongs together is one card, an album with up to eight
    of its pictures: a shoot's takes, its circled take first, and inside it each
    grid's or sweep's runs (#321); a sweep's or a grid's runs outside a shoot; a
    reel's clips, and inside a reel each scene's takes, named by its `SCENE` line;
    a click opens it, the bar above leads back. A filter (This prompt, a rating, a pick) shows the
    outputs themselves. Collections hold outputs without moving them, one
    output in as many as you like (folders from before are collections now):
    drag cards or albums onto one (a selected card brings the whole
    selection), drag a collection onto another to nest it (onto the
    *Collections* heading: to the top), double-click to rename; **Out of the
    collection** takes a selection out again. Removing a collection deletes
    nothing: its outputs stay in the gallery, the collections in it move up a
    level. The filters (#308) find outputs by their preset's name or title, a
    kind (images, videos, a reel's clips, a sweep's runs), how recently they were
    made and a regex over the prompt. Select with the checkbox,
    Shift-click for a range, Ctrl/Cmd-click for one more; then **Export
    pairs** copies each picture or video into `~/.orrery/export/<name>/`
    with a `.txt` of the prompt that made it (training pairs), and
    **Delete** takes outputs out of the gallery and moves their files to
    `~/.orrery/trash/`. Learned weights stay. The big picture of an open
    output drags onto the canvas like the file itself: a new Load Image node,
    a Load Image node's new picture, or the workflow the picture carries.
  - **History**: every run of the node as it resolved, newest first: the
    seed, the segment, the dials, every pick and the prompt, kept even when
    the output was not (the last 2000 runs, in `prompt_history.jsonl` in the
    orrery home). A run a `>` line rewrote says so, and opened shows the instruction, the
    passage before the rewrite and whether it was kept with **Use selected** or written for
    the run (#279). Search by prompt, pick, preset or seed; **Use template +
    seed** puts the run back in the Prompt tab (segment included, control
    after generate fixed), so a lucky roll can be rolled again: with today's
    libraries, learned weights and included presets, so a library edited or an
    output rated since rolls something else, and the prompt it made is a copy
    away (#259) (a run from before
    2026-10-02 comes back with `@rng 1` on top: the dice it was made with). Each run is
    also printed to ComfyUI's console (seed, picks, prompt); the gear turns
    that off.
  - **Help**: in pages (#309), a nav on the left as the Settings have: a start
    with the tutorial lessons, the language section by section (each line with
    an Insert), writing for the models, the keys in the editor and the
    settings.
  - **Settings** (the gear, #212; again, and the tab before is back): its
    sections on the left, *Home*, *Language model*, *Writers*, *Editor*,
    *Clips* (live preview, sample surfing), *Log* and *Reset*, the one
    chosen on the right, and the tab opens on the one shown last. *Reset* (#310)
    takes back the ratings (and the learned weights), deletes the history or the
    gallery, puts the presets or the libraries back to factory, or everything at
    once; each asks first. What you made by hand (presets, libraries, exports)
    goes to the home's `trash`, and the gallery's pictures and videos only when
    its box is ticked (they stay in ComfyUI's output otherwise). A setting
    is saved the moment it changes and says so beside the section's title.
    What moves things or asks the outside has a button of its own: **Use
    this folder** for the home folder, **Use this endpoint** for an API
    endpoint (checked first: the key, and one short answer from the model;
    a setting changed on its own, such as the entries a library starts with,
    asks the endpoint nothing), **Save text** and **Reset to default** for a
    writer's text.

  Workflows that used the old `preset` dropdown open with that preset loaded
  into the editor.
- **Orrery Log**: `picks` (+ `images`) → saves PNGs with the picks embedded and
  appends one line per output to `~/.orrery/galaxy.jsonl`. For videos saved by
  another node, put the file path into `media_path`.
- **Orrery Refs**: `picks` + `image_1` … `image_9` → `ref_1` … `ref_9` and `preview` (it also loads the gallery pictures a CAST names, `image NAME`), between
  your reference images and MiniMax H3 Reference to Video. Every clip gets only
  the images its screenplay uses, packed from `ref_1` and numbered as the prompt
  numbers them, plus the frames of earlier clips a reel `REMEMBER:`s (a picture
  wired into that image stands in until they exist); `preview` shows
  them all in one Preview Image, each labelled with its ref. Remembered frames are kept
  as anchors in the orrery home; `keep_sent` on holds them from clip 1 for the
  next run, so a character stays. The tutorial:
  [orrery-refs.md](orrery-refs.md).
- **Orrery Continue** and **Orrery Film**: orrery chains a reel's clips itself,
  on the Masked AV continuation of
  [H3 Continuum](https://github.com/ukr8b3g-cmyk/ComfyUI-H3-Continuum) (MIT).
  In every clip that continues one, Orrery Continue starts the clip's latent with the
  last 22 frames of that clip (the one before, or the one `AFTER:` names), picture and sound, and a `noise_mask`
  keeps the sampler off them; no model or layout patch is involved. After the
  input video it takes the video's last 22 frames and sound instead, fitted to
  the clip's canvas and encoded with the H3 video VAE in its `vae` and the audio
  VAE in its `audio_vae` (only that clip needs them). Wire:

  ```
  Orrery Prompt picks ───────────────▶ Orrery Continue picks
  H3 node (Reference to Video …) latent ▶ Orrery Continue latent ──▶ sampler latent_image
                         conditioning ▶ Orrery Continue conditioning ▶ sampler positive (optional)
  sampled latent ─────────────────────▶ Orrery Film samples
  decoded images / audio ─────────────▶ Orrery Film images / audio
  Orrery Film film (VIDEO) ───────────▶ Save Video, Orrery Log
  ```

  The H3 node's `length` comes from the Orrery Prompt (it counts the 22 frames).
  Orrery Continue drops a first-frame image from the conditioning in those
  clips (they start with the one before); the first clip and a `(test)` scene start afresh, and so does a clip
  whose clip before is not in the film (#415): roll scene 5 before scenes 2 to 4 are made, and it opens as
  clip 1 does, the film cutting from what it holds to it; the clips after it continue it. Orrery Film refuses a
  clip whose pinned frames the sampler changed (a sampler that ignores
  `noise_mask`). Orrery Film trims the 22 frames, puts out the clip
  (`images`, `audio`) and `film`, the reel so far, and keeps the takes under
  `output/<the reel's folder>/orrery_film/`: each clip, its sound and the tail the
  next one continues from. The film has no seams to see or hear where a clip
  continues the one before: H3's VAE decodes a clip's last 5 frames and the end of
  its sound as if nothing followed, so the film plays them as the next clip's decode
  has them (the 22 frames it starts with), as one decode of the whole film would,
  and the sound's level eases across, up to 1.5 dB as H3 Continuum's seam guard does. Rendering a clip again adds a take, and the film ends
  with it; the clips that continued the take before stay in the take tree and
  come back when that take is picked again, clip 1 too: its
  takes stay side by side (another size or sound starts a new run); older takes stay on disk. A `(test)` scene's take is kept but left out of
  the joined film. The previous clip, `REMEMBER:` and the timeline read
  this store or H3 Motion Context's Chain Video, whichever was written last.
  Another `context:` than 22 is a warning: 22 frames are pinned all the same.

  **The reel's folder.** orrery names it, under `output/reels/`, so reels keep
  their clips apart (the Prompt tab's Reel shows it on hover):

  | The reel | Its folder |
  |---|---|
  | a saved preset | named after it: `reels/h3/08_reel_night_watch` |
  | unsaved | `reels/untitled/2026-10-03 23-15`, named when it is first needed and kept in the node until **New** |
  | unsaved, then saved | the folder moves to the preset's name with **Save as**, so the next clip continues the last |
  | the same preset in two nodes | the same folder, as it is the same reel; **Save as** makes a second one |

  A template run outside the app (the CLI, an old workflow) keeps `output/h3_context`.
- **Orrery RefMods**: `conditioning` + `picks` → `conditioning`. It puts the
  clip's RefMods on the conditioning, the ones its CAST names
  (`refmod NAME` with `SET: @JINX(0.5, 35%)`, see [h3.md](h3.md#1e-refmods-refmod-name-set-jinx05-35)),
  each with its strength and its start. It loads them from `models/refmods`
  with the [ComfyUI-H3RefMods](https://github.com/FranckyB/ComfyUI-H3RefMods)
  pack, which needs to be installed; the pack's Load and Apply nodes are not
  needed. One RefMod ships with orrery, in `examples/refmods` (Jinx, Apache 2.0):
  the node finds it there without copying, and the completion offers it. Wire:

  ```
  Reference to Video conditioning ▶ Orrery RefMods conditioning ▶ Orrery Continue conditioning (or the guider)
  Orrery Prompt picks ────────────▶ Orrery RefMods picks
  H3 video VAE ───────────────────▶ Orrery RefMods vae (for RefMods made from the reel)
  ```

  A RefMod that a `REMEMBER:` line makes from the reel's own frames (`REMEMBER: every
  10th frame as refmod NAME`) needs no pack: the node takes those frames of the
  remembering clip from the chain and encodes them with the `vae` as
  Reference to Video encodes a video reference, on its 768 canvas and on the
  VAE's frame grid (the last frame held to fill it up, at most 73 frames spread
  out evenly). It encodes them once and keeps the result for the run; a new take
  of that clip encodes them again.

  It also applies a picture's dials (`image 1 at 0.5 from 35%`) to the pictures
  Reference to Video put on the conditioning: with Orrery Refs, the k-th picture
  is the k-th packed ref. A RefMod or a picture that starts later goes into a
  timestep range of its own, as ConditioningSetTimestepRange would put it. The strength comes from orrery's
  wrap of H3's attention, which orrery installs in memory when its nodes load.
  A picture's strength covers its reference latents and the vision tokens its
  text encoder left in the text. Outside its `from` and `to`, the picture stays
  on the conditioning at 0, so both stay hidden.

  With **H3SLAAttention** (sparse attention), every step where a strength other
  than 1 is in play runs dense: orrery's wrap widens the attention heads, and SLA
  takes only H3's own. The clip then renders at dense speed for those steps. A
  picture or RefMod at 1 runs sparse and can lose part of its reference to the
  sparsity, unless SLA's Protect Vid/Ref holds it (Light or Heavy). At 0.99 it
  runs dense and keeps all of it, so under SLA 0.99 can hold more than 1.
- **Orrery Write** (`orrery/internal`): the Write menu queues it on its own;
  you don't add it.
- **Orrery Ask** (`orrery/internal`): with a text encoder, one task of the
  language model in a run of its own (#171): Roll queues one per library,
  rewrite and slot before each run, Write now and the takes at the line theirs
  at the front of the queue; you don't add it.
