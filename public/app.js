/* Short AI Art — operator dashboard.
   No build step, no dependencies: this file is served as-is. */

/* ------------------------------------------------------------------ *
 * Safe templating
 * ------------------------------------------------------------------ */

const escapeHtml = (value = "") => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

class Raw {
  constructor(value) {
    this.value = value;
  }
}

function interpolate(value) {
  if (value instanceof Raw) return value.value;
  if (Array.isArray(value)) return value.map(interpolate).join("");
  if (value === null || value === undefined || value === false) return "";
  return escapeHtml(value);
}

/** Tagged template that escapes every interpolation unless it is already a Raw. */
function html(strings, ...values) {
  return new Raw(strings.reduce(
    (out, chunk, i) => out + chunk + (i < values.length ? interpolate(values[i]) : ""),
    ""
  ));
}

function setHtml(element, content) {
  element.innerHTML = content instanceof Raw ? content.value : escapeHtml(content);
}

/* ------------------------------------------------------------------ *
 * State + DOM helpers
 * ------------------------------------------------------------------ */

const state = {
  project: null,
  picked: null,
  activeId: null,
  pendingDelete: null,
  dirtyScenes: new Set(),
  promptHistory: []
};

const $ = (id) => document.getElementById(id);
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function scrollToSection(element) {
  element?.scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "start" });
}

function setStatus(message, tone = "idle") {
  const pill = $("saveStatus");
  pill.textContent = message;
  pill.dataset.tone = tone;
}

function showError(message) {
  $("errorMessage").textContent = message;
  $("errorBanner").classList.remove("hidden");
}

function clearError() {
  $("errorBanner").classList.add("hidden");
  $("errorMessage").textContent = "";
}

function show(id) {
  $(id).classList.remove("hidden");
}

function hide(id) {
  $(id).classList.add("hidden");
}

/* ------------------------------------------------------------------ *
 * API
 * ------------------------------------------------------------------ */

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      headers: { "content-type": "application/json" },
      ...options
    });
  } catch {
    throw new Error("Cannot reach the production server. Check that it is still running.");
  }

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!response.ok) {
    throw new Error(data?.error || `Request failed (${response.status} ${response.statusText})`);
  }
  return data;
}

/**
 * Runs an async action with a busy button, a status pill and inline error reporting.
 * Returns { ok } so callers can skip follow-up work when the request failed.
 */
async function run(button, busyLabel, task) {
  if (button?.dataset.busy === "1") return { ok: false };
  const original = button?.textContent;
  if (button) {
    button.dataset.busy = "1";
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    if (busyLabel) button.textContent = busyLabel;
  }
  clearError();
  setStatus(busyLabel || "Working…", "working");

  try {
    const value = await task();
    return { ok: true, value };
  } catch (error) {
    showError(error.message);
    setStatus("Action failed", "error");
    return { ok: false };
  } finally {
    if (button) {
      delete button.dataset.busy;
      button.disabled = false;
      button.removeAttribute("aria-busy");
      if (busyLabel && original !== undefined) button.textContent = original;
    }
  }
}

/* ------------------------------------------------------------------ *
 * Provider + library
 * ------------------------------------------------------------------ */

async function refreshProvider() {
  const pill = $("provider");
  try {
    const status = await api("/api/provider-status");
    if (status.higgsfield.installed && status.paidGenerationEnabled) {
      pill.textContent = "Higgsfield: connected + enabled";
      pill.dataset.state = "live";
    } else if (status.higgsfield.installed) {
      pill.textContent = "Higgsfield CLI: detected (spend locked)";
      pill.dataset.state = "locked";
    } else {
      pill.textContent = "Higgsfield: not connected yet";
      pill.dataset.state = "offline";
    }
  } catch {
    pill.textContent = "Provider status unavailable";
    pill.dataset.state = "offline";
  }
}

