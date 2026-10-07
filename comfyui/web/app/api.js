// Thin client for the /orrery/* routes. Errors carry the server's sentence and status.
import { api } from "../../../scripts/api.js";

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export function client(home) {
  const withHome = (query = {}) => {
    const q = new URLSearchParams({ ...query, ...(home() ? { home: home() } : {}) });
    return q.toString() ? `?${q}` : "";
  };
  async function call(path, { query, body } = {}) {
    const init = body === undefined ? {} : {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, ...(home() ? { home: home() } : {}) }),
    };
    const res = await api.fetchApi(`/orrery/${path}${withHome(query)}`, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(data.error || `orrery: ${path} failed (${res.status})`, res.status, data);
    return data;
  }
  const url = (path, query) => api.apiURL(`/orrery/${path}${withHome(query)}`);
  return {
    completions: () => call("completions"),
    presets: () => call("presets"),
    presetsGrep: (pattern) => call("presets/grep", { query: { pattern } }),
    preset: (name) => call("preset", { query: { name } }),
    savePreset: (body) => call("preset/save", { body }),
    deletePreset: (name) => call("preset/delete", { body: { name } }),
    favorite: (name, on) => call("favorite", { body: { name, on } }),
    recent: (name) => call("recent", { body: { name } }),
    saveUi: (body) => call("ui", { body }),
    template: (hash) => call("template", { query: { hash } }),
    libraries: (q) => call("libraries", q ? { query: { q } } : {}),
    library: (name) => call("library", { query: { name } }),
    saveLibrary: (body) => call("library/save", { body }),
    ownLibrary: (name) => call("library/own", { body: { name } }),
    deleteLibrary: (name) => call("library/delete", { body: { name } }),
    renameLibrary: (name, to) => call("library/rename", { body: { name, to } }),
    acceptLibrary: (name) => call("library/accept", { body: { name } }),
    discardLibrary: (name) => call("library/discard", { body: { name } }),
    galaxy: (query = {}) => call("galaxy", { query }),
    history: (query = {}) => call("history", { query }),
    writers: () => call("writers"),
    saveWriter: (name, text) => call("writers", { body: { name, text } }),
    rate: (id, rating) => call("galaxy/rate", { body: { id, rating } }),
    deleteOutputs: (ids) => call("galaxy/delete", { body: { ids } }),
    exportPairs: (ids, name) => call("galaxy/export", { body: { ids, name } }),
    galaxyView: (query = {}) => call("galaxy/view", { query }),
    reset: (what, files = false) => call("reset", { body: { what, files } }),
    collect: (ids, path) => call("galaxy/collect", { body: { ids, path } }),
    circle: (shoot, files) => call("galaxy/circle", { body: { shoot, files } }),
    uncollect: (ids, path) => call("galaxy/uncollect", { body: { ids, path } }),
    addCollection: (path) => call("galaxy/collection/add", { body: { path } }),
    renameCollection: (path, to) => call("galaxy/collection/rename", { body: { path, to } }),
    deleteCollection: (path) => call("galaxy/collection/delete", { body: { path } }),
    roll: (body) => call("roll", { body }),
    plan: (body) => call("plan", { body }),
    remembered: (body) => call("remembered", { body }),
    annotate: (body) => call("annotate", { body }),
    pictures: () => call("pictures"),
    reel: (body) => call("reel", { body }),
    frequency: (body) => call("frequency", { body }),
    homeFolder: () => call("home"),
    saveHomeFolder: (path) => call("home", { body: { path } }),
    llm: () => call("llm"),
    saveLlm: (body) => call("llm", { body }),
    checkLlm: (body) => call("llm/check", { body }),
    writeIdea: (body) => call("write", { body }),
    writePlace: (body) => call("write/place", { body }),
    writeLibraries: (body) => call("llm/libraries", { body }),
    thumbURL: (id) => url("galaxy/thumb", { id }),
    onRunDone: (fn) => { api.addEventListener("execution_success", fn); return () => api.removeEventListener("execution_success", fn); },
    onExecuted: (fn) => { api.addEventListener("executed", fn); return () => api.removeEventListener("executed", fn); },
    // The sampler's previews while a clip renders (#205): KJNodes' Model Preview Override (a picture, or the whole
    // clip as an animated WebP or an MP4), else ComfyUI's own preview (b_preview); and the step progress.
    onPreview: (fn) => {
      const kj = ({ detail: d }) => d?.image && fn({ src: `data:${d.mime || "image/jpeg"};base64,${d.image}`, video: d.mime === "video/mp4", rank: 3,
        step: d.step, total: d.total });
      let tagged = false;  // newer frontends send each picture twice, with its prompt and without: the first is enough
      const meta = ({ detail: d }) => { if (d?.blob instanceof Blob) { tagged = true; fn({ blob: d.blob, prompt: d.jobId, rank: 1 }); } };
      const own = ({ detail }) => { const blob = detail?.blob || detail; if (!tagged && blob instanceof Blob) fn({ blob, rank: 1 }); };
      const step = ({ detail: d }) => d && fn({ step: d.value, total: d.max, prompt: d.prompt_id });
      const on = [["kj_preview_override", kj], ["b_preview_with_metadata", meta], ["b_preview", own], ["progress", step]];
      on.forEach(([kind, f]) => api.addEventListener(kind, f));
      return () => on.forEach(([kind, f]) => api.removeEventListener(kind, f));
    },
    captureOutputs: (body) => call("galaxy/capture", { body }),
    mediaURL: (id) => url("galaxy/media", { id }),
    chain: (chain) => call("chain", { query: chain ? { chain } : {} }),
    chainThumbURL: (segment, chain, v) => url("chain/thumb", { segment, ...(chain ? { chain } : {}), v: v ?? "" }),
    chainVideoURL: (segment, chain, v) => url("chain/video", { segment, ...(chain ? { chain } : {}), v: v ?? "" }),
    moveChain: (from, to) => call("chain/move", { body: { from, to } }),
    pickTake: (chain, segment, folder) => call("chain/pick", { body: { chain, segment, folder } }),
    deleteTake: (chain, segment, folder) => call("chain/delete", { body: { chain, segment, folder } }),
    clearTakes: (chain, segment, keep) => call("chain/clear", { body: { chain, segment, keep } }),
    chainTree: (chain) => call("chain/tree", { query: { chain } }),
    walkTo: (chain, folder) => call("chain/walk", { body: { chain, folder } }),
    endFilm: (chain, segment) => call("chain/end", { body: { chain, segment } }),
    takeThumbURL: (chain, take) => url("chain/thumb", { take, ...(chain ? { chain } : {}) }),
    takeVideoURL: (chain, take) => url("chain/video", { take, ...(chain ? { chain } : {}) }),
    takes: (body) => call("llm/takes", { body }),
    keepRewrite: (body) => call("llm/keep", { body }),
    llmPlan: (body) => call("llm/plan", { body }),
    addToLibrary: (body) => call("library/add", { body }),
    galaxyTakes: (body) => call("galaxy/takes", { body }),
    galaxyWrite: (body) => call("galaxy/write", { body }),
    viewURL: (m) => api.apiURL(`/view?${new URLSearchParams({ filename: m.filename, subfolder: m.subfolder || "", type: m.type || "output" })}`),
    filmURL: (chain, v) => url("chain/video", { film: 1, v: v ?? "", ...(chain ? { chain } : {}) }),
    anchorURL: (image, v) => url("anchor", { image, v: v ?? "" }),
    anchors: () => call("anchors"),
  };
}
