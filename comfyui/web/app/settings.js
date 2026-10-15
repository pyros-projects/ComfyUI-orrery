// The Settings tab (#212): where orrery keeps its libraries, presets and galaxy (the home folder), the language model
// it uses (a text encoder from ComfyUI's text_encoders folder, as in Pixaroma's prompt nodes, or an API endpoint
// beside ComfyUI, #165), the writers' texts, the editor, the clips and the log. Its sections are listed on the left,
// one shows at a time; a setting is saved when it changes, and says so. What moves things or asks the outside keeps a
// button of its own: the home folder, an API endpoint (checked before it is used), a writer's text.
import { esc } from "./highlight.js";
import { icon } from "./icons.js";

const gb = (bytes) => (bytes ? `${(bytes / 1e9).toFixed(1)} GB` : "");

export const SECTIONS = [["home", "Home"], ["llm", "Language model"], ["writers", "Writers"], ["editor", "Editor"],
  ["clips", "Clips"], ["log", "Log"], ["reset", "Reset"]];

// The resets (#310): what each takes away. What was made by hand goes to the home's trash, where it can be fetched;
// the logged pictures and videos only when the box says so (they stay in ComfyUI's output otherwise).
export const RESETS = [
  ["ratings", "Reset the ratings", "Every love, like, nope and hate is taken back, and the learned weights with them: the dice roll as before your first rating. The gallery stays."],
  ["history", "Delete the history", "Every run in the History tab. The gallery stays."],
  ["gallery", "Delete the gallery", "Every output's record, its collections and thumbnails, and the learned weights its ratings made.", true],
  ["presets", "Reset the presets to factory", "Your own presets go to the trash, with your favorites and recents; the built-in ones stay."],
  ["libraries", "Reset the libraries to factory", "Your own libraries and their saved versions go to the trash; the built-in ones stay."],
  ["all", "Reset everything to factory", "A fresh install: the gallery, the ratings, the history, the settings, the API key, the remembered templates, the Refs' anchors and every cache are deleted; your presets, libraries and exports go to the trash. Only the trash stays.", true],
];

// What the Write menu sends the model: each writer a prompt of its own, with only its own rules.
const WRITER_TEXTS = { continue: "Continue the reel", story: "Story interpolator: the fl2va shot between two frames",
  story_scenes: "Story interpolator: scenes", story_keyframes: "Story interpolator: keyframes for an image prompt",
  describe: "Prompt from image: an image prompt", describe_shot: "Prompt from image: an @h3 i2va shot",
  describe_shot_into: "Prompt from image: a shot that brings the picture into the screenplay sent along" };

// The model field: a list once the endpoint has named its models, else a text field.
const modelField = (models, current) => (models.length
  ? `<select class="input mono" id="oa-api-model">${current ? "" : '<option value="" selected disabled>Pick a model</option>'}${[...new Set([current, ...models].filter(Boolean))].map((m) =>
    `<option ${m === current ? "selected" : ""}>${esc(m)}</option>`).join("")}</select>`
  : `<input class="input mono" id="oa-api-model" value="${esc(current)}" placeholder="gpt-6-luna" spellcheck="false">`);

const keyNote = (api) => (api.key_from === "env" ? `From <code>${esc(api.key_env)}</code> in ComfyUI's environment (it wins over a key typed here).`
  : api.key_from === "file" ? `Kept in the home folder's <code>.env</code>, never in orrery.yaml; type a new one to replace it.`
    : `Kept in the home folder's <code>.env</code>, never in orrery.yaml. A local server may need none.`);

const HOME_NOTE = {
  env: (h) => `ORRERY_HOME is set to <code>${esc(h)}</code> and wins over this setting; unset it to use the folder below.`,
  setting: () => "Libraries, presets, the gallery and these settings live here. Existing files are not moved when you change it.",
  default: () => "Libraries, presets, the gallery and these settings live here; empty means <code>~/.orrery</code>. Existing files are not moved when you change it.",
};