function projectRow(item) {
  const active = item.id === state.activeId;
  const scenes = item.scenes ? `${item.approved}/${item.scenes} approved` : "no scenes yet";

  if (state.pendingDelete === item.id) {
    return html`
      <div class="project-row confirming">
        <p class="confirm-copy">Delete “${item.title}”? This cannot be undone.</p>
        <div class="confirm-actions">
          <button type="button" class="danger" data-confirm-delete="${item.id}">Delete</button>
          <button type="button" class="ghost" data-cancel-delete="1">Cancel</button>
        </div>
      </div>
    `;
  }

  return html`
    <div class="project-row ${active ? "active" : ""}">
      <button type="button" class="project-open" data-project="${item.id}" ${active ? new Raw('aria-current="true"') : ""}>
        <span class="project-title">${item.title}</span>
        <span class="project-meta">${item.status} · ${scenes} · ${new Date(item.updatedAt).toLocaleDateString()}</span>
      </button>
      <button type="button" class="project-delete" data-delete="${item.id}" aria-label="Delete ${item.title}">✕</button>
    </div>
  `;
}

async function refreshProjects() {
  const container = $("projects");
  let projects;
  try {
    projects = await api("/api/projects");
  } catch (error) {
    setHtml(container, html`<p class="muted">Project library unavailable.</p>`);
    throw error;
  }

  if (!projects.length) {
    setHtml(container, html`<p class="muted">No projects yet.</p>`);
    return;
  }
  setHtml(container, html`${projects.slice(0, 12).map(projectRow)}`);
}

/* ------------------------------------------------------------------ *
 * Step 1 — concepts
 * ------------------------------------------------------------------ */

function conceptHeadline(concept) {
  if (concept.headline) return concept.headline;
  if (concept.character) return concept.character.split(/\s+/).slice(0, 8).join(" ");
  return concept.label;
}

function renderConcepts() {
  const { project } = state;
  show("conceptSection");
  state.picked = project.selectedConcept || null;

  const recommendedId = project.recommendation?.id;
  const recommended = project.concepts.find((item) => item.id === recommendedId) || project.concepts[0];
  $("recommendation").textContent = recommended
    ? `Recommended: ${recommended.label} · ${recommended.score ?? "—"}/100`
    : "Pick your favorite";

  setHtml($("concepts"), html`${project.concepts.map((concept) => html`
    <button type="button" class="card ${state.picked?.id === concept.id ? "selected" : ""}"
            data-concept="${concept.id}"
            aria-pressed="${state.picked?.id === concept.id ? "true" : "false"}">
      <span class="card-head">
        <span class="tag">${String(concept.label).toUpperCase()}</span>
        <span class="score">${concept.score ?? "—"}</span>
      </span>
      <span class="card-title">${conceptHeadline(concept)}</span>
      ${concept.character ? html`<span class="card-subject">${concept.character}</span>` : ""}
      <span class="card-prompt">${concept.prompt}</span>
      ${concept.recommendation ? html`<span class="card-note">${concept.recommendation}</span>` : ""}
    </button>
  `)}`);
}

function selectConcept(id) {
  const concept = state.project?.concepts.find((item) => item.id === id);
  if (!concept) return;
  state.picked = concept;

  document.querySelectorAll(".card").forEach((card) => {
    const isSelected = card.dataset.concept === id;
    card.classList.toggle("selected", isSelected);
    card.setAttribute("aria-pressed", String(isSelected));
  });

  state.promptHistory = [];
  $("undoEdit").disabled = true;
  $("masterPrompt").value = concept.prompt;
  show("selectedSection");
  scrollToSection($("selectedSection"));
}

/* ------------------------------------------------------------------ *
 * Step 3 — storyboard
 * ------------------------------------------------------------------ */

function updateSaveAllState() {
  $("saveAllScenes").disabled = state.dirtyScenes.size === 0;
}

function markSceneDirty(sceneNumber, dirty) {
  if (dirty) state.dirtyScenes.add(sceneNumber);
  else state.dirtyScenes.delete(sceneNumber);

  const article = document.querySelector(`[data-scene="${sceneNumber}"]`);
  if (article) {
    article.classList.toggle("dirty", dirty);
    const saveButton = article.querySelector("[data-save-scene]");
    if (saveButton) saveButton.disabled = !dirty;
  }
  updateSaveAllState();
}

