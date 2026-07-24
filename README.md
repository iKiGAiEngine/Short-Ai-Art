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

The first build includes the operator workflow, concept engine, storyboard generation, project persistence, provider boundary, and generation guardrails. Live Higgsfield generation is the next integration step after account authentication.

## Principles

- Keep the core visual style consistent while character, setting, action, and story vary.
- Never enter uncontrolled paid-generation retry loops.
- Keep provider integrations replaceable so Higgsfield, Kling, Veo, OpenAI, or future models can be routed without rebuilding the OS.
- Save prompts, model settings, approvals, failures, and costs so the system improves from production history.

## Local run

Requires Node 20+.

```bash
npm start
```

Open `http://localhost:4173`.
