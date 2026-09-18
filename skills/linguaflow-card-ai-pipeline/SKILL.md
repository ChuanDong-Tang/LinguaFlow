---
name: linguaflow-card-ai-pipeline
description: Develop, diagnose, validate, or operate LinguaFlow Card AI generation and enrichment. Use for rewrite, sentence segmentation, original-to-rewrite alignment, auxiliary content, image description, prompts, job versions, retries, targeted reruns, scanners, or historical backfill.
---

# LinguaFlow Card AI pipeline

Trace the complete path before changing one stage:

```text
Card creation or edit
-> API persistence and job enqueue
-> Worker claim by job/prompt version
-> AI generation and parsing
-> content/version persistence
-> enrichment jobs
-> API detail projection
-> Mobile rendering and practice state
```

## Content invariants

- User-authored original text is immutable content. Never rewrite, reorder,
  translate, or add punctuation in a field presented as the user's original.
- A rewrite may naturalize syntax and wording but must preserve facts, tone,
  point of view, narrative order, and logical order. Only adjacent source ideas
  may be combined.
- Alignment is derived from finalized rewrite sentences back to exact,
  continuous original spans. Display projection must slice stored original
  text rather than synthesize a new “original”.
- Practice, blanks, audio, auxiliary text, and alignments bind to the current
  content version. Stale async output must not overwrite new content.

## Versioning and rollout

Change the prompt or job version whenever semantics or accepted output changes.
Inspect both sides of the queue: API/repository enqueue code and Worker claim
code may load the same version constant in different processes. Restart every
runtime that imports the changed rule.

A job marked `completed` proves persistence, not semantic quality. Validate
target coverage, source range/order, content versions, and a small sample of
actual meaning before declaring the change stable.

## Retry and backfill

For one-card recovery, assert the exact card, user, current content hashes,
expected old job/version, and absence of a conflicting new job. Preserve useful
failed/superseded jobs for audit. Rerun only the requested generation layer;
do not regenerate the rewrite when alignment alone is wrong unless the rewrite
itself violates the content invariants.

Historical scanners and backfill remain disabled unless the user explicitly
authorizes a bounded backfill. Before enabling one, observe new-card success,
sample semantic quality, choose a small batch, define stop conditions, and
verify failures before expanding.

Use the production incident and database Skills for live diagnosis and
targeted production recovery. Never print unnecessary user content.