function renderStoryboard() {
  const { project } = state;
  show("storySection");
  state.dirtyScenes.clear();
  updateSaveAllState();

  setHtml($("story"), html`${project.storyboard.map((scene) => html`
    <article class="scene" data-scene="${scene.scene}">
      <div class="scene-number">SC ${scene.scene}</div>
      <div class="scene-body">
        <div class="scene-title"><b>${scene.name}</b><span>${scene.duration}s</span></div>
        <p class="scene-beat">${scene.beat}</p>
        <label class="sr-only" for="scene-prompt-${scene.scene}">Scene ${scene.scene} prompt</label>
        <textarea id="scene-prompt-${scene.scene}" class="scene-prompt" data-scene-prompt="${scene.scene}">${scene.prompt}</textarea>
        <div class="scene-actions">
          <button type="button" class="save-scene" data-save-scene="${scene.scene}" disabled>Save scene prompt</button>
          <span class="dirty-flag">Unsaved changes</span>
        </div>
      </div>
    </article>
  `)}`);
}

async function saveScene(sceneNumber, button) {
  const textarea = document.querySelector(`[data-scene-prompt="${sceneNumber}"]`);
  if (!textarea) return { ok: false };
  if (!textarea.value.trim()) {
    showError(`Scene ${sceneNumber} prompt cannot be empty.`);
    return { ok: false };
  }

  const result = await run(button, "Saving…", async () => {
    state.project = await api(`/api/projects/${state.project.id}/scene`, {
      method: "POST",
      body: JSON.stringify({ scene: sceneNumber, prompt: textarea.value })
    });
  });

  if (result.ok) {
    markSceneDirty(sceneNumber, false);
    setStatus("Saved", "ok");
  }
  return result;
}

/* ------------------------------------------------------------------ *
 * Step 4 — keyframe review
 * ------------------------------------------------------------------ */

const RENDER_LABELS = {
  "awaiting-keyframe": "Awaiting keyframe",
  "needs-rework": "Needs rework",
  approved: "Approved",
  "blocked-retry-limit": "Retry limit reached"
};

function renderPlanView() {
  const { project } = state;
  show("queueSection");

  const maxRetries = project.costGuardrails?.maxRetriesPerShot ?? 2;

  setHtml($("renderStages"), html`${(project.renderPlan?.stages || []).map((stage, index) => html`
    <div class="stage">
      <span class="stage-index">${index + 1}</span>
      <div>
        <b>${stage.label}</b>
        <p>${stage.purpose}</p>
      </div>
      <small>${stage.count} output${stage.count === 1 ? "" : "s"}</small>
    </div>
  `)}`);

  const renders = project.renders || [];
  const approved = renders.filter((render) => render.approved).length;
  const blocked = renders.filter((render) => render.status === "blocked-retry-limit").length;
  $("renderProgress").textContent = renders.length
    ? `${approved} of ${renders.length} keyframes approved${blocked ? ` · ${blocked} at the retry limit` : ""}${approved === renders.length ? " · ready for video" : ""}`
    : "";

  setHtml($("queueList"), html`${renders.map((render) => html`
    <div class="queue-row" data-render="${render.scene}">
      <div class="queue-head">
        <b>SC ${render.scene}</b>
        <span class="status-pill" data-state="${render.status}">${RENDER_LABELS[render.status] || render.status}</span>
        <span class="attempts">Retries ${render.attempts}/${maxRetries}</span>
      </div>
      <label class="output-label" for="output-${render.scene}">Approved keyframe reference
        <input id="output-${render.scene}" class="output-input" type="text" data-output="${render.scene}"
               value="${render.output || ""}" placeholder="Paste the still's URL or file path" />
      </label>
      <div class="queue-actions">
        <button type="button" data-decision="approve" data-scene="${render.scene}">Approve</button>
        <button type="button" data-decision="rework" data-scene="${render.scene}"
                ${render.status === "blocked-retry-limit" ? new Raw("disabled") : ""}>Needs rework</button>
        <button type="button" class="ghost" data-decision="reset" data-scene="${render.scene}">Reset</button>
      </div>
    </div>
  `)}`);
}

async function decideRender(sceneNumber, decision, button) {
  const input = document.querySelector(`[data-output="${sceneNumber}"]`);
  const labels = { approve: "Approving…", rework: "Flagging…", reset: "Resetting…" };

  const result = await run(button, labels[decision], async () => {
    state.project = await api(`/api/projects/${state.project.id}/render`, {
      method: "POST",
      body: JSON.stringify({ scene: sceneNumber, decision, output: input?.value ?? "" })
    });
  });

  if (result.ok) {
    renderPlanView();
    await refreshProjects().catch(() => {});
    setStatus("Saved · no credits spent", "ok");
  }
}