// The gear opens the tab, on the section it showed last; again, and the tab before is back.
export function openSettings(app) {
  if (app.state.tab === "settings") return app.go(app.state.beforeSettings || "prompt");
  app.state.beforeSettings = app.state.tab;
  app.go("settings");
}

export async function renderSettings(app) {
  const s = app.state;
  s.setSection ??= app.bridge.props.orrery_settings || "home";
  if (!app.data.settings) {
    app.view.innerHTML = '<div class="empty">Loading the settings…</div>';
    try {
      const [llm, home, writers] = await Promise.all([app.api.llm(), app.api.homeFolder(), app.api.writers()]);
      app.data.settings = { llm, home, writers, drafts: Object.fromEntries(Object.keys(WRITER_TEXTS).map((k) => [k, writers[k].text])), wcur: "continue" };
    } catch (e) { app.view.innerHTML = ""; return app.fail(e); }
    if (s.tab !== "settings") return;
  }
  app.view.innerHTML = `<div class="settings"><nav class="set-nav" aria-label="Settings">${SECTIONS.map(([k, label]) =>
    `<button type="button" class="${k === s.setSection ? "on" : ""}" data-sect="${k}" aria-current="${k === s.setSection}">${esc(label)}</button>`).join("")}</nav>`
    + `<div class="set-main scroll"><div class="set-head"><h4>${esc(SECTIONS.find(([k]) => k === s.setSection)?.[1] || "")}</h4>`
    + `<span class="set-saved" role="status"></span></div>${SECTION_HTML[s.setSection](app, app.data.settings)}</div></div>`;
  app.view.querySelectorAll("[data-sect]").forEach((b) => {
    b.onclick = () => { s.setSection = b.dataset.sect; app.bridge.props.orrery_settings = s.setSection; renderSettings(app); };
  });
  WIRE[s.setSection]?.(app, app.data.settings, app.view);
}

// A change saved: said quietly beside the section's title, an error loudly.
function said(app, text = "✓ Saved", bad = false) {
  const el = app.view.querySelector(".set-saved");
  if (!el) return;
  el.textContent = text;
  el.className = `set-saved show${bad ? " warn" : ""}`;
  clearTimeout(el.timer);
  if (!bad) el.timer = setTimeout(() => { el.className = "set-saved"; }, 1800);
}

// A switch or a size, saved through `ui` the moment it changes.
async function saveUi(app, values) {
  try {
    Object.assign(app.data, await app.api.saveUi(values));
    said(app);
  } catch (err) { said(app, err.message, true); }
}

// The language model's settings as they stand, the endpoint's own only when asked to use it.
async function saveLlm(app, st, view, withApi = false) {
  const q = (sel) => view.querySelector(sel);
  const body = { file: st.llm.file || "", entries: Number(q("#oa-llm-n")?.value ?? st.llm.entries) || 12,
    max_tokens: Number(q("#oa-llm-t")?.value ?? st.llm.max_tokens) || 16000, source: st.llm.source };
  const takes = [...view.querySelectorAll("[data-takes]")];
  if (takes.length) body.takes = Object.fromEntries(takes.map((i) => [i.dataset.takes, Number(i.value) || 3]));  // #274
  if (q("#oa-llm")) body.file = q("#oa-llm").value;
  if (withApi) Object.assign(body, { source: "api", base_url: q("#oa-api-url").value.trim(), model: q("#oa-api-model").value.trim(), key: q("#oa-api-key").value.trim() });
  const before = app.data.llm?.active;
  try {
    st.llm = app.data.llm = await app.api.saveLlm(body);
  } catch (err) { said(app, err.message, true); return false; }
  said(app);
  const now = st.llm.active;
  if (now?.kind !== before?.kind || now?.name !== before?.name) {
    app.toast(now ? `Language model: <b>${esc(now.name)}</b>${now.kind === "api" ? " · API" : ""}` : "No language model: unknown libraries stay an error");
  }
  return true;
}

