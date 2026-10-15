# The language model in orrery

Everything orrery's language model does, how to switch it on, how to try each part, and what is
planned. The model is there for creative work: lists, slots, rewrites, the next scene. Copying what
a template rolled needs no model, so orrery never asks one for that.

## Choosing the model

The gear in the node opens the Settings tab; its section **Language model**:

| Choice | What it is | Where it runs |
|---|---|---|
| **A text encoder in ComfyUI** | A text encoder that is a whole language model: Krea 2's `qwen3vl_4b`, or a Qwen3-VL 8B build. MiniMax H3's encoder is cut short and cannot write. | In ComfyUI's queue, on the GPU. It loads when the node runs and answers **once per run**. ComfyUI moves it out when the video model needs the room. |
| **An API endpoint** (#165) | OpenAI, or a server that speaks its protocol (llama.cpp, LM Studio, OpenRouter): the endpoint, a key, a model. **Check** lists the models and asks for one answer. **Use this endpoint** checks it first and uses it. The key goes into the home folder's `.env`, never into `orrery.yaml`. | Beside ComfyUI: no VRAM, no queue. It can be asked more than once per run, and in parallel. |

`orrery.yaml` (`llm:`) also holds:
- `entries`: how many entries a new library starts with, 12 by default;
- `takes`: how many takes a 🎲 asks for, each 1 to 12, 3 by default (#274): `slot` (a gallery picture's slot too),
  `enhance`, `rolled` (entries rolled from a library), `new` (entries the model writes for it) and one for each writer
  of the Write menu, `continue`, `story` and `describe` (a story writes a lot; the one `write` count before #333 is
  their default). The gear shows them as *Takes a 🎲 asks for*;
- `max_tokens`: the longest answer, 16000 by default;
- `temperature`: 0.3, for lists, slots and rewrites;
- `writer_temperature`: 0.8, for the Write menu.
- `takes`: how many takes a 🎲 asks for, per kind (a slot, a `>` rewrite, rolled from a library, new for a library,
  each writer of the Write menu), 1 to 12 each, 3 unless set.

The CLI's `orrery lib` uses `models.library`, else the API endpoint ([configuration.md](configuration.md)).

The footer of the Prompt tab names the active model: `LLM qwen3vl_8b…`, or `LLM gpt-6-luna · API`.

## What it writes

| Feature | In a template | What happens |
|---|---|---|
| **A new library** | `__runway_shoes__` | A library you don't have is written when the node runs, from the lines around it. The editor marks it as "made when the node runs". |
| **A top-up** | `__runway_shoes:30__` | A library with fewer entries is topped up to at least 30, once. |
| **Directions for a list** | the library's takes sheet: **Keep the direction** | The list gets only its directions, never the prompt, and they stay with the library for later top-ups. The earlier `__film_scene__(at least 30 words, set and characters)` still works, deprecated (#275): the sheet shapes a library instead. |
| **Review** | Libraries tab, **To review** (violet) | What the model wrote waits: **Accept** keeps it, **Discard** drops it. `orrery lib undo` undoes a write. |
| **A slot** | `--one small object in their hands, 4 to 8 words--` | Prose written where it stands, after everything else has rolled. The model sees the whole prompt. In a screenplay, CAST names in the directions arrive as `<Subject N>` labels. |
| **A slot in a reel** | `--what WASHER does next, moving the story on--` | From the second clip on, the model also watches the clip before (one frame a second and its last frame) and continues it. |
| **A CAST description from a named picture** | `@MIRA (image krea/09_character_creator/…): --who she is, one sentence--` | The model is told the prompt that made the picture, so it needs no vision for this. |
| **A slot in an export** | `EXPORT:` block, `backstory = --two sentences of backstory for $who--` | It is written with the run and kept with the picture, never in the prompt. A screenplay that casts the picture reads it as `$hero.backstory`. |
| **Pictures in a slot** (#174) | `--the outfit in image first_frame, one phrase--` | The model gets the pictures a slot names, after the frames of the clip before, and reads them as Picture 1, 2 …: `image first_frame` and `image last_frame` (wired into the Orrery Prompt), `image 3` (a gallery picture the CAST names), a gallery name. One that is not there is said; the slot is written without it. The takes at the line see them too; without the picture they ask nothing and say what is missing. |
| **A slot from the picture the run makes** (#174) | `EXPORT:` `sheet = --a full character sheet from $who, as image output shows them--` | `image output` exists only after the run, so the run leaves the slot as it is, kept with the picture; outside `EXPORT:` the lint says so. |
| **Written from the Gallery** (API, #175) | a picture whose exports keep such a slot | The picture's sheet in the Gallery shows the slot with a 🎲: **Generate takes** writes three takes from the picture, with the prompt that made it beside it, and more and a steer work as at the line; select one and **Use selected** writes it into the picture's exports, where a screenplay that casts it reads it. The gear's **Picture slots: After every run** writes each such slot right after its run instead, one take each. |
| **`> enhance`** | `> make it moody and cinematic` | It rewrites the rolled prompt as asked. In a screenplay, a `>` before the first SHOT covers every shot's prose, and one inside a SHOT only that shot; dialogue is never touched. |
| **Write menu: Continue the reel** | any screenplay | The next SCENE, after the scene you pick in its sheet (**After**: the end, or any scene), **in** N scenes **of** S seconds (set them, then **Generate takes** writes), from every clip up to it as it rolls at the node's seed, with an `END ON:`. A reel that plays on and on is read until that scene first ends (#342). **Replace** puts it in place of the scenes after that one, **Insert** before them; a screenplay without SCENE lines becomes a reel first, its shots the first scene (#334). |
| **The writers' sheet** (#333) | Continue, Story, Prompt from image | Select as many takes as you like (× takes one out of the list). **Prepend to prompt** and **Append to prompt** copy them in, at the start (a screenplay's: under its head) or at the end, with every writer in every mode; **Replace** and **Insert** put them where the writer has a place, the line above the buttons says where. **as written** puts them in one after the other, in the order you selected them; **as a choice** makes them one choice, so every Roll picks one: `{a|b}` for one-line takes, a `$take = {1|2}` binding and `IF $take is 1: …` lines for shots and keyframes, and for scenes their SCENE lines with what is in them chosen the same way (the binding in the head, so every scene picks the same take, its `END ON:` too). |
| **Write menu: Story interpolator** | any template | What happens between a start and an end (#343), both picked in its sheet: **From** first_frame, the prompt (all of it: the story goes on from it) or any scene (where it ends), **to** last_frame, the prompt (its first shot: the story leads into it) or any scene (its first shot), **in** N scenes **of** S seconds; set them, then **Generate takes** writes. The scenes travel from the start's place to the end's, who is in the start the whole way; a frame is shown where it is named. One scene from frame to frame on a screenplay without scenes is the fl2va shot; otherwise scenes (a screenplay without scenes becomes a reel), put in between with **Replace** or **Insert**: from a photo of your cat to the prompt, the walk from your living room into the screenplay's forest. On an image prompt it writes N keyframe prompts from first_frame to the picture the prompt makes (or from the prompt to last_frame), and **Replace** puts them on a grid (`$keyframe = {…}`, `@grid $keyframe`), so one Roll renders every keyframe in order. A frame that did not come along is imagined (#334). |
| **Write menu: Prompt from image** | a picture in `first_frame`, or none | A Krea image prompt, or an i2va shot when the template is `@h3`. Without a picture it writes from the prompt as it rolls (#334). Sent along with **the prompt** on a screenplay, it writes the next shot of that screenplay with who or what the picture shows in it, in the screenplay's place, the picture's room left behind (its own writer text; an 8B kept the room otherwise, `experiments/writer-framing`). **Replace** puts the takes in place of the prompt (an image prompt's comments and `: …` lines kept) or of the shots below the header, **Insert** above those shots, or on a reel under the line your cursor was on. |
| **The writers' prompts** | the gear, **Writers** | What each writer is sent, editable, with **Reset to default**. |
| **Takes at the line** (API, #173) | a 🎲 at the end of a slot's line, of a library still to be written, of a `> enhance` line | The slots are violet in the editor; hovering a 🎲 outlines the place it stands for, so two slots on one line tell their dice apart, and Ctrl+click on a slot opens its takes too (#280). The sheet opens without asking anything (#436): **Generate takes** asks for three takes for that place (or as many as the gear's *Takes a 🎲 asks for* says, #274), written at the node's seed with the prompt as it rolls around it, and at each press for as many more (new against those there), the steering line goes with them ("darker", "as an anime character"); × takes one out of the list (#333). A click selects a take (a violet border), a click on another moves the selection, and **Use selected** puts it in place of the slot or the library (#276); **Keep the direction** writes your steer into its directions (`--…, darker--`, `__name__(darker)`, `> …, darker`); both are unsaved edits with Undo. A `> enhance` line's takes show what the rewrite does at this seed; **Use selected** keeps the one you pick for exactly this roll (the instruction and the prompt as it rolled), and a run that rolls it uses it instead of asking the model; another roll is rewritten as before. A `>` over several passages of a screenplay keeps none, since the run rewrites each apart. With a text encoder the takes come with #171. |
| **A library at the line** (API, #272) | the 🎲 of a library still to be written (`__bus_smells__`) | On **Generate takes** the sheet writes the library itself: as many entries as a new library starts with (the gear, *A library it creates starts with*; `__name:30__` asks for at least 30), from the lines that use it, as a run would write it. Steer them, **Generate takes** again for as many more; click the entries worth keeping (**All**, **None**), and **Keep as the library** writes them as the library, straight in, not To review (`orrery lib undo` takes it back). **Keep the direction** keeps your steer as the library's directions, for later top-ups. One entry selected, **Use selected** puts it into the line instead. |
| **A library that exists, at the line** (API, #273) | a library's roll at the line's end (`→ arcade · bob cut`), or Ctrl+click on its name | Its takes, on **Generate takes**: entries rolled from it (the one at this seed first, then as its weights and your ratings roll them) and new ones the language model writes, none it has, as many of each as the gear says. Select several; **Add to the library** writes the new ones you picked straight in (the sheet stays: Generate takes, then add more), **Use selected** puts one entry into the line. **Keep the direction** saves your steer as the library's directions. With the annotations on Hover or None, Ctrl+click on a library's name opens it (on one still to be written, its sheet from #272). |
| **Generate in the Libraries tab** (#323) | **Generate** beside **Add** under a library of yours | The same sheet with new entries only: as many as the gear's *new for a library* says, none the library has or the sheet shows. Steer them, **Generate takes**, **Keep the direction**, select the good ones and **Add to the library**; the tab shows them at once. Greyed without a language model. |
| **Send along** (#335) | the row under a takes sheet's text | What goes to the model beside the request, as toggles: **the prompt** as it rolls (always, where the take is written into it: a slot, a `>` rewrite, the reel's next scene), the pictures wired into **first_frame** and **last_frame**, four stills of the **video** wired into the Orrery Prompt, and **Gallery**: any picture or video of the gallery (a video as four stills). Each picture is told to the model as what it is ("Picture 2 (the last frame)"). A toggle with nothing wired behind it is greyed and says so. They count for the next takes (Generate takes). A picture computed in the graph (a decode, a resize) goes in a run of its own. |
| **Insert as a choice** (#336) | several one-line takes of a slot or a library selected | They go in as `{a|b|c}` in place of the slot or the library, so every Roll picks one and you see which works best. Characters the language reads as its own are written as themselves. The writers' sheet has **as a choice** for this, for takes of several lines too. |
| **Write now** (#168, #176) | a template with libraries still to write | A button in the footer writes them before any run, one request each: with an API endpoint all at once beside ComfyUI, with a text encoder each in a run of its own at the front of the queue. They wait in To review. |
| **`orrery lib`** (CLI) | `gen`, `more`, `edit`, `undo` | Libraries in plain language: `orrery lib edit animal 'make a feline list from the cats'`. Nothing is kept until you confirm it. |

Every ask is the same 🎲 **takes sheet** (#333): a slot's, a library's, a `>` rewrite's and the Write
menu's. It opens without asking anything (#436): each press of **Generate takes** asks for as many takes as
the gear's *Takes a 🎲 asks for* says (the Write menu has its own count), steered by the line under them.
A click beside the sheet leaves it open, with its takes and the ones being written; its × closes it (#438).
**Send along** says what goes with
the request, and **Use selected** puts one in as an unsaved edit, with Undo (**Insert as a choice**
several). Nothing in the Write menu waits for an input: a writer whose pictures are not there is told
what came along and writes from the rest. With an API endpoint the server asks the model directly, so
takes come while a render runs; a picture that something other than a Load Image or a Load Video
computes still takes a run of its own.

### What changes with a text encoder: one task per run (#171)

A text encoder in ComfyUI answers once per run, and a small model does better with one task at a time. So
orrery queues **mini-runs** (the node Orrery Ask, with only the text encoder and the frames): each answers one
task, and none loads the video model.

- **Roll** asks, before each run it queues, what that run needs from the model, and queues a mini-run for each
  ahead of it: each library still to be written, then the run's rewrites, then each slot (so a slot sees the
  prose rewritten). In a reel, the next clip's mini-runs come after the clip before, so its slots see that clip.
  Each answer is kept for that exact roll (the home's `asked.json`), and the run takes it instead of asking.
  ComfyUI's own Run queues no mini-runs: the run asks for everything at once, as before.
- **Write now** (#176) queues a run of its own per library, at the front of the queue.
- **The takes at the line** (#178) come from runs of their own at the front of the queue: one take per run for
  a slot or a `>` line, each sampled anew; a library's sheet in one run.

### What changes with an API endpoint

- A run writes each missing library in a request of its own, all at once. Then the slots and
  rewrites follow in one more request, and they see the compiled prompt. `> enhance` runs in the same run.
- Frames go to the model as pictures.
- Newer OpenAI models want other parameters. orrery asks again the way the model accepts and
  remembers that. A busy endpoint is asked twice more.
- A refused key says so, and points at the gear.

## Test it

The tutorials are the quickest way in: **17 · The language model writes your lists** and
**18 · Slots and > enhance**. The Character creator (`krea/09_character_creator`) takes a
`backstory = --…--` in its EXPORT block.

With a **text encoder** (the gear → A text encoder in ComfyUI):

- [ ] Tutorial 17: Run writes `__runway_shoes__` and `__unusual_runway_venue__`. They appear under To review; accept one, discard one.
- [ ] Tutorial 18: Run writes the slot, and the `>` line rewrites the prompt.
- [ ] Tutorial 18 with `__bus_smells__` added, **Roll**: the queue shows three runs of Orrery Ask (the library, the rewrites, the slot) before the render; the render's log asks the model nothing, and the prompt holds all three.
- [ ] Tutorial 17 with fresh library names: **Write now** queues a run per library at the front of the queue; they wait in To review.
- [ ] A slot's 🎲, then **Generate takes**: three takes arrive one after another, each from a run of its own; a library's 🎲 writes its entries in one.
- [ ] A reel with a slot from the second clip on: the text continues the clip before.
- [ ] A CAST member with `image krea/09_character_creator/…` and `--who she is--`: the sentence fits the picture's prompt.
- [ ] The creator with `backstory = --…--` in EXPORT: the Gallery's sheet shows it.
- [ ] Write → Continue the reel, Story interpolator (fl2va, two frames wired), Prompt from image.
- [ ] The gear → Writers: edit one, run it, Reset to default.

With an **API endpoint** (the gear → An API endpoint, then Check and Save):

- [ ] A wrong key is refused on **Use this endpoint**; the right one shows only how it ends.
- [ ] The footer says `LLM <model> · API`.
- [ ] Tutorial 17 with fresh library names: **Write now** appears in the footer, writes them, and disappears.
- [ ] Tutorial 18 with a new library added (`… on the last night bus that smells of __bus_smells__`): one Run writes the library, the slot and the rewrite. With a text encoder the rewrite waits for the next run.
- [ ] Write → Prompt from image while a render runs: the takes come before the render ends.
- [ ] Write → Story interpolator, both frames from Load Image nodes.
- [ ] Two slots on one line (`a fox with --one small object-- under --a sky, two words--`): both violet, two 🎲; hovering each outlines its slot; Ctrl+click on the second opens its takes.
- [ ] A slot's 🎲 (Tutorial 18): the sheet asks nothing until **Generate takes**, which brings three takes; a click beside the sheet leaves it open; a steer and **Generate takes** again bring three more in that direction; click one, another, then **Use selected**, then Undo; **Keep the direction** puts the steer into the slot.
- [ ] A library still to be written (`__bus_smells__`): its 🎲 and **Generate takes** write 20 entries (the gear's count); a steer, **Keep the direction**, **Generate takes**; select some, **Keep as the library**: the Libraries tab has it, not under To review, with the directions; the line's 🎲 is gone and its roll shows.
- [ ] A line with libraries the home has (the Character creator's last line, or `A __animal__ in __style__ light`): click a roll at its end: rolls of that library, the one at this seed first, and new entries; select two new ones, **Add to the library**: they are in the Libraries tab, marked added in the sheet. Annotations on Hover: Ctrl+click on `__style__` opens the same.
- [ ] A `> enhance` line's 🎲: three rewrites of the prompt as it rolls; **Use selected** on one, then Run at the same seed: the prompt is that rewrite, and no request went to the model.
- [ ] A Krea or i2va template with a picture in `first_frame` (a Load Image) and `--the outfit in image first_frame, one phrase--`: Run writes it from the picture; its 🎲's takes do too. Unwire it: the lint says so, and the 🎲 says what is missing instead of asking.
- [ ] The creator with `sheet = --a full character sheet from $who, as image output shows them--` in its EXPORT: the run leaves it a slot.
- [ ] That picture in the Gallery: its sheet shows the slot with a 🎲; the takes describe the picture; **Use selected** writes one into the sheet.
- [ ] The gear → Picture slots: **After every run**, then run the creator: the sheet shows the slot written.
- [ ] Back to the text encoder in the gear: everything goes through the queue again.

## Planned

- 🧠 **The model watches the input video** (#82). It goes on with the video's story, writes the
  head's `END ON:` and draws CAST descriptions from what the video shows.

An idea, not planned: a director that runs outside the canvas, renders, looks at the result with a
vision model, and decides what comes next (keep, reroll, rewrite). See the studio concept,
[concept-studio.md](concept-studio.md).