/* ------------------------------------------------------------------ *
 * Project lifecycle
 * ------------------------------------------------------------------ */

function resetWorkspace() {
  state.project = null;
  state.picked = null;
  state.activeId = null;
  state.dirtyScenes.clear();
  state.promptHistory = [];
  ["conceptSection", "selectedSection", "storySection", "queueSection"].forEach(hide);
}

function showProject(project, { fresh }) {
  state.project = project;
  state.activeId = project.id;
  state.promptHistory = [];
  $("undoEdit").disabled = true;

  hide("selectedSection");
  hide("storySection");
  hide("queueSection");

  renderConcepts();

  if (project.selectedConcept) {
    $("masterPrompt").value = project.selectedConcept.prompt;
    show("selectedSection");
  }
  if (project.storyboard?.length) renderStoryboard();
  if (project.renderPlan) renderPlanView();
  if (fresh) scrollToSection($("conceptSection"));
}

async function createProject(button, body, busyLabel) {
  const result = await run(button, busyLabel, () => api("/api/projects", {
    method: "POST",
    body: JSON.stringify(body)
  }));
  if (!result.ok) return;

  showProject(result.value, { fresh: true });
  await refreshProjects().catch(() => {});
  setStatus("Saved", "ok");
}

async function loadProject(id, button) {
  // Opening a project abandons any half-started delete elsewhere in the list.
  state.pendingDelete = null;
  const result = await run(button, null, () => api(`/api/projects/${id}`));
  if (!result.ok) return;

  showProject(result.value, { fresh: false });
  await refreshProjects().catch(() => {});
  setStatus("Loaded", "ok");
  scrollToSection($("conceptSection"));
}

async function removeProject(id, button) {
  const result = await run(button, "Deleting…", () => api(`/api/projects/${id}`, { method: "DELETE" }));
  state.pendingDelete = null;
  if (!result.ok) {
    await refreshProjects().catch(() => {});
    return;
  }
  if (state.activeId === id) resetWorkspace();
  await refreshProjects().catch(() => {});
  setStatus("Project deleted", "ok");
}

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */

$("errorDismiss").onclick = clearError;

$("createForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const character = $("character").value.trim();
  const setting = $("setting").value.trim();
  const formError = $("formError");

  if (!character && !setting) {
    formError.textContent = "Describe at least a character or a setting before generating concepts.";
    formError.classList.remove("hidden");
    $("character").focus();
    return;
  }
  formError.classList.add("hidden");

  createProject($("custom"), {
    mode: "custom",
    character,
    setting,
    mood: $("mood").value.trim(),
    style: $("style").value.trim(),
    seconds: 30,
    aspectRatio: "9:16"
  }, "Generating…");
});

$("clearForm").onclick = () => {
  ["character", "setting", "mood", "style"].forEach((id) => {
    $(id).value = "";
  });
  $("formError").classList.add("hidden");
  $("character").focus();
};

$("trendDog").onclick = () => createProject($("trendDog"), {
  mode: "inspiration",
  kind: "dog",
  seconds: 30,
  aspectRatio: "9:16"
}, "Generating…");

$("trendPerson").onclick = () => createProject($("trendPerson"), {
  mode: "inspiration",
  kind: "person",
  seconds: 30,
  aspectRatio: "9:16"
}, "Generating…");

$("concepts").addEventListener("click", (event) => {
  const card = event.target.closest("[data-concept]");
  if (card) selectConcept(card.dataset.concept);
});

$("projects").addEventListener("click", (event) => {
  const open = event.target.closest("[data-project]");
  if (open) return loadProject(open.dataset.project, open);

  const remove = event.target.closest("[data-delete]");
  if (remove) {
    state.pendingDelete = remove.dataset.delete;
    return refreshProjects().catch(() => {});
  }

  const confirmed = event.target.closest("[data-confirm-delete]");
  if (confirmed) return removeProject(confirmed.dataset.confirmDelete, confirmed);

  if (event.target.closest("[data-cancel-delete]")) {
    state.pendingDelete = null;
    return refreshProjects().catch(() => {});
  }
});

