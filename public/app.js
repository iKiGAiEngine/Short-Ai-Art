let project = null;
let picked = null;

const $ = (id) => document.getElementById(id);
const escapeHtml = (value = "") => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function setStatus(message) {
  $("saveStatus").textContent = message;
}

async function refreshProvider() {
  try {
    const status = await api("/api/provider-status");
    if (status.higgsfield.installed && status.paidGenerationEnabled) {
      $("provider").textContent = "Higgsfield: connected + enabled";
    } else if (status.higgsfield.installed) {
      $("provider").textContent = "Higgsfield CLI: detected (spend locked)";
    } else {
      $("provider").textContent = "Higgsfield: not connected yet";
    }
  } catch {
    $("provider").textContent = "Provider status unavailable";
  }
}

async function refreshProjects() {
  const projects = await api("/api/projects");
  if (!projects.length) {
    $("projects").innerHTML = '<div class="muted">No projects yet.</div>';
    return;
  }
  $("projects").innerHTML = projects.slice(0, 12).map((item) => `
    <button class="project-row" data-project="${escapeHtml(item.id)}">
      <b>${escapeHtml(item.title || item.selectedConcept?.label || "Untitled short")}</b>
      <span>${escapeHtml(item.status)} · ${new Date(item.updatedAt).toLocaleDateString()}</span>
    </button>
  `).join("");
  document.querySelectorAll("[data-project]").forEach((button) => {
    button.onclick = () => loadProject(button.dataset.project);
  });
}

function renderConcepts() {
  $("conceptSection").classList.remove("hidden");
  $("selectedSection").classList.add("hidden");
  $("storySection").classList.add("hidden");
  $("queueSection").classList.add("hidden");
  picked = project.selectedConcept || null;

  const recommendedId = project.recommendation?.id;
  const recommended = project.concepts.find((item) => item.id === recommendedId) || project.concepts[0];
  $("recommendation").textContent = recommended
    ? `Recommended: ${recommended.label} · ${recommended.score || "—"}/100`
    : "Pick your favorite";

  $("concepts").innerHTML = project.concepts.map((concept) => `
    <button class="card ${picked?.id === concept.id ? "selected" : ""}" data-concept="${escapeHtml(concept.id)}">
      <div class="card-head"><span class="tag">${escapeHtml(concept.label.toUpperCase())}</span><span class="score">${escapeHtml(concept.score || "—")}</span></div>
      <h4>${escapeHtml(concept.character ? concept.character.split(" ").slice(0, 7).join(" ") : concept.label)}</h4>
      <p>${escapeHtml(concept.prompt)}</p>
      ${concept.recommendation ? `<small>${escapeHtml(concept.recommendation)}</small>` : ""}
    </button>
  `).join("");

  document.querySelectorAll("[data-concept]").forEach((button) => {
    button.onclick = () => selectConcept(button.dataset.concept, button);
  });
}

