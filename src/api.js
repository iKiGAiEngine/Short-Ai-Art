import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyRenderDecision,
  buildRenderPlan,
  createRenders,
  inspirationIdeas,
  makeStoryboard,
  recommendConcept,
  renderSummary,
  strategicVariations,
  RENDER_DECISIONS
} from "./concepts.js";
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  normalizeProjectInput,
  saveProject,
  summarizeProject
} from "./store.js";
import { higgsfieldStatus, inspectHiggsfieldModels } from "../providers/higgsfield.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../public");
const MAX_BODY_BYTES = 1_000_000;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8"
};

// The app loads no third-party code and uses no inline script/style, so it can run
// under a strict policy. Keep it that way when adding assets.
const CSP = "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'";

const BASE_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer"
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(res, status, payload) {
  res.writeHead(status, {
    ...BASE_HEADERS,
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

async function parseBody(req) {
  let raw = "";
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) throw new HttpError(413, "Request body too large");
    raw += chunk;
  }
  if (!raw.trim()) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "Request body must be a JSON object");
  }
  return parsed;
}

async function serveStatic(req, res, pathname) {
  let requested;
  try {
    requested = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  } catch {
    return false;
  }
  const filePath = path.resolve(publicDir, requested);
  const relative = path.relative(publicDir, filePath);
  // Containment check: anything that climbs out of publicDir or resolves to a
  // sibling directory produces a relative path starting with ".." or an absolute one.
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return false;

  let content;
  try {
    content = await fs.readFile(filePath);
  } catch {
    return false;
  }
  const ext = path.extname(filePath).toLowerCase();
  const headers = {
    ...BASE_HEADERS,
    "content-type": TYPES[ext] || "application/octet-stream",
    // Operators iterate on this tool constantly; never let them debug a stale bundle.
    "cache-control": "no-cache",
    "content-length": String(content.length)
  };
  if (ext === ".html") headers["content-security-policy"] = CSP;
  res.writeHead(200, headers);
  res.end(req.method === "HEAD" ? undefined : content);
  return true;
}

function routeProject(pathname) {
  return pathname.match(/^\/api\/projects\/([^/]+)(?:\/(select|storyboard|scene|render-plan|render))?$/);
}

function statusForRenders(project) {
  const summary = renderSummary(project.renders);
  if (summary.readyForVideo) return "keyframes-approved";
  if (summary.approved > 0) return "keyframes-in-review";
  return "ready-for-keyframes";
}

