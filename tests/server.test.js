import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "short-ai-art-server-"));
process.env.PROJECT_DATA_DIR = path.join(sandbox, "projects");
process.env.MAX_RETRIES_PER_SHOT = "2";
delete process.env.HIGGSFIELD_ENABLED;

const { createServer } = await import("../src/api.js");

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(sandbox, { recursive: true, force: true });
});

async function call(method, route, body) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data, headers: response.headers };
}

const newProject = (overrides = {}) => call("POST", "/api/projects", {
  character: "a corgi in a red bandana",
  setting: "a tropical coast",
  mood: "joyful",
  ...overrides
});

/* -- health, static, headers ------------------------------------- */

test("health endpoint reports the service", async () => {
  const { status, data } = await call("GET", "/api/health");
  assert.equal(status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.service, "short-ai-art");
});

test("the dashboard and its assets are served with hardening headers", async () => {
  for (const [route, type] of [["/", "text/html"], ["/app.js", "text/javascript"], ["/styles.css", "text/css"]]) {
    const response = await fetch(`${base}${route}`);
    assert.equal(response.status, 200, `${route} should be served`);
    assert.ok(response.headers.get("content-type").startsWith(type), `${route} content-type`);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  }
  const page = await fetch(`${base}/`);
  assert.match(page.headers.get("content-security-policy"), /default-src 'self'/);
});

test("static serving refuses to escape the public directory", async () => {
  for (const attempt of [
    "/../package.json",
    "/../../etc/passwd",
    "/..%2f..%2fpackage.json",
    "/%2e%2e/package.json",
    "/./../../package.json",
    "//etc/passwd",
    "/../src/store.js"
  ]) {
    const response = await fetch(`${base}${attempt}`);
    const body = await response.text();
    assert.equal(response.status, 404, `${attempt} must not resolve to a file`);
    assert.ok(!body.includes("dataRoot"), `${attempt} must not leak source files`);
    assert.ok(!body.includes("\"private\": true"), `${attempt} must not leak repository files`);
  }
});

test("unknown routes and methods are rejected cleanly", async () => {
  assert.equal((await call("GET", "/api/nope")).status, 404);
  assert.equal((await call("DELETE", "/api/projects")).status, 405);
  assert.equal((await call("GET", "/api/projects/00000000-0000-4000-8000-000000000000")).status, 404);
});

test("malformed request bodies produce 400s, not 500s", async () => {
  const response = await fetch(`${base}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{ not json"
  });
  assert.equal(response.status, 400);

  const array = await fetch(`${base}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "[1,2,3]"
  });
  assert.equal(array.status, 400);
});

/* -- project creation --------------------------------------------- */

test("creating a custom project returns six concepts and a recommendation", async () => {
  const { status, data } = await newProject();
  assert.equal(status, 201);
  assert.equal(data.concepts.length, 6);
  assert.ok(data.recommendation.id);
  assert.equal(data.status, "concepting");
  assert.equal(data.aspectRatio, "9:16");
  assert.deepEqual([data.selectedConcept, data.renderPlan], [null, null]);
});

test("an empty custom brief is rejected before a project is stored", async () => {
  const before = (await call("GET", "/api/projects")).data.length;
  const { status, data } = await call("POST", "/api/projects", { mode: "custom" });
  assert.equal(status, 400);
  assert.match(data.error, /character or a setting/i);
  assert.equal((await call("GET", "/api/projects")).data.length, before, "no project should be created");
});

test("inspiration mode needs no brief", async () => {
  const { status, data } = await call("POST", "/api/projects", { mode: "inspiration", kind: "person" });
  assert.equal(status, 201);
  assert.equal(data.concepts.length, 6);
  assert.ok(data.concepts.every((concept) => concept.character));
});

test("a client cannot inject an id, status or forged timestamps", async () => {
  const { data } = await newProject({ id: "../pwned", status: "shipped", createdAt: "1999-01-01T00:00:00.000Z" });
  assert.match(data.id, /^[0-9a-f-]{36}$/i);
  assert.equal(data.status, "concepting");
  assert.notEqual(data.createdAt, "1999-01-01T00:00:00.000Z");
  assert.equal(await fs.access(path.join(sandbox, "pwned.json")).then(() => true).catch(() => false), false);
});