const PROMPT_ADDITIONS = {
  "more-vibrant": " Increase luminous color depth, richer atmospheric light and premium saturated color while preserving natural highlight detail.",
  "more-scenic": " Increase the apparent scale, depth and extravagance of the environment while keeping the main character immediately readable.",
  "more-emotional": " Increase expressive eye contact, warmth and emotional storytelling without becoming sentimental or static.",
  "more-motion": " Increase directional motion cues, dynamic pose, foreground parallax and cinematic camera energy while preserving anatomy and identity."
};

document.querySelectorAll("[data-edit]").forEach((button) => {
  button.onclick = () => {
    const addition = PROMPT_ADDITIONS[button.dataset.edit];
    if (!addition) return;
    const field = $("masterPrompt");
    state.promptHistory.push(field.value);
    field.value = `${field.value.trim()}${addition}`;
    $("undoEdit").disabled = false;
    setStatus("Prompt edited · not yet locked", "idle");
  };
});

$("undoEdit").onclick = () => {
  const previous = state.promptHistory.pop();
  if (previous === undefined) return;
  $("masterPrompt").value = previous;
  $("undoEdit").disabled = state.promptHistory.length === 0;
};

$("lock").onclick = async () => {
  if (!state.project || !state.picked) {
    showError("Pick a concept before locking the storyboard.");
    return;
  }
  const prompt = $("masterPrompt").value.trim();
  if (!prompt) {
    showError("The master prompt cannot be empty.");
    return;
  }

  const result = await run($("lock"), "Building…", async () => {
    state.project = await api(`/api/projects/${state.project.id}/select`, {
      method: "POST",
      body: JSON.stringify({ conceptId: state.picked.id, prompt })
    });
    state.project = await api(`/api/projects/${state.project.id}/storyboard`, {
      method: "POST",
      body: JSON.stringify({ seconds: state.project.seconds || 30 })
    });
  });
  if (!result.ok) return;

  renderStoryboard();
  // A rebuilt storyboard clears the previous plan server-side; mirror that here.
  hide("queueSection");
  await refreshProjects().catch(() => {});
  setStatus("Saved", "ok");
  scrollToSection($("storySection"));
};

$("story").addEventListener("input", (event) => {
  const textarea = event.target.closest("[data-scene-prompt]");
  if (!textarea) return;
  const sceneNumber = Number(textarea.dataset.scenePrompt);
  const saved = state.project?.storyboard?.find((scene) => scene.scene === sceneNumber);
  markSceneDirty(sceneNumber, textarea.value !== saved?.prompt);
});

$("story").addEventListener("click", (event) => {
  const button = event.target.closest("[data-save-scene]");
  if (button) saveScene(Number(button.dataset.saveScene), button);
});

$("saveAllScenes").onclick = async () => {
  const pending = [...state.dirtyScenes].sort((a, b) => a - b);
  const button = $("saveAllScenes");
  for (const sceneNumber of pending) {
    const result = await saveScene(sceneNumber, button);
    if (!result.ok) return;
  }
  setStatus(`Saved ${pending.length} scene${pending.length === 1 ? "" : "s"}`, "ok");
};

$("renderPlan").onclick = async () => {
  if (!state.project) return;
  if (state.dirtyScenes.size) {
    showError("Save your scene edits before building the render plan.");
    return;
  }

  const result = await run($("renderPlan"), "Building…", async () => {
    state.project = await api(`/api/projects/${state.project.id}/render-plan`, {
      method: "POST",
      body: "{}"
    });
  });
  if (!result.ok) return;

  renderPlanView();
  await refreshProjects().catch(() => {});
  setStatus("Saved · no credits spent", "ok");
  scrollToSection($("queueSection"));
};

$("queueList").addEventListener("click", (event) => {
  const button = event.target.closest("[data-decision]");
  if (button) decideRender(Number(button.dataset.scene), button.dataset.decision, button);
});

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

(async function boot() {
  refreshProvider();
  try {
    await refreshProjects();
    setStatus("Ready", "idle");
  } catch (error) {
    showError(`${error.message} The workspace is read-only until it reconnects.`);
    setStatus("Offline", "error");
  }
})();