async function handleProjectRoute(req, res, match) {
  const [, id, action] = match;
  const project = await getProject(id);
  if (!project) throw new HttpError(404, "Project not found");

  if (!action) {
    if (req.method === "GET") return json(res, 200, project);
    if (req.method === "DELETE") {
      await deleteProject(id);
      return json(res, 200, { deleted: true, id });
    }
    throw new HttpError(405, "Method not allowed");
  }

  if (req.method !== "POST") throw new HttpError(405, "Method not allowed");
  const input = await parseBody(req);

  if (action === "select") {
    const selected = project.concepts.find((concept) => concept.id === input.conceptId);
    if (!selected) throw new HttpError(400, "Select one of this project's concepts before continuing.");
    const prompt = String(input.prompt ?? selected.prompt).trim();
    if (!prompt) throw new HttpError(400, "The master prompt cannot be empty.");
    project.selectedConcept = { ...selected, prompt };
    project.status = "selected";
    return json(res, 200, await saveProject(project));
  }

  if (action === "storyboard") {
    if (!project.selectedConcept) throw new HttpError(400, "Lock a concept before building a storyboard.");
    project.storyboard = makeStoryboard(project.selectedConcept, input.seconds ?? project.seconds ?? 30);
    project.status = "storyboard";
    // A storyboard change invalidates any plan built from the previous scenes.
    project.renderPlan = null;
    project.renders = [];
    return json(res, 200, await saveProject(project));
  }

  if (action === "scene") {
    const sceneNumber = Number(input.scene);
    const scene = project.storyboard?.find((item) => item.scene === sceneNumber);
    if (!scene) throw new HttpError(400, "Invalid storyboard scene");
    if (typeof input.prompt === "string") {
      const prompt = input.prompt.trim();
      if (!prompt) throw new HttpError(400, "A scene prompt cannot be empty.");
      scene.prompt = prompt;
    }
    if (typeof input.beat === "string") scene.beat = input.beat.trim();
    if (typeof input.camera === "string") scene.camera = input.camera.trim();
    // Keep any already-planned shot in sync with the prompt the operator just edited.
    const pending = project.renders?.find((render) => render.scene === sceneNumber);
    if (pending && !pending.approved) pending.prompt = scene.prompt;
    project.status = "storyboard-edited";
    return json(res, 200, await saveProject(project));
  }

  if (action === "render-plan") {
    if (!project.storyboard?.length) throw new HttpError(400, "Build a storyboard before creating a render plan.");
    project.renderPlan = buildRenderPlan(project);
    project.renders = createRenders(project.storyboard);
    project.status = "ready-for-keyframes";
    return json(res, 200, await saveProject(project));
  }

  if (action === "render") {
    if (!project.renders?.length) throw new HttpError(400, "Build a render plan before reviewing shots.");
    const sceneNumber = Number(input.scene);
    const index = project.renders.findIndex((render) => render.scene === sceneNumber);
    if (index === -1) throw new HttpError(400, "Invalid render scene");
    if (!RENDER_DECISIONS.has(input.decision)) {
      throw new HttpError(400, `Decision must be one of: ${[...RENDER_DECISIONS].join(", ")}`);
    }
    const updated = applyRenderDecision(
      project.renders[index],
      input.decision,
      project.costGuardrails?.maxRetriesPerShot ?? 2
    );
    if (typeof input.output === "string") {
      updated.output = input.output.trim().slice(0, 1000) || null;
    }
    if (input.decision === "approve" && !updated.output) {
      throw new HttpError(400, "Attach the approved keyframe reference before approving this shot.");
    }
    project.renders[index] = updated;
    project.status = statusForRenders(project);
    return json(res, 200, await saveProject(project));
  }

  throw new HttpError(404, "Not found");
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const { pathname } = url;

  if (pathname === "/api/health") {
    if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "Method not allowed");
    return json(res, 200, { ok: true, service: "short-ai-art", version: "0.3.0" });
  }

  if (pathname === "/api/provider-status" && req.method === "GET") {
    return json(res, 200, {
      higgsfield: await higgsfieldStatus(),
      paidGenerationEnabled: process.env.HIGGSFIELD_ENABLED === "true"
    });
  }

  if (pathname === "/api/higgsfield/models" && req.method === "GET") {
    return json(res, 200, await inspectHiggsfieldModels());
  }

  if (pathname === "/api/projects") {
    if (req.method === "GET") {
      return json(res, 200, (await listProjects()).map(summarizeProject));
    }
    if (req.method === "POST") {
      const input = await parseBody(req);
      const safe = normalizeProjectInput(input);
      if (safe.mode === "custom" && !safe.character && !safe.setting) {
        throw new HttpError(400, "Describe at least a character or a setting to generate concepts.");
      }
      const concepts = safe.mode === "inspiration" ? inspirationIdeas(safe.kind) : strategicVariations(safe);
      const recommendation = recommendConcept(concepts);
      const project = await createProject({
        ...safe,
        concepts,
        recommendation: recommendation
          ? { id: recommendation.id, label: recommendation.label, score: recommendation.score }
          : null
      });
      return json(res, 201, project);
    }
    throw new HttpError(405, "Method not allowed");
  }

  if (pathname === "/api/inspiration" && req.method === "POST") {
    const input = await parseBody(req);
    return json(res, 200, inspirationIdeas(input.kind === "person" ? "person" : "dog"));
  }

  const match = routeProject(pathname);
  if (match) return handleProjectRoute(req, res, match);

  if ((req.method === "GET" || req.method === "HEAD") && (await serveStatic(req, res, pathname))) return;
  throw new HttpError(404, "Not found");
}

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      await handle(req, res);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status >= 500) console.error(error);
      if (res.headersSent) return res.end();
      json(res, status, { error: status >= 500 ? "Unexpected server error" : error.message });
    }
  });
}
