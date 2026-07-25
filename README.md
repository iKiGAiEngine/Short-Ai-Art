# Short AI Art — PetCine OS

Internal production operating system for turning a character + setting into six strategic concepts, selecting a direction, generating a six-scene ~30-second storyboard, and preparing a guarded AI render workflow.

## MVP workflow

1. Describe a character and setting, or use **Surprise Me / Trending-style** concept generation.
2. Generate six strategically different creative directions: Literal, Cinematic, Scenic, Action, Emotional, Wildcard.
3. Review the AI recommendation, edit prompts, and lock a winner.
4. Expand the winner into a six-scene storyboard.
5. Generate approved keyframes before expensive video renders.
6. Send approved scenes through a provider adapter such as Higgsfield.
7. QC each scene, regenerate only failures, then assemble the final 9:16 short.

## Current status

The operator workflow runs end to end: concepting, selection, storyboard editing, the
approval-gated render plan, and per-shot keyframe review with a server-enforced retry budget.
Keyframe references are attached by the operator while live generation is still gated —
approvals, retries and blocked shots are already tracked, so wiring Higgsfield in later
replaces how a reference arrives without changing the approval flow around it.

## Keyframe review

Each shot in Step 4 holds a status, a retry count and an approved keyframe reference:

- **Approve** requires a reference (URL or file path) — a shot cannot be approved on a click alone.
- **Needs rework** consumes one unit of the retry budget. At `MAX_RETRIES_PER_SHOT` the shot
  becomes `blocked-retry-limit` and stops consuming budget entirely.
- **Reset** clears the shot back to `awaiting-keyframe` and returns its retry budget.

The budget is enforced server-side, so a stuck scene cannot spiral into an uncapped paid
retry loop even if the UI is bypassed.

## Principles

- Keep the core visual style consistent while character, setting, action, and story vary.
- Never enter uncontrolled paid-generation retry loops.
- Keep provider integrations replaceable so Higgsfield, Kling, Veo, OpenAI, or future models can be routed without rebuilding the OS.
- Save prompts, model settings, approvals, failures, and costs so the system improves from production history.

## Local run

Requires Node 20+. No dependencies to install.

```bash
npm start          # http://localhost:4173
npm run dev        # same, with reload on change
npm test           # unit + HTTP integration tests
```

Configuration comes from the environment (see `.env.example`): `PORT`,
`PROJECT_DATA_DIR`, `MAX_PROJECT_CREDITS`, `MAX_RETRIES_PER_SHOT` and `HIGGSFIELD_ENABLED`.
Projects are stored as one JSON file per project under `PROJECT_DATA_DIR`
(default `data/projects`), which is git-ignored operator content.