export const SECTION_HTML = {
  home: (app, { home: h }) => `<div class="field"><label class="label" for="oa-home">Orrery home folder</label>
      <div class="row"><input class="input mono grow" id="oa-home" value="${esc(h.setting || h.home)}" placeholder="/path/to/orrery" ${h.source === "env" ? "disabled" : ""} spellcheck="false">
      <button type="button" class="btn primary" data-home ${h.source === "env" ? "disabled" : ""}>${icon("folder")}Use this folder</button></div>
      <span class="muted">${HOME_NOTE[h.source](h.home)}</span></div>`,

  llm: (app, { llm: s }) => {
    const options = [`<option value="">None: unknown libraries stay an error</option>`]
      .concat(s.files.map((f) => `<option value="${esc(f.name)}" ${f.name === s.file ? "selected" : ""} ${f.can_write ? "" : "disabled"}>`
        + `${esc(f.name)}${f.size ? ` · ${gb(f.size)}` : ""}${f.can_write ? "" : " · can't write"}</option>`)).join("");
    return `<div class="llm-pick" role="radiogroup" aria-label="The language model">
      <label class="check"><input type="radio" name="oa-src" value="comfy" ${s.source !== "api" ? "checked" : ""}><span>A text encoder in ComfyUI</span></label>
      <label class="check"><input type="radio" name="oa-src" value="api" ${s.source === "api" ? "checked" : ""}><span>An API endpoint: OpenAI, or a server that speaks its protocol</span></label></div>
    <div class="llm-src src-comfy">
    <p class="muted flush">A text encoder that is a whole language model can write: Krea 2's <code>qwen3vl_4b</code> or a Qwen3-VL 8B build.
      MiniMax H3's encoder is cut short and cannot. It writes in runs of its own, one task each, ahead of the run that renders; ComfyUI moves it out when the video model needs the room.</p>
    <div class="field"><label class="label" for="oa-llm">Model</label><select class="input" id="oa-llm">${options}</select>
      ${s.files.length ? "" : '<span class="warn">No text encoders found (is this running inside ComfyUI?).</span>'}</div></div>
    <div class="llm-src src-api">
    <p class="muted flush">Every language-model task goes to the endpoint: the libraries, <code>--slots--</code> and <code>&gt; enhance</code> of a run, the <b>Write</b> menu, <code>orrery lib</code>.
      It runs beside ComfyUI: no VRAM, no text encoder pushing the video model out, no waiting behind a render. 
      <b>Use this endpoint</b> checks it first: the key, and one short answer from the model.</p>
    <div class="field"><label class="label" for="oa-api-url">Endpoint</label>
      <input class="input mono" id="oa-api-url" value="${esc(s.api.base_url)}" spellcheck="false"></div>
    <div class="field"><label class="label" for="oa-api-key">Key</label>
      <input class="input mono" id="oa-api-key" type="password" autocomplete="off" placeholder="${s.api.key ? `set · ${esc(s.api.key)}` : "sk-…"}" ${s.api.key_from === "env" ? "disabled" : ""}>
      <span class="muted">${keyNote(s.api)}</span></div>
    <div class="field"><label class="label" for="oa-api-model">Model</label>
      <div class="row"><span id="oa-api-model-box" class="grow">${modelField([], s.api.model)}</span>
        <button type="button" class="btn ghost" data-check title="Ask the endpoint for its models and the model for one short answer">${icon("spark")}Check</button>
        <button type="button" class="btn primary" data-useapi title="Check the endpoint and use it for every language-model task">${icon("check")}Use this endpoint</button></div>
      <span class="muted" id="oa-api-status"></span></div>
    <h5 class="label">Picture slots</h5>
    <p class="muted flush">A slot written from the picture a run makes (<code>--a caption of image output--</code>) waits for the picture, then the endpoint looks at it.</p>
    <div class="llm-pick" role="radiogroup" aria-label="When picture slots are written">${[["gallery", "<b>In the Gallery</b>: the picture's exports show the slot with a 🎲: takes, then more, steered; Use selected writes one in"],
      ["every run", "<b>After every run</b>: one take each, written in as the picture is kept"]].map(([v, label]) =>
      `<label class="check"><input type="radio" name="oa-ps" value="${v}" ${(app.data.picture_slots || "gallery") === v ? "checked" : ""}><span>${label}</span></label>`).join("")}</div></div>
    <div class="field"><span class="label">Takes a 🎲 asks for</span>
      <div class="row wrap takes-n">${[["slot", "for a <code>--slot--</code>"], ["enhance", "for <code>&gt; enhance</code>"], ["rolled", "rolled from a library"], ["new", "new for a library"], ["continue", "for <b>Continue the reel</b>"], ["story", "for the <b>Story interpolator</b>"], ["describe", "for <b>Prompt from image</b>"]].map(([k, label]) =>
        `<label class="row"><input class="input narrow" type="number" min="1" max="12" data-takes="${k}" value="${s.takes?.[k] ?? 3}" aria-label="Takes ${k}"><span class="muted">${label}</span></label>`).join("")}</div>
      <span class="muted">More takes asks for as many again.</span></div>
    <div class="field"><label class="label" for="oa-llm-n">A library it creates starts with</label>
      <div class="row"><input class="input narrow" id="oa-llm-n" type="number" min="1" max="200" value="${s.entries}"><span class="muted">entries · <code>__name:30__</code> asks for at least 30</span></div></div>
    <div class="field"><label class="label" for="oa-llm-t">Max tokens</label>
      <div class="row"><input class="input narrow" id="oa-llm-t" type="number" min="64" max="131072" step="any" value="${s.max_tokens}"><span class="muted">the longest answer it may write in one run; long entries need room</span></div></div>`;
  },

  writers: (app, { writers: wr, wcur }) => `<p class="muted flush">What the <b>Write</b> menu sends the language model: each writer its own prompt, with only the rules it needs.
      <code>{world}</code> <code>{chunks}</code> <code>{next}</code> <code>{handoff}</code> <code>{seconds}</code> and the story's <code>{start}</code> <code>{end}</code> <code>{scenes}</code> <code>{keyframes}</code>, <code>{screenplay}</code> are filled in when it runs; Picture 1 and 2 are the frames it sees, shown first, or where <code>{picture}</code> stands.
      An edit is kept in the home folder, so an update of orrery leaves it alone.</p>
    <div class="field"><div class="row"><select class="input" id="oa-wr" aria-label="Writer text">${Object.entries(WRITER_TEXTS).map(([k, label]) =>
      `<option value="${k}" ${k === wcur ? "selected" : ""}>${esc(label)}${wr[k].edited ? " · edited" : ""}</option>`).join("")}</select>
      <span class="grow"></span>
      <button type="button" class="btn ghost" data-wreset title="Back to the text orrery ships">${icon("undo")}Reset to default</button>
      <button type="button" class="btn primary" data-wsave title="Keep this text in the home folder">${icon("save")}Save text</button></div>
      <textarea class="input mono wtext" id="oa-wt" spellcheck="false" aria-label="The writer text"></textarea></div>`,

  editor: (app) => `<label class="check"><input type="checkbox" data-flag="quickstart" ${app.data.quickstart !== false ? "checked" : ""}>
      <span><b>New</b> templates open with a quickstart: the essentials as <code># …</code> comments above the template</span></label>
    <label class="check"><input type="checkbox" data-flag="dividers" ${app.data.dividers !== false ? "checked" : ""}>
      <span><b>Scene dividers</b>: a reel's SCENE lines name the next clip they play (hover: all of them, when, how much film is left; 📊: the scene in numbers); the scene of the next clip is marked</span></label>
    <label class="check"><input type="checkbox" data-flag="timeline" ${app.data.timeline !== false ? "checked" : ""}>
      <span><b>Timeline</b>: a reel's clips as the reel keeps them (Orrery Film or Chain Video), under each scene, and the frames its <code>REMEMBER:</code> lines take</span></label>
    <h5 class="label">Annotations</h5>
    <p class="muted flush">What a line gives at the node's seed: a binding's roll, every library's, an <code>EXPORT</code>, a grid's runs, where a CAST member's pictures and a <code>REMEMBER:</code> line's frames go.</p>
    <div class="llm-pick" role="radiogroup" aria-label="Where the annotations show">${[["appended", "<b>Appended</b>: at the line's end (a line of libraries lists their rolls in order: → arcade · bob cut · tracksuit)"],
      ["hover", "<b>Hover</b>: on what they belong to, quietly underlined; hovering it shows the roll"],
      ["none", "<b>None</b>: no annotations; hovering a keyword or a library still explains it"]].map(([v, label]) =>
      `<label class="check"><input type="radio" name="oa-ann" value="${v}" ${(app.data.annotations_show || "appended") === v ? "checked" : ""}><span>${label}</span></label>`).join("")}</div>`,

  clips: (app) => `<h5 class="label">Live preview</h5>
    <p class="muted flush">With the model wired through the Orrery Prompt, the clip being sampled plays in the preview below the scenes, in real time, and small as the take being made at the end of its strip of takes.</p>
    <div class="llm-pick" role="radiogroup" aria-label="The live preview">
      <label class="check"><input type="radio" name="oa-pv" value="light" ${app.data.preview_light !== false ? "checked" : ""}><span><b>Light</b>: a few pictures, spread over the clip</span></label>
      <label class="check"><input type="radio" name="oa-pv" value="smooth" ${app.data.preview_light === false ? "checked" : ""}><span><b>Smooth</b>:
        <input class="input narrow" id="oa-pvfps" type="number" min="1" max="24" step="1" value="${app.data.preview_fps ?? 12}" aria-label="Pictures a second">
        pictures a second, as far as the clip gives them (taeh3 and Latent2RGB: one a latent frame, about 7 a second for H3)</span></label></div>
    <div class="field"><label class="label" for="oa-pvedge">Preview size</label>
      <div class="row"><input class="input narrow" id="oa-pvedge" type="number" min="0" max="4096" step="64" value="${app.data.preview_edge ?? 1024}"><span class="muted">px on the long side; 0 for the size it is sampled at. Bigger is sharper and takes longer each step</span></div></div>
    <h5 class="label">Sample surfing</h5>
    <p class="muted flush">A scene's <b>×N</b> renders N takes of its clip; you pick the best under it (📌 in the scene keeps its rolled prompt, so only the noise changes).
      The takes differ only if their seeds do.</p>
    <div class="llm-pick" role="radiogroup" aria-label="The takes' seeds">
      <label class="check"><input type="radio" name="oa-surf" value="numbered" ${app.data.surf_numbered !== false ? "checked" : ""}><span><b>Numbered</b> from the node's seed: seed+1, seed+2 … (the same takes again tomorrow)</span></label>
      <label class="check"><input type="radio" name="oa-surf" value="control" ${app.data.surf_numbered === false ? "checked" : ""}><span>As the node's <b>control after generate</b> says (randomize: new ones every time; fixed: the same take again)</span></label></div>`,

  log: (app) => `<label class="check"><input type="checkbox" data-flag="log_prompts" ${app.data.log_prompts !== false ? "checked" : ""}>
      <span><b>Log each run</b> to ComfyUI's console: its seed, every pick and the resolved prompt (the <b>History</b> tab keeps them either way)</span></label>`,

  reset: () => `<p class="muted flush">Each asks first. What you made by hand goes to the <code>trash</code> folder in your home, where you can still fetch it.</p>`
    + RESETS.map(([k, title, what, files]) => `<div class="reset-row"><div><b>${esc(title)}</b><p class="muted flush">${esc(what)}</p>`
      + (files ? `<label class="check"><input type="checkbox" data-rfiles="${k}"><span>and move the pictures and videos it logged to the trash too</span></label>` : "")
      + `</div><button type="button" class="btn ghost danger" data-reset="${k}">${icon("trash")}${esc(title.split(" ")[0])}</button></div>`).join(""),
};

