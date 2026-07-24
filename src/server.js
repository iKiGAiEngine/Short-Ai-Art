import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildRenderPlan,
  inspirationIdeas,
  makeStoryboard,
  recommendConcept,
  strategicVariations
} from "./concepts.js";
import { createProject, getProject, listProjects, saveProject } from "./store.js";
import { higgsfieldStatus, inspectHiggsfieldModels } from "../providers/higgsfield.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../public");
const port = Number(process.env.PORT || 4173);

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml"
};

function json(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

async function parseBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 2_000_000) throw new Error("Request body too large");
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON body");
  }
}

async function serveStatic(res, pathname) {
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  const normalized = path.normalize(requested).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = path.join(publicDir, normalized);
  if (!filePath.startsWith(publicDir)) return false;
  try {
    const content = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { "content-type": types[ext] || "application/octet-stream" });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

function routeProject(pathname) {
  return pathname.match(/^\/api\/projects\/([^/]+)(?:\/(select|storyboard|scene|render-plan))?$/);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      return json(res, 200, { ok: true, service: "short-ai-art", version: "0.2.0" });
    }

    if (req.method === "GET" && url.pathname === "/api/provider-status") {
      return json(res, 200, { higgsfield: await higgsfieldStatus(), paidGenerationEnabled: process.env.HIGGSFIELD_ENABLED === "true" });
    }

    if (req.method === "GET" && url.pathname === "/api/higgsfield/models") {
      return json(res, 200, await inspectHiggsfieldModels());
    }

    if (req.method === "GET" && url.pathname === "/api/projects") {
      return json(res, 200, await listProjects());
    }

    if (req.method === "POST" && url.pathname === "/api/inspiration") {
      const input = await parseBody(req);
      const kind = input.kind === "person" ? "person" : "dog";
      return json(res, 200, inspirationIdeas(kind));
    }

    if (req.method === "POST" && url.pathname === "/api/projects") {
      const input = await parseBody(req);
      const mode = input.mode === "inspiration" ? "inspiration" : "custom";
      const concepts = mode === "inspiration"
        ? inspirationIdeas(input.kind === "person" ? "person" : "dog")
        : strategicVariations(input);
      const recommendation = recommendConcept(concepts);
      const project = await createProject({
        ...input,
        mode,
        seconds: Number(input.seconds || 30),
        aspectRatio: input.aspectRatio || "9:16",
        concepts,
        recommendation: recommendation ? { id: recommendation.id, label: recommendation.label, score: recommendation.score } : null
      });
      return json(res, 201, project);
    }

    const match = routeProject(url.pathname);
    if (match) {
      const [, id, action] = match;
      const project = await getProject(id);
      if (!project) return json(res, 404, { error: "Project not found" });

      if (req.method === "GET" && !action) return json(res, 200, project);
      const input = await parseBody(req);

      if (req.method === "POST" && action === "select") {
        const selected = project.concepts.find((concept) => concept.id === input.conceptId);
        if (!selected) return json(res, 400, { error: "Invalid concept" });
        project.selectedConcept = {
          ...selected,
          prompt: String(input.prompt || selected.prompt).trim()
        };
        project.status = "selected";
        return json(res, 200, await saveProject(project));
      }

      if (req.method === "POST" && action === "storyboard") {
        if (!project.selectedConcept) return json(res, 400, { error: "Select a concept first" });
        project.storyboard = makeStoryboard(project.selectedConcept, input.seconds || project.seconds || 30);
        project.status = "storyboard";
        return json(res, 200, await saveProject(project));
      }

      if (req.method === "POST" && action === "scene") {
        const sceneNumber = Number(input.scene);
        const scene = project.storyboard.find((item) => item.scene === sceneNumber);
        if (!scene) return json(res, 400, { error: "Invalid storyboard scene" });
        if (typeof input.prompt === "string") scene.prompt = input.prompt.trim();
        if (typeof input.beat === "string") scene.beat = input.beat.trim();
        if (typeof input.camera === "string") scene.camera = input.camera.trim();
        project.status = "storyboard-edited";
        return json(res, 200, await saveProject(project));
      }

      if (req.method === "POST" && action === "render-plan") {
        project.renderPlan = buildRenderPlan(project);
        project.renders = project.storyboard.map((scene) => ({
          scene: scene.scene,
          status: "awaiting-keyframe",
          provider: "higgsfield",
          prompt: scene.prompt,
          attempts: 0,
          approved: false,
          cost: null,
          jobId: null,
          output: null
        }));
        project.status = "ready-for-keyframes";
        return json(res, 200, await saveProject(project));
      }
    }

    if (req.method === "GET" && await serveStatic(res, url.pathname)) return;
    return json(res, 404, { error: "Not found" });
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: error.message || "Unexpected server error" });
  }
});

server.listen(port, () => {
  console.log(`Short AI Art running at http://localhost:${port}`);
});
