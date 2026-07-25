import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { ASPECT_RATIOS, clampSeconds } from "./concepts.js";

const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Resolved per call so tests (and future multi-tenant runs) can point PROJECT_DATA_DIR
// somewhere else without having to re-import the module.
export function dataRoot() {
  return path.resolve(process.env.PROJECT_DATA_DIR || "data/projects");
}

export function isProjectId(id) {
  return typeof id === "string" && PROJECT_ID.test(id);
}

function text(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function guardrails(input = {}) {
  return {
    maxProjectCredits: Number(process.env.MAX_PROJECT_CREDITS || 150),
    maxRetriesPerShot: Number(process.env.MAX_RETRIES_PER_SHOT || 2),
    requireApprovalBeforeVideo: true,
    ...(input && typeof input === "object" ? input : {})
  };
}

/**
 * Whitelist of operator-supplied fields. Request bodies are never spread into a
 * stored project: doing so previously let a client overwrite `id` and escape the
 * data directory when the file path was built.
 */
export function normalizeProjectInput(input = {}) {
  return {
    title: text(input.title, 120),
    mode: input.mode === "inspiration" ? "inspiration" : "custom",
    kind: input.kind === "person" ? "person" : "dog",
    character: text(input.character, 2000),
    setting: text(input.setting, 2000),
    mood: text(input.mood, 2000),
    style: text(input.style, 2000),
    seconds: clampSeconds(input.seconds),
    aspectRatio: ASPECT_RATIOS.has(input.aspectRatio) ? input.aspectRatio : "9:16"
  };
}

function defaultTitle(safe) {
  if (safe.title) return safe.title;
  if (safe.character) return `${safe.character.split(/\s+/).slice(0, 5).join(" ")}…`;
  if (safe.mode === "inspiration") return safe.kind === "person" ? "Surprise person concept" : "Surprise dog concept";
  return "Untitled short";
}

export async function ensureStore() {
  await fs.mkdir(dataRoot(), { recursive: true });
}

export async function createProject(input = {}) {
  await ensureStore();
  const now = new Date().toISOString();
  const safe = normalizeProjectInput(input);
  return saveProject({
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    status: "concepting",
    ...safe,
    title: defaultTitle(safe),
    concepts: Array.isArray(input.concepts) ? input.concepts : [],
    recommendation: input.recommendation ?? null,
    selectedConcept: null,
    storyboard: [],
    renderPlan: null,
    renders: [],
    notes: [],
    costGuardrails: guardrails(input.costGuardrails)
  });
}

export async function saveProject(project) {
  if (!project || !isProjectId(project.id)) {
    throw new Error("Refusing to persist a project with an invalid id.");
  }
  await ensureStore();
  project.updatedAt = new Date().toISOString();
  const destination = path.join(dataRoot(), `${project.id}.json`);
  const temp = `${destination}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(project, null, 2));
    await fs.rename(temp, destination);
  } catch (error) {
    await fs.rm(temp, { force: true });
    throw error;
  }
  return project;
}

export async function getProject(id) {
  if (!isProjectId(id)) return null;
  try {
    return JSON.parse(await fs.readFile(path.join(dataRoot(), `${id}.json`), "utf8"));
  } catch {
    return null;
  }
}

export async function deleteProject(id) {
  if (!isProjectId(id)) return false;
  try {
    await fs.unlink(path.join(dataRoot(), `${id}.json`));
    return true;
  } catch {
    return false;
  }
}

export async function listProjects() {
  await ensureStore();
  const names = (await fs.readdir(dataRoot())).filter((name) => name.endsWith(".json"));
  const projects = [];
  for (const name of names) {
    try {
      projects.push(JSON.parse(await fs.readFile(path.join(dataRoot(), name), "utf8")));
    } catch {
      // Ignore partial/corrupt local files instead of crashing the operator dashboard.
    }
  }
  return projects.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

/** Compact shape for the sidebar so the list endpoint never ships whole projects. */
export function summarizeProject(project) {
  const renders = Array.isArray(project.renders) ? project.renders : [];
  return {
    id: project.id,
    title: project.title || project.selectedConcept?.label || "Untitled short",
    status: project.status || "concepting",
    mode: project.mode || "custom",
    updatedAt: project.updatedAt,
    scenes: Array.isArray(project.storyboard) ? project.storyboard.length : 0,
    approved: renders.filter((render) => render?.approved).length
  };
}