function selectConcept(id, element) {
  picked = project.concepts.find((concept) => concept.id === id);
  if (!picked) return;
  document.querySelectorAll(".card").forEach((card) => card.classList.remove("selected"));
  element.classList.add("selected");
  $("masterPrompt").value = picked.prompt;
  $("selectedSection").classList.remove("hidden");
  $("selectedSection").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function createCustom() {
  setStatus("Creating…");
  project = await api("/api/projects", {
    method: "POST",
    body: JSON.stringify({
      title: $("character").value ? `${$("character").value.split(" ").slice(0, 5).join(" ")}…` : "Custom short",
      mode: "custom",
      character: $("character").value,
      setting: $("setting").value,
      mood: $("mood").value,
      style: $("style").value,
      seconds: 30,
      aspectRatio: "9:16"
    })
  });
  renderConcepts();
  await refreshProjects();
  setStatus("Saved");
}

async function createInspiration(kind) {
  setStatus("Generating ideas…");
  project = await api("/api/projects", {
    method: "POST",
    body: JSON.stringify({
      title: kind === "person" ? "Surprise person concept" : "Surprise dog concept",
      mode: "inspiration",
      kind,
      seconds: 30,
      aspectRatio: "9:16"
    })
  });
  renderConcepts();
  await refreshProjects();
  setStatus("Saved");
}

function renderStoryboard() {
  $("storySection").classList.remove("hidden");
  $("story").innerHTML = project.storyboard.map((scene) => `
    <article class="scene" data-scene="${scene.scene}">
      <div class="scene-number">SC ${scene.scene}</div>
      <div>
        <div class="scene-title"><b>${escapeHtml(scene.name)}</b><span>${scene.duration}s</span></div>
        <p>${escapeHtml(scene.beat)}</p>
        <textarea class="scene-prompt" data-scene-prompt="${scene.scene}">${escapeHtml(scene.prompt)}</textarea>
        <button class="save-scene" data-save-scene="${scene.scene}">Save scene prompt</button>
      </div>
    </article>
  `).join("");

  document.querySelectorAll("[data-save-scene]").forEach((button) => {
    button.onclick = async () => {
      const scene = Number(button.dataset.saveScene);
      const textarea = document.querySelector(`[data-scene-prompt="${scene}"]`);
      setStatus(`Saving scene ${scene}…`);
      project = await api(`/api/projects/${project.id}/scene`, {
        method: "POST",
        body: JSON.stringify({ scene, prompt: textarea.value })
      });
      setStatus("Saved");
    };
  });
}

function renderPlan() {
  $("queueSection").classList.remove("hidden");
  $("renderStages").innerHTML = project.renderPlan.stages.map((stage, index) => `
    <div class="stage"><span>${index + 1}</span><div><b>${escapeHtml(stage.label)}</b><p>${escapeHtml(stage.purpose)}</p></div><small>${stage.count} output${stage.count === 1 ? "" : "s"}</small></div>
  `).join("");
  $("queueList").innerHTML = project.renders.map((render) => `
    <div class="queue-row"><b>SC ${render.scene}</b><span>${escapeHtml(render.status)}</span><span>Retries: ${render.attempts}/${project.costGuardrails.maxRetriesPerShot}</span></div>
  `).join("");
  $("queueSection").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function loadProject(id) {
  project = await api(`/api/projects/${id}`);
  picked = project.selectedConcept;
  renderConcepts();
  if (picked) {
    $("masterPrompt").value = picked.prompt;
    $("selectedSection").classList.remove("hidden");
  }
  if (project.storyboard?.length) renderStoryboard();
  if (project.renderPlan) renderPlan();
}

$("custom").onclick = () => createCustom().catch((error) => alert(error.message));
$("trendDog").onclick = () => createInspiration("dog").catch((error) => alert(error.message));
$("trendPerson").onclick = () => createInspiration("person").catch((error) => alert(error.message));

$("lock").onclick = async () => {
  if (!project || !picked) return;
  setStatus("Building storyboard…");
  project = await api(`/api/projects/${project.id}/select`, {
    method: "POST",
    body: JSON.stringify({ conceptId: picked.id, prompt: $("masterPrompt").value })
  });
  project = await api(`/api/projects/${project.id}/storyboard`, {
    method: "POST",
    body: JSON.stringify({ seconds: 30 })
  });
  renderStoryboard();
  await refreshProjects();
  setStatus("Saved");
  $("storySection").scrollIntoView({ behavior: "smooth", block: "start" });
};

$("renderPlan").onclick = async () => {
  setStatus("Building render plan…");
  project = await api(`/api/projects/${project.id}/render-plan`, { method: "POST", body: "{}" });
  renderPlan();
  await refreshProjects();
  setStatus("Saved · no credits spent");
};

document.querySelectorAll("[data-edit]").forEach((button) => {
  button.onclick = () => {
    const additions = {
      "more-vibrant": " Increase luminous color depth, richer atmospheric light and premium saturated color while preserving natural highlight detail.",
      "more-scenic": " Increase the apparent scale, depth and extravagance of the environment while keeping the main character immediately readable.",
      "more-emotional": " Increase expressive eye contact, warmth and emotional storytelling without becoming sentimental or static.",
      "more-motion": " Increase directional motion cues, dynamic pose, foreground parallax and cinematic camera energy while preserving anatomy and identity."
    };
    $("masterPrompt").value = `${$("masterPrompt").value.trim()}${additions[button.dataset.edit] || ""}`;
  };
});

Promise.all([refreshProvider(), refreshProjects()]).catch(() => {});
