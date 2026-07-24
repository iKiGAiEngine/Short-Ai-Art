# Short AI Art architecture

## Current production loop

1. **Concept intake** — character, setting, mood, optional style override.
2. **Six-direction concepting** — Literal, Cinematic, Scenic, Action, Emotional, Wildcard.
3. **Operator selection** — edit and lock the master prompt.
4. **Storyboard** — six continuity-aware scenes for a default 30-second 9:16 short.
5. **Approval-gated render plan** — concept stills → scene keyframes → video clips → assembly.
6. **Provider adapter** — Higgsfield first, but provider logic is isolated so direct Kling/Veo/OpenAI routes can be added later.
7. **Production history** — project prompts, scenes, retries, status and future cost/QC data live in project records.

## Why stills come before video

Video generations are the expensive and failure-prone step. The OS therefore locks identity, composition and environment with still/keyframe approvals before animation. Bad scenes are retried individually rather than re-rendering the entire short.

## Paid-generation safety

`HIGGSFIELD_ENABLED` defaults to false. Connecting the CLI alone does not authorize the app to spend credits. Live submission should only be implemented after the authenticated CLI/model schema is inspected on the host and a cost-estimation step is confirmed.

## Next build milestone

- Authenticate Higgsfield on the deployment host.
- Inspect the current model catalog and live generation command schema.
- Add cost estimate → explicit operator approval → submit → poll → retrieve.
- Render six real low-cost concept stills in the concept cards.
- Add image refinement/approval.
- Add image-to-video generation for approved storyboard frames.
- Extract QC frames and assemble approved clips with FFmpeg.
