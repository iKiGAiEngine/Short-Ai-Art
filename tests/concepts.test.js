import test from "node:test";
import assert from "node:assert/strict";
import {
  applyRenderDecision,
  buildRenderPlan,
  clampSeconds,
  createRenders,
  inspirationIdeas,
  makeStoryboard,
  recommendConcept,
  renderSummary,
  strategicVariations
} from "../src/concepts.js";

test("custom input always creates six strategic concepts", () => {
  const concepts = strategicVariations({ character: "a corgi", setting: "Tokyo at night", mood: "joyful" });
  assert.equal(concepts.length, 6);
  assert.deepEqual(concepts.map((item) => item.label), ["Literal", "Cinematic", "Scenic", "Action", "Emotional", "Wildcard"]);
  assert.ok(concepts.every((item) => item.prompt.includes("a corgi")));
});

test("strategic concepts carry the subject so cards can describe themselves", () => {
  const concepts = strategicVariations({ character: "a corgi", setting: "Tokyo at night", mood: "joyful" });
  assert.ok(concepts.every((item) => item.character === "a corgi"));
  assert.ok(concepts.every((item) => item.setting === "Tokyo at night"));
  assert.ok(concepts.every((item) => typeof item.recommendation === "string" && item.recommendation.length > 0));
});

test("every concept card gets a distinct headline in both modes", () => {
  // All six custom concepts share one character, so the headline must describe the
  // angle instead — six identical card titles would make the step-1 grid useless.
  const custom = strategicVariations({ character: "a corgi", setting: "Tokyo" });
  const customHeadlines = custom.map((item) => item.headline);
  assert.equal(new Set(customHeadlines).size, 6, "custom headlines must be unique");
  assert.ok(customHeadlines.every((headline) => headline && !custom.some((c) => c.label === headline)),
    "a headline must not just repeat the strategy tag");

  for (const kind of ["dog", "person"]) {
    const headlines = inspirationIdeas(kind).map((item) => item.headline);
    assert.equal(new Set(headlines).size, 6, `${kind} headlines must be unique`);
  }
});

test("inspiration mode creates six annotated dog and person options", () => {
  for (const kind of ["dog", "person"]) {
    const ideas = inspirationIdeas(kind);
    assert.equal(ideas.length, 6);
    assert.ok(ideas.every((item) => item.character && item.setting && item.recommendation));
  }
});

test("recommendConcept picks the highest score and tolerates an empty list", () => {
  assert.equal(recommendConcept([{ id: "a", score: 10 }, { id: "b", score: 40 }]).id, "b");
  assert.equal(recommendConcept([]), null);
});

test("storyboard creates exactly six scenes totaling requested duration", () => {
  const concept = strategicVariations({ character: "a corgi", setting: "Tokyo" })[1];
  const storyboard = makeStoryboard(concept, 30);
  assert.equal(storyboard.length, 6);
  assert.equal(storyboard.reduce((sum, scene) => sum + scene.duration, 0), 30);
  assert.match(storyboard[5].beat, /final image/i);
});

test("storyboard duration is clamped to a producible range", () => {
  assert.equal(clampSeconds(3), 18);
  assert.equal(clampSeconds(999), 60);
  assert.equal(clampSeconds("not a number"), 30);

  for (const requested of [18, 25, 30, 47, 60]) {
    const concept = strategicVariations({ character: "a corgi", setting: "Tokyo" })[1];
    const total = makeStoryboard(concept, requested).reduce((sum, scene) => sum + scene.duration, 0);
    assert.equal(Number(total.toFixed(1)), requested, `expected ${requested}s storyboard to total ${requested}s`);
  }
});

test("storyboard refuses a concept without a prompt", () => {
  assert.throws(() => makeStoryboard(null, 30), /required/i);
  assert.throws(() => makeStoryboard({ label: "x" }, 30), /required/i);
});

test("render plan is approval gated and retry limited", () => {
  const concept = strategicVariations({ character: "a corgi", setting: "Tokyo" })[1];
  const project = {
    storyboard: makeStoryboard(concept, 30),
    costGuardrails: { maxRetriesPerShot: 2 }
  };
  const plan = buildRenderPlan(project);
  assert.equal(plan.mode, "approval-gated");
  assert.equal(plan.stages[2].maxRetriesPerShot, 2);
});

test("new renders start unapproved, unspent and unattached", () => {
  const concept = strategicVariations({ character: "a corgi", setting: "Tokyo" })[1];
  const renders = createRenders(makeStoryboard(concept, 30));
  assert.equal(renders.length, 6);
  assert.ok(renders.every((render) => render.approved === false));
  assert.ok(renders.every((render) => render.attempts === 0));
  assert.ok(renders.every((render) => render.cost === null && render.jobId === null && render.output === null));
});

test("rework consumes the retry budget and then refuses to spend more", () => {
  let render = { scene: 1, status: "awaiting-keyframe", attempts: 0, approved: false };

  render = applyRenderDecision(render, "rework", 2);
  assert.deepEqual([render.attempts, render.status], [1, "needs-rework"]);

  render = applyRenderDecision(render, "rework", 2);
  assert.deepEqual([render.attempts, render.status], [2, "blocked-retry-limit"]);

  // The guardrail holds no matter how many times an operator clicks.
  for (let i = 0; i < 5; i += 1) render = applyRenderDecision(render, "rework", 2);
  assert.equal(render.attempts, 2, "attempts must never exceed the configured retry budget");
  assert.equal(render.status, "blocked-retry-limit");
});

test("a zero retry budget blocks on the first rework", () => {
  const render = applyRenderDecision({ attempts: 0, approved: false }, "rework", 0);
  assert.equal(render.attempts, 0);
  assert.equal(render.status, "blocked-retry-limit");
});

test("approve and reset move a shot between terminal and clean states", () => {
  const approved = applyRenderDecision({ attempts: 1, approved: false, status: "needs-rework" }, "approve", 2);
  assert.equal(approved.approved, true);
  assert.equal(approved.status, "approved");

  const reset = applyRenderDecision(approved, "reset", 2);
  assert.deepEqual([reset.approved, reset.attempts, reset.status], [false, 0, "awaiting-keyframe"]);
});

test("render decisions never mutate the shot they are given", () => {
  const original = { scene: 1, status: "awaiting-keyframe", attempts: 0, approved: false };
  applyRenderDecision(original, "rework", 2);
  applyRenderDecision(original, "approve", 2);
  assert.deepEqual(original, { scene: 1, status: "awaiting-keyframe", attempts: 0, approved: false });
});

test("unknown decisions are rejected rather than silently ignored", () => {
  assert.throws(() => applyRenderDecision({ attempts: 0 }, "ship-it", 2), /Unknown render decision/);
});

test("render summary reports readiness for the paid video stage", () => {
  const renders = createRenders(makeStoryboard(strategicVariations({ character: "a corgi" })[1], 30));
  assert.deepEqual(renderSummary(renders), { total: 6, approved: 0, blocked: 0, remaining: 6, readyForVideo: false });

  const allApproved = renders.map((render) => ({ ...render, approved: true, status: "approved" }));
  assert.equal(renderSummary(allApproved).readyForVideo, true);
  assert.equal(renderSummary([]).readyForVideo, false, "an empty plan is never ready for video");
});
