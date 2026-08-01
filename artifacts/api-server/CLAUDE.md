# Stay Agent — engineering principles

The citizenM Stay Agent is a governed HITL decision surface. Its output is evidence a
compliance officer and an auditor rely on. These principles are load-bearing, not style.

## Rendering safety (non-negotiable)

**No user-facing surface renders a raw error string, empty content container, or unparsed
payload.** All structured-content fields must either render valid content or fail explicitly
to a flagged degraded state (e.g. "unavailable — escalate").

**HITL surfaces specifically must never render partial or degraded reasoning — either full
context or route to escalation.** An Ambassador acting on a card with missing or error-valued
reasoning, a missing governing clause, or a blank decision-basis panel is a *governance
failure*, not a display glitch. When a decision-support field cannot be rendered as valid
content, block the card from presenting as actionable and route it to the Manager on Duty.

Concretely, at every render site that consumes structured content from an external source
(C2MD, Witness, the agent decision engine, Apaleo):
- A **missing / null field** renders a defined fallback, never `undefined` and never an empty box passed off as content.
- An **error-valued field** (a field whose value is itself an error/marker string, e.g. a model-parse failure) is detected and rendered as an explicit degraded state — never surfaced verbatim as if it were content.
- A **malformed / empty payload or a thrown fetch** renders an explicit, visible error state in the primary content area — never a blank panel with the error hidden in a collapsed developer drawer.
- **Raw JSON** is never the user-facing render. It may live only in a collapsed, clearly-labelled developer drawer.

### Why this is a written principle

Three shipped bugs were all the same violation, not one-offs:
1. **C2MD assessment truncation** — a full field clipped to 200 chars mid-sentence, then the raw JSON dumped below it.
2. **Article 12 empty entries** — the report's evidence lived only in a raw-JSON drawer; collapsing that drawer (to fix #1) left the report visibly empty.
3. **HITL "Unable to parse agent response"** — a model-parse marker rendered verbatim as the governing clause on a live decision card.

Treat any new violation as an instance of this principle, and fix the class, not the symptom.

## Related invariants (context for the above)

- **Agent faults never impersonate governance.** A model-parse failure is an `agent_error`, never a `clause_applied` / `governingRule.ruleText`. The governed outcome of an agent fault is the fail-safe (escalate to a human), which is a real rule and is cited as such. (See `stayDecisionEngine.ts`.)
- **The evidence trail is append-only.** Defects in sealed records are corrected by appending a `TRAIL_CORRECTION`, never by rewriting or retiring a chain. (See `/api/stay/trail/correct`.)
- **PII stays out of immutable seals.** `minimizeInputs` + `scrubText` keep guest PII out of the Witness seal body, precisely so an externally-anchored, un-erasable record never becomes a store of un-erasable personal data. Any content added to a seal (including evidence artifacts) must respect this: seal hashes and non-PII descriptors, keep PII-bearing snapshots in the erasable store.
- **Verify state is stated, never inferred.** A single record proves only what it can (signature); chain continuity and anchor are separate signals with distinct honest verdicts. (See `verifyRecord.ts`.)
- **An identity is published or it is refused — never improvised.** Stay Agent's `did:web` is served only from a provisioned key. With no key, production returns `503 identity_not_provisioned` rather than a document built from an in-process keypair: a DID that resolves to a key which rotates on every cold start reads as tampering to a careful verifier and as success to a careless one, which is strictly worse than a 404. This is the rendering-safety principle applied to identity. (See `identity/stayIdentity.ts` and `IDENTITY.md`.)
- **A signed card is not signed evidence.** Stay Agent controls the key that signs its A2A card and answers DID-auth challenges; it controls no record-signing key, and its decisions still seal under a borrowed Witness account. Never let the first fact be read as the second — the card's `custody` block states both, and `IDENTITY.md` explains the gap.