test("the project list returns compact summaries only", async () => {
  const { status, data } = await call("GET", "/api/projects");
  assert.equal(status, 200);
  assert.ok(data.length > 0);
  assert.ok(data.every((item) => item.concepts === undefined && item.storyboard === undefined));
  assert.ok(data.every((item) => item.id && item.title && item.status));
});

/* -- full workflow ------------------------------------------------ */

test("an operator can walk idea → concepts → storyboard → plan → approvals", async () => {
  const { data: project } = await newProject();
  const chosen = project.concepts[1];

  const selected = await call("POST", `/api/projects/${project.id}/select`, {
    conceptId: chosen.id,
    prompt: `${chosen.prompt} Extra art direction.`
  });
  assert.equal(selected.status, 200);
  assert.equal(selected.data.status, "selected");
  assert.match(selected.data.selectedConcept.prompt, /Extra art direction\.$/);

  const storyboard = await call("POST", `/api/projects/${project.id}/storyboard`, { seconds: 30 });
  assert.equal(storyboard.status, 200);
  assert.equal(storyboard.data.storyboard.length, 6);
  assert.equal(storyboard.data.storyboard.reduce((sum, scene) => sum + scene.duration, 0), 30);

  const edited = await call("POST", `/api/projects/${project.id}/scene`, { scene: 2, prompt: "  A rewritten scene two.  " });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.storyboard[1].prompt, "A rewritten scene two.");

  const plan = await call("POST", `/api/projects/${project.id}/render-plan`, {});
  assert.equal(plan.status, 200);
  assert.equal(plan.data.renderPlan.mode, "approval-gated");
  assert.equal(plan.data.renders.length, 6);
  assert.equal(plan.data.status, "ready-for-keyframes");
  assert.ok(plan.data.renders.every((render) => render.approved === false && render.cost === null));
  assert.equal(plan.data.renders[1].prompt, "A rewritten scene two.", "the plan uses the edited prompt");

  // Approve every shot; the project only becomes video-ready on the last one.
  for (const render of plan.data.renders) {
    const approved = await call("POST", `/api/projects/${project.id}/render`, {
      scene: render.scene,
      decision: "approve",
      output: `https://example.invalid/still-${render.scene}.png`
    });
    assert.equal(approved.status, 200);
    const expected = render.scene === 6 ? "keyframes-approved" : "keyframes-in-review";
    assert.equal(approved.data.status, expected);
  }

  const final = await call("GET", `/api/projects/${project.id}`);
  assert.ok(final.data.renders.every((render) => render.approved && render.output));
});

test("workflow steps refuse to run out of order", async () => {
  const { data: project } = await newProject();

  const early = await call("POST", `/api/projects/${project.id}/storyboard`, {});
  assert.equal(early.status, 400);
  assert.match(early.data.error, /Lock a concept/i);

  const noPlan = await call("POST", `/api/projects/${project.id}/render-plan`, {});
  assert.equal(noPlan.status, 400);
  assert.match(noPlan.data.error, /storyboard/i);

  const noRenders = await call("POST", `/api/projects/${project.id}/render`, { scene: 1, decision: "approve" });
  assert.equal(noRenders.status, 400);
  assert.match(noRenders.data.error, /render plan/i);

  const badConcept = await call("POST", `/api/projects/${project.id}/select`, { conceptId: "concept-from-another-project" });
  assert.equal(badConcept.status, 400);
});

test("rebuilding a storyboard invalidates the plan built from the old scenes", async () => {
  const { data: project } = await newProject();
  await call("POST", `/api/projects/${project.id}/select`, { conceptId: project.concepts[0].id });
  await call("POST", `/api/projects/${project.id}/storyboard`, {});
  await call("POST", `/api/projects/${project.id}/render-plan`, {});

  const rebuilt = await call("POST", `/api/projects/${project.id}/storyboard`, { seconds: 45 });
  assert.equal(rebuilt.data.renderPlan, null, "a stale plan must not survive a storyboard rebuild");
  assert.deepEqual(rebuilt.data.renders, []);
});

