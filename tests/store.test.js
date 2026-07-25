import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "short-ai-art-store-"));
process.env.PROJECT_DATA_DIR = path.join(sandbox, "projects");

const {
  createProject,
  deleteProject,
  getProject,
  isProjectId,
  listProjects,
  normalizeProjectInput,
  saveProject,
  summarizeProject
} = await import("../src/store.js");

test.after(() => fs.rm(sandbox, { recursive: true, force: true }));

test("a created project round-trips through disk", async () => {
  const created = await createProject({ character: "a corgi", setting: "Tokyo", concepts: [{ id: "concept-1" }] });
  assert.ok(isProjectId(created.id));
  assert.equal(created.status, "concepting");

  const loaded = await getProject(created.id);
  assert.equal(loaded.id, created.id);
  assert.equal(loaded.character, "a corgi");
  assert.deepEqual(loaded.concepts, [{ id: "concept-1" }]);
});

test("client-supplied fields cannot escape the data directory or forge state", async () => {
  const created = await createProject({
    id: "../pwned",
    createdAt: "1999-01-01T00:00:00.000Z",
    status: "shipped",
    costGuardrails: { maxRetriesPerShot: 999999 },
    character: "a corgi"
  });

  assert.ok(isProjectId(created.id), "id must always be a server-generated UUID");
  assert.notEqual(created.id, "../pwned");
  assert.equal(created.status, "concepting", "status is server-owned");
  assert.notEqual(created.createdAt, "1999-01-01T00:00:00.000Z");

  const escaped = path.join(sandbox, "pwned.json");
  assert.equal(await fs.access(escaped).then(() => true).catch(() => false), false,
    "no file may be written outside the project data directory");
});

test("saveProject refuses ids that are not UUIDs", async () => {
  await assert.rejects(() => saveProject({ id: "../../etc/passwd" }), /invalid id/i);
  await assert.rejects(() => saveProject({ id: "" }), /invalid id/i);
  await assert.rejects(() => saveProject(null), /invalid id/i);
});

test("getProject rejects traversal-shaped ids without touching disk", async () => {
  assert.equal(await getProject("../../etc/passwd"), null);
  assert.equal(await getProject("not-a-uuid"), null);
  assert.equal(await getProject(""), null);
  assert.equal(await getProject(undefined), null);
});

test("input normalization clamps, trims and constrains enumerated fields", () => {
  const safe = normalizeProjectInput({
    title: "  Trip  ",
    mode: "nonsense",
    kind: "dragon",
    character: " a corgi ",
    seconds: 900,
    aspectRatio: "42:1"
  });
  assert.equal(safe.title, "Trip");
  assert.equal(safe.mode, "custom");
  assert.equal(safe.kind, "dog");
  assert.equal(safe.character, "a corgi");
  assert.equal(safe.seconds, 60);
  assert.equal(safe.aspectRatio, "9:16");
  assert.equal(normalizeProjectInput({ character: 42 }).character, "", "non-strings become empty, never coerced");
});

test("oversized text fields are truncated rather than stored whole", () => {
  const safe = normalizeProjectInput({ character: "x".repeat(50_000), title: "y".repeat(500) });
  assert.equal(safe.character.length, 2000);
  assert.equal(safe.title.length, 120);
});

test("projects list newest first and deleted projects disappear", async () => {
  const first = await createProject({ character: "first corgi" });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = await createProject({ character: "second corgi" });

  const ids = (await listProjects()).map((project) => project.id);
  assert.ok(ids.indexOf(second.id) < ids.indexOf(first.id), "most recently updated project sorts first");

  assert.equal(await deleteProject(second.id), true);
  assert.equal(await getProject(second.id), null);
  assert.equal(await deleteProject(second.id), false, "deleting twice is not an error");
  assert.equal(await deleteProject("../../etc/passwd"), false);
});

test("corrupt project files are skipped instead of crashing the library", async () => {
  await fs.writeFile(path.join(process.env.PROJECT_DATA_DIR, "broken.json"), "{ not json");
  const projects = await listProjects();
  assert.ok(Array.isArray(projects));
  assert.ok(projects.every((project) => isProjectId(project.id)));
  await fs.rm(path.join(process.env.PROJECT_DATA_DIR, "broken.json"), { force: true });
});

test("summaries expose only what the sidebar needs", async () => {
  const project = await createProject({ character: "a corgi" });
  project.storyboard = [{ scene: 1 }, { scene: 2 }];
  project.renders = [{ approved: true }, { approved: false }];

  const summary = summarizeProject(project);
  assert.deepEqual(Object.keys(summary).sort(), ["approved", "id", "mode", "scenes", "status", "title", "updatedAt"]);
  assert.equal(summary.scenes, 2);
  assert.equal(summary.approved, 1);
  assert.equal(summary.concepts, undefined, "full concept payloads never reach the list endpoint");
});
