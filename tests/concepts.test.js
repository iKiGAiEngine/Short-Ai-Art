import test from "node:test";
import assert from "node:assert/strict";
import { buildRenderPlan, inspirationIdeas, makeStoryboard, strategicVariations } from "../src/concepts.js";

test("custom input always creates six strategic concepts", () => {
  const concepts = strategicVariations({ character: "a corgi", setting: "Tokyo at night", mood: "joyful" });
  assert.equal(concepts.length, 6);
  assert.deepEqual(concepts.map((item) => item.label), ["Literal", "Cinematic", "Scenic", "Action", "Emotional", "Wildcard"]);
  assert.ok(concepts.every((item) => item.prompt.includes("a corgi")));
});

test("inspiration mode creates six dog and person options", () => {
  assert.equal(inspirationIdeas("dog").length, 6);
  assert.equal(inspirationIdeas("person").length, 6);
});

test("storyboard creates exactly six scenes totaling requested duration", () => {
  const concept = strategicVariations({ character: "a corgi", setting: "Tokyo" })[1];
  const storyboard = makeStoryboard(concept, 30);
  assert.equal(storyboard.length, 6);
  assert.equal(storyboard.reduce((sum, scene) => sum + scene.duration, 0), 30);
  assert.match(storyboard[5].beat, /final image/i);
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
