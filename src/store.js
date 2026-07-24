import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const root = path.resolve(process.env.PROJECT_DATA_DIR || "data/projects");

export async function ensureStore() {
  await fs.mkdir(root, { recursive: true });
}

export async function createProject(input) {
  await ensureStore();
  const now = new Date().toISOString();
  const project = {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    status: "concepting",
    title: input.title || "Untitled short",
    ...input,
    selectedConcept: null,
    storyboard: [],
    renderPlan: null,
    renders: [],
    notes: [],
    costGuardrails: {
      maxProjectCredits: Number(process.env.MAX_PROJECT_CREDITS || 150),
      maxRetriesPerShot: Number(process.env.MAX_RETRIES_PER_SHOT || 2),
      requireApprovalBeforeVideo: true,
      ...(input.costGuardrails || {})
    }
  };
  return saveProject(project);
}

export async function saveProject(project) {
  await ensureStore();
  project.updatedAt = new Date().toISOString();
  const destination = path.join(root, `${project.id}.json`);
  const temp = `${destination}.tmp`;
  await fs.writeFile(temp, JSON.stringify(project, null, 2));
  await fs.rename(temp, destination);
  return project;
}

export async function getProject(id) {
  if (!/^[a-f0-9-]{16,}$/i.test(id)) return null;
  try {
    return JSON.parse(await fs.readFile(path.join(root, `${id}.json`), "utf8"));
  } catch {
    return null;
  }
}

export async function listProjects() {
  await ensureStore();
  const names = (await fs.readdir(root)).filter((name) => name.endsWith(".json"));
  const projects = [];
  for (const name of names) {
    try {
      projects.push(JSON.parse(await fs.readFile(path.join(root, name), "utf8")));
    } catch {
      // Ignore partial/corrupt local files instead of crashing the operator dashboard.
    }
  }
  return projects.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