// A number field's value, kept within its bounds.
const num = (el, fallback) => {
  const v = Number(el.value);
  return Number.isFinite(v) && el.value !== "" ? Math.min(Number(el.max || Infinity), Math.max(Number(el.min || -Infinity), Math.round(v))) : fallback;
};

const WIRE = {
  home: (app, st, view) => {
    view.querySelector("[data-home]").onclick = async () => {
      const wanted = view.querySelector("#oa-home").value.trim();
      try {
        const moved = await app.api.saveHomeFolder(wanted);
        Object.assign(app.data, { libraries: null, gCards: null, gTemplates: null });
        app.state.gFetched = false;
        await Promise.all([app.refreshPresets(), app.refreshCompletion()]);
        st.home = await app.api.homeFolder();
        app.toast(`Home folder: <b>${esc(moved.home)}</b>`);
        renderSettings(app);
      } catch (err) { said(app, err.message, true); }
    };
  },

  llm: (app, st, view) => {
    const source = () => view.querySelector('[name="oa-src"]:checked').value;
    const api = () => ({ base_url: view.querySelector("#oa-api-url").value.trim(), model: view.querySelector("#oa-api-model").value.trim(),
      key: view.querySelector("#oa-api-key").value.trim() });
    const status = view.querySelector("#oa-api-status");
    const check = async (ask) => {
      status.className = "muted";
      status.textContent = ask ? "Asking the endpoint…" : "Fetching the models…";
      try {
        const got = await app.api.checkLlm(ask ? api() : { ...api(), model: "" });
        if (got.models.length) view.querySelector("#oa-api-model-box").innerHTML = modelField(got.models, api().model);
        status.className = got.ok || (!ask && got.models.length) ? "muted" : "warn";
        status.textContent = got.ok ? `✓ ${api().model} answered in ${got.seconds} s` : !ask && got.models.length ? `${got.models.length} models` : got.error;
      } catch (err) { status.className = "warn"; status.textContent = err.message; }
    };
    const show = () => {
      view.querySelector(".src-comfy").hidden = source() === "api";
      view.querySelector(".src-api").hidden = source() !== "api";
    };
    view.querySelectorAll('[name="oa-src"]').forEach((r) => {
      r.onchange = async () => {
        show();
        if (source() === "api") return check(false);  // an endpoint is used only once it answered: Use this endpoint
        st.llm.source = "comfy";
        await saveLlm(app, st, view);
      };
    });
    view.querySelector("#oa-llm").onchange = () => saveLlm(app, st, view);
    view.querySelectorAll('[name="oa-ps"]').forEach((r) => { r.onchange = () => saveUi(app, { picture_slots: r.value }); });
    for (const id of ["#oa-llm-n", "#oa-llm-t"]) view.querySelector(id).onchange = () => saveLlm(app, st, view);
    view.querySelectorAll("[data-takes]").forEach((i) => { i.onchange = () => saveLlm(app, st, view); });
    view.querySelector("[data-check]").onclick = () => check(true);
    view.querySelector("[data-useapi]").onclick = async () => {
      status.className = "muted";
      status.textContent = "Asking the endpoint…";
      if (await saveLlm(app, st, view, true)) {
        status.textContent = `✓ In use: ${st.llm.api.model}`;
        view.querySelector("#oa-api-key").value = "";
      } else status.textContent = "";
    };
    show();
    if (st.llm.source === "api") check(false);
  },

  writers: (app, st, view) => {
    const wsel = view.querySelector("#oa-wr"), wtext = view.querySelector("#oa-wt");
    wtext.value = st.drafts[st.wcur];
    wtext.oninput = () => { st.drafts[st.wcur] = wtext.value; };
    wsel.onchange = () => { st.wcur = wsel.value; wtext.value = st.drafts[st.wcur]; };
    view.querySelector("[data-wreset]").onclick = () => { wtext.value = st.drafts[st.wcur] = st.writers[st.wcur].default; };
    view.querySelector("[data-wsave]").onclick = async () => {
      try {
        await app.api.saveWriter(st.wcur, wtext.value);
        st.writers = await app.api.writers();
        said(app);
        const opt = wsel.querySelector(`option[value="${st.wcur}"]`);
        if (opt) opt.textContent = `${WRITER_TEXTS[st.wcur]}${st.writers[st.wcur].edited ? " · edited" : ""}`;
      } catch (err) { said(app, err.message, true); }
    };
  },

  editor: (app, st, view) => {
    wireFlags(app, view);
    view.querySelectorAll('[name="oa-ann"]').forEach((r) => { r.onchange = () => saveUi(app, { annotations_show: r.value }); });
  },
  log: (app, st, view) => wireFlags(app, view),

  reset: (app, st, view) => {
    view.querySelectorAll("[data-reset]").forEach((b) => { b.onclick = () => confirmReset(app, b.dataset.reset, !!view.querySelector(`[data-rfiles="${b.dataset.reset}"]`)?.checked); });
  },

  clips: (app, st, view) => {
    const q = (sel) => view.querySelector(sel);
    q("#oa-pvedge").onchange = () => saveUi(app, { preview_edge: num(q("#oa-pvedge"), 1024) });
    q("#oa-pvfps").onchange = () => {
      q('[name="oa-pv"][value="smooth"]').checked = true;
      saveUi(app, { preview_fps: num(q("#oa-pvfps"), 12), preview_light: false });
    };
    view.querySelectorAll('[name="oa-pv"]').forEach((r) => { r.onchange = () => saveUi(app, { preview_light: r.value === "light" }); });
    view.querySelectorAll('[name="oa-surf"]').forEach((r) => { r.onchange = () => saveUi(app, { surf_numbered: r.value === "numbered" }); });
  },
};

