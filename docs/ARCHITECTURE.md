# Short AI Art architecture

## Current production loop

1. **Concept intake** — character, setting, mood, optional style override.
2. **Six-direction concepting** — Literal, Cinematic, Scenic, Action, Emotional, Wildcard.
3. **Operator selection** — edit and lock the master prompt.
4. **Storyboard** — six continuity-aware scenes for a default 30-second 9:16 short.
5. **Approval-gated render plan** — concept stills → scene keyframes → video clips → assembly.
6. **Provider adapter** — Higgsfield first, but provider logic is isolated so direct Kling/Veo/OpenAI routes can be added later.
7. **Production history** — project prompts, scenes, retries, status and future cost/QC data live in project records.

## Modules

| Path | Responsibility |
| --- | --- |
| `src/concepts.js` | Pure domain logic: concepting, storyboarding, render plans, render-state transitions. No I/O. |
| `src/store.js` | Project persistence. Owns the project shape and refuses to persist anything it did not construct. |
| `src/api.js` | HTTP routing, request validation, static file serving. Exports `createServer()` so tests can boot it on an ephemeral port. |
| `src/server.js` | Process entry point; only binds the port. |
| `providers/higgsfield.js` | The single boundary where a paid provider is touched. |
| `public/` | The operator dashboard: no build step, no dependencies, no third-party requests. |

## Trust boundary

Request bodies are untrusted. `normalizeProjectInput` whitelists the fields an operator may
set; server-owned fields (`id`, `createdAt`, `status`, `renders`) are never taken from a
request. `saveProject` independently refuses any project whose `id` is not a server-generated
UUID, so a persistence path can never be steered outside the data directory.

## HTTP API

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness and version. |
| `GET` | `/api/provider-status` | Whether the Higgsfield CLI is present and whether spend is unlocked. |
| `GET` | `/api/projects` | Compact summaries for the library sidebar. |
| `POST` | `/api/projects` | Create a project and its six concepts. |
| `GET` `DELETE` | `/api/projects/:id` | Read or delete one project. |
| `POST` | `/api/projects/:id/select` | Lock a concept and its edited master prompt. |
| `POST` | `/api/projects/:id/storyboard` | Build six scenes; invalidates any existing render plan. |
| `POST` | `/api/projects/:id/scene` | Edit one scene's prompt, beat or camera. |
| `POST` | `/api/projects/:id/render-plan` | Build the approval-gated plan and the per-shot queue. |
| `POST` | `/api/projects/:id/render` | Record an `approve` / `rework` / `reset` decision for one shot. |

## Why stills come before video

Video generations are the expensive and failure-prone step. The OS therefore locks identity, composition and environment with still/keyframe approvals before animation. Bad scenes are retried individually rather than re-rendering the entire short.

## Paid-generation safety

`HIGGSFIELD_ENABLED` defaults to false. Connecting the CLI alone does not authorize the app to spend credits. Live submission should only be implemented after the authenticated CLI/model schema is inspected on the host and a cost-estimation step is confirmed.

The retry budget is enforced in `applyRenderDecision`, on the server — not in the UI. A shot
that reaches `MAX_RETRIES_PER_SHOT` moves to `blocked-retry-limit` and stops consuming budget
no matter how many times the decision is submitted. Clearing it requires an explicit `reset`.
Approving a shot also requires an attached keyframe reference, so nothing can be marked
approved on the strength of a click alone.

## Next build milestone

Step 4 currently tracks approvals against references the operator generates by hand, which
is what makes the tool usable before the provider is wired up. The integration work replaces
the manual paste with a real generation call behind the same approval gate:

- Authenticate Higgsfield on the deployment host.
- Inspect the current model catalog and live generation command schema.
- Add cost estimate → explicit operator approval → submit → poll → retrieve.
- Render six real low-cost concept stills in the concept cards.
- Populate each shot's keyframe reference automatically instead of by paste.
- Add image-to-video generation for approved storyboard frames.
- Extract QC frames and assemble approved clips with FFmpeg.
