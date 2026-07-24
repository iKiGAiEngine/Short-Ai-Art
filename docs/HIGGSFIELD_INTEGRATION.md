# Higgsfield integration contract

The app is intentionally safe-by-default: detecting the Higgsfield CLI does not authorize paid generation.

## Required sequence before first paid generation

1. Authenticate the official Higgsfield CLI on the same host that will run Short AI Art.
2. Inspect the live CLI help and model catalog rather than relying on hard-coded historical commands.
3. Identify a low-cost still-image model for the six concept candidates.
4. Identify image-to-video models suitable for scene animation and pet/person identity retention.
5. Implement a cost-estimate step before submission wherever the current CLI supports it.
6. Store job ID, model, prompt, parameters, estimated/actual cost, attempt number and output path in the project record.
7. Poll jobs with bounded timeouts. Never use an uncontrolled retry loop.
8. Require operator approval between concept stills, scene keyframes and video generation.
9. Only after the above is validated should `HIGGSFIELD_ENABLED=true` be set on the production host.

## First real benchmark

Use one 30-second project, but do not render the full project immediately.

- Generate six low-cost concept stills.
- Pick one approved visual direction.
- Create one scene keyframe.
- Animate that one keyframe with a short low-cost clip.
- Review likeness/identity, anatomy, motion, camera quality, generation time and credits used.
- Only then unlock multi-scene generation.

## Provider boundary

Higgsfield-specific code belongs under `providers/`. Core project/storyboard/QC data should remain provider-neutral so direct Kling, Veo, OpenAI or other providers can be added later without re-architecting the OS.