test("empty prompts are rejected at every editable surface", async () => {
  const { data: project } = await newProject();
  const select = await call("POST", `/api/projects/${project.id}/select`, {
    conceptId: project.concepts[0].id,
    prompt: "   "
  });
  assert.equal(select.status, 400);

  await call("POST", `/api/projects/${project.id}/select`, { conceptId: project.concepts[0].id });
  await call("POST", `/api/projects/${project.id}/storyboard`, {});
  const scene = await call("POST", `/api/projects/${project.id}/scene`, { scene: 1, prompt: "   " });
  assert.equal(scene.status, 400);

  const missingScene = await call("POST", `/api/projects/${project.id}/scene`, { scene: 99, prompt: "x" });
  assert.equal(missingScene.status, 400);
});

/* -- spend guardrails --------------------------------------------- */

test("approval requires an attached keyframe reference", async () => {
  const { data: project } = await newProject();
  await call("POST", `/api/projects/${project.id}/select`, { conceptId: project.concepts[0].id });
  await call("POST", `/api/projects/${project.id}/storyboard`, {});
  await call("POST", `/api/projects/${project.id}/render-plan`, {});

  const blank = await call("POST", `/api/projects/${project.id}/render`, { scene: 1, decision: "approve", output: "  " });
  assert.equal(blank.status, 400);
  assert.match(blank.data.error, /keyframe reference/i);

  const ok = await call("POST", `/api/projects/${project.id}/render`, {
    scene: 1,
    decision: "approve",
    output: "https://example.invalid/still.png"
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.renders[0].approved, true);
});

test("the retry budget is enforced by the server, not just the UI", async () => {
  const { data: project } = await newProject();
  await call("POST", `/api/projects/${project.id}/select`, { conceptId: project.concepts[0].id });
  await call("POST", `/api/projects/${project.id}/storyboard`, {});
  await call("POST", `/api/projects/${project.id}/render-plan`, {});

  let latest;
  for (let i = 0; i < 8; i += 1) {
    latest = await call("POST", `/api/projects/${project.id}/render`, { scene: 1, decision: "rework" });
    assert.equal(latest.status, 200);
  }
  assert.equal(latest.data.renders[0].attempts, 2, "server must cap attempts at the configured budget");
  assert.equal(latest.data.renders[0].status, "blocked-retry-limit");

  const reset = await call("POST", `/api/projects/${project.id}/render`, { scene: 1, decision: "reset" });
  assert.equal(reset.data.renders[0].attempts, 0);
  assert.equal(reset.data.renders[0].status, "awaiting-keyframe");
});

test("unknown render decisions are rejected", async () => {
  const { data: project } = await newProject();
  await call("POST", `/api/projects/${project.id}/select`, { conceptId: project.concepts[0].id });
  await call("POST", `/api/projects/${project.id}/storyboard`, {});
  await call("POST", `/api/projects/${project.id}/render-plan`, {});

  const bad = await call("POST", `/api/projects/${project.id}/render`, { scene: 1, decision: "spend-everything" });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /approve, rework, reset/);
});

test("provider status never reports paid generation as enabled by default", async () => {
  const { status, data } = await call("GET", "/api/provider-status");
  assert.equal(status, 200);
  assert.equal(data.paidGenerationEnabled, false);
  assert.equal(typeof data.higgsfield.installed, "boolean");
});

/* -- deletion ------------------------------------------------------ */

test("projects can be deleted and stop appearing in the library", async () => {
  const { data: project } = await newProject();
  const deleted = await call("DELETE", `/api/projects/${project.id}`);
  assert.equal(deleted.status, 200);
  assert.equal(deleted.data.deleted, true);

  assert.equal((await call("GET", `/api/projects/${project.id}`)).status, 404);
  const list = (await call("GET", "/api/projects")).data;
  assert.ok(!list.some((item) => item.id === project.id));
});