// A reset asked first, then done; everything that showed the old state reads it again.
function confirmReset(app, what, files) {
  const [, title, text] = RESETS.find(([k]) => k === what);
  const sheet = app.openSheet(`<form class="panel"><div class="row spread"><h4>${esc(title)}?</h4></div>
    <p class="muted flush">${esc(text)}${files ? " The pictures and videos it logged go to the trash too." : ""} This cannot be undone here.</p>
    <div class="acts"><button type="button" class="btn ghost" data-cancel>Cancel</button><button class="btn danger">${icon("trash")}${esc(title)}</button></div></form>`);
  sheet.querySelector("[data-cancel]").onclick = () => app.closeSheet();
  sheet.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    try { await app.api.reset(what, files); } catch (err) { app.closeSheet(); return app.fail(err); }
    app.closeSheet();
    Object.assign(app.data, { libraries: null, libFull: {}, gCards: null, gTotal: undefined, gTemplates: null, hRuns: null, weights: {} });
    Object.assign(app.state, { gFetched: false, hFetched: false, gSel: new Set(), gOpen: null, gAlbums: [], gPlace: { view: "all", day: null, coll: null } });
    if (what === "all") app.data.settings = null;  // the language model's settings and key are gone too
    await Promise.all([app.refreshPresets(), app.refreshCompletion()]).catch((err) => app.fail(err));
    app.toast(`${esc(title)}: done`);
    app.render();
  };
  sheet.querySelector("button.danger").focus();
}

function wireFlags(app, view) {
  view.querySelectorAll("[data-flag]").forEach((c) => { c.onchange = () => saveUi(app, { [c.dataset.flag]: c.checked }); });
}
