# Stay Agent — HITL Cockpit demo script

## The ten-minute run, in one paragraph

Open the cockpit on **Scenario A · Early checkout** and say what the room is looking at: an
agent proposing a real action against a real Apaleo property, and a harness deciding whether
it may act alone. Fire an early check-out from the Demo drawer at **3 nights** — above the
Ambassador's ceiling of 2 — and let the card land; walk the audience down it once and once
only, because every card after this is the same card: the action plan, the **scope intercept**
naming `reservations.manage` as the boundary being held, the **authority chain** read out of
the governance file, and the four responses. Press **Escalate** and let them watch the chain
step from Manager on Duty to Hotel GM with the Apaleo role named beside each. Now switch to
**B · Rate override** and change nothing about how you talk: drag the slider from 6% to 15%,
point out that the same harness now routes to a **Revenue Manager** under `rates.manage`, and
approve it. Move to **C · Folio charge**, submit €340 against the live folio, approve, and let
the status line turn green — *scope invoked, CreateFolioCharge executed, Apaleo id
MFCLCSZS-1-1-D-n* — a real charge, on their sandbox, through a governed path. Then **D ·
Force-manage**: set the phase pill to **RUN**, fire it, and show that it *still* raises a card,
because no band holds `reservations.force-manage` autonomously and Run does not change that.
Close on **E · Feature enablement**, where the scope panel reads "none — no property-system
call exists": the same four buttons, the same trail, gating a change to what the agent itself
may do. Finish in the Witness trail on the right, where every one of those decisions is now a
categorised, signed, externally anchored record — then say the line the whole demo exists to
earn: *that was one mechanism, five times, and only the scope, the ceiling and the approver
ever changed.*

---

## Before the meeting (10 minutes, not in the room)

1. **Confirm the demo is live.**
   ```bash
   curl -s https://stay-agent-mikerawsonnzs-projects.vercel.app/api/stay/scenarios?company_id=1 \
     | head -c 400
   ```
   You want `"scope_map_verified":true` and `"governance_loaded":true`. If either is false,
   stop and read the note at the bottom of this file — do not present past it.

2. **Refresh the folio for Scenario C.** The console ships a working folio id, but folios
   accumulate charges from previous runs. To get a clean one:
   ```bash
   node artifacts/api-server/scripts/find-open-folio.mjs BER \
     https://stay-agent-mikerawsonnzs-projects.vercel.app
   ```
   Paste the `folioId` into the Demo drawer's **Apaleo folio** field under Scenario C. Without
   a real open folio the approval still works — it reports the write as *staged*, honestly —
   but you lose the strongest moment in the demo.

3. **Set the phase to WALK** in the Demo drawer. Crawl sends everything to a human, which
   flattens the contrast you are trying to draw; Run hides the ceiling entirely.

4. **Leave a card or two in the queue from a dry run.** An empty board is fine, but a cockpit
   with recent history in the Witness panel reads as a system in use rather than a fixture.

## Room setup

- Full screen, **1440px or wider**. Below 940px the two columns stack and the Witness trail
  falls below the fold — survivable on a phone, wrong for a projector.
- The Demo drawer is the presenter's control surface. It is deliberately labelled *"not part
  of the operational view"*: if anyone asks, say plainly that it stands in for the property
  systems that would raise these events in production.
- **One decision at a time.** Each is a live LLM call plus an Apaleo round-trip plus a Witness
  seal — 5 to 12 seconds — against a 60-second function ceiling. Do not queue up two while the
  first is running. The wait is a feature: it is what a real governed decision costs.

## The five scenarios, and the point each one makes

| | Scenario | Apaleo scope | Autonomous | Approver | The point |
|---|---|---|---|---|---|
| **A** | Early checkout | `reservations.manage` | ≤ 2 nights | Manager on Duty · *Senior Reservation Manager* | This is the harness. Everything after is the same. |
| **B** | Rate override | `rates.manage` | ≤ 9% below BAR | Revenue Manager · *Revenue Manager* | Different scope, different approver, identical mechanism. |
| **C** | Folio charge | `folios.payment-with-charges` | ≤ €75 | Finance Controller · *Accountant* | It really writes. Money moves, through a human. |
| **D** | Force-manage | `reservations.force-manage` | **never** | Manager on Duty · *Senior Reservation Manager* | Some authority is never delegated — provably, not by policy. |
| **E** | Feature enablement | *none* | **never** | Hotel GM · *Property Admin* | The harness is not an Apaleo wrapper. It gates the agent itself. |

Both names are shown on every chain node — the citizenM title and the Apaleo role — because
the mapping between the two role models is the thing Apaleo needs to see.

## Beat by beat

**0:00 — What they are looking at.** The header: property BER, agent live on Gemini, the
Witness badge reading *Anchored — externally committed, audit-ready*, and the phase pill.
Say: the agent is connected to their sandbox, and every decision it makes is already sealed.

**0:45 — Scenario A, the anatomy.** Demo drawer → Nights early **3** → *Present to HITL*. When
the card lands, walk it once:
- *Action plan* — what the agent intends, in the operator's words.
- *Apaleo scope intercept* — `reservations.manage`, `PATCH /booking/v1/reservations/{id}`,
  status **⏸ awaiting HITL approval**. This is where the harness sits.
- *Authority chain* — three nodes, current one lit. Say it is read from the governance file,
  not from code.
- *Four responses* — approve, deny, escalate, baseline.

**2:30 — Escalate.** Press it. The chain steps up; the card re-heads to **Hotel GM · Property
Admin**; the scope status stays *awaiting approval* because escalation reaches for no scope.
A new card is now waiting for that band. Say: the escalation is itself a sealed record.

**3:30 — Scenario B, the reuse.** Switch tabs. Slider to **15%**, above the 9% line — the hint
turns amber before you submit anything. Fire it, approve it. Say nothing new about the card;
the silence is the argument. New scope, new approver, same everything else.

**5:30 — Scenario C, the real write.** €340 against the live folio. Approve. The status line
goes green: **✓ Scope invoked — CreateFolioCharge executed · Apaleo id MFCLCSZS-1-1-D-n**.
That id is real and checkable in their own sandbox. This is the moment; let it land.

**7:00 — Scenario D, the limit.** Set the phase pill to **RUN** first — say out loud that you
are giving the agent maximum autonomy. Fire the force-manage. It *still* raises a card. Say:
this is not a policy we are trusting the model to follow; no role band holds this class
autonomously, so no phase can make it autonomous.

**8:15 — Scenario E, the reflexive case.** Toggle a new loyalty rule. The scope panel reads
*none — no property-system call exists*. The same four buttons gate a change to the agent's own
capability, before it applies. Say: the harness is not an Apaleo integration feature. It is an
authority layer that happens to sit in front of Apaleo scopes when the authority is Apaleo's.

**9:15 — The trail.** Right-hand panel: every decision categorised **AGENT DECISION**,
**COMPLIANCE BOUNDARY**, **FRAMEWORK INTEGRITY**, **AGENT LIFECYCLE**, each with the scope it
gated and the approver's Apaleo role. Click *verify* on any row for an offline signature and
hash-chain check. **Article 12** opens the evidence report; the download is the artefact a
compliance officer keeps.

**9:45 — The close.** One mechanism, five authority configurations. Only the scope, the
ceiling and the approver changed.

## Questions you will get, and the honest answers

**"Is this really hitting our API?"** Yes. `mcp.apaleo.com/mcp`, client-credentials OAuth,
250 tools exposed. The charge id from Scenario C is in their sandbox. The client holds all six
scopes shown in the tiles — nothing on screen names a scope it has not been granted.

**"What happens if the write fails?"** It says so. The status line reports *staged, not
executed* with the reason verbatim. Nothing in this build reports a write as successful when it
was not — that is the one thing the demo cannot afford to fake, and it is enforced in the
executor, not in the display.

**"Are the thresholds hardcoded?"** No. They are read from
`stay-agent.EXCEPTION_AUTHORITY.md` at request time. Edit that file, re-seed from the drawer,
and the tiles, the ceilings and the chains all change with no code change. That is why
Scenario B's approver is a Revenue Manager and C's is an Accountant.

**"Who is the human? How do you know it was them?"** Say this one straight: **you don't, yet.**
The console records the role that responded, and Witness makes that record tamper-evident — but
there is no authentication layer on this demo, so the actor is *asserted*, not authenticated.
The seal proves the record has not been altered since it was written; it does not prove who was
at the keyboard. That is a known, tracked gap.

**"Is the agent signing its own decisions?"** Also no, and it is worth being precise. Stay
Agent has its own `did:web` and signs its A2A card, so you can verify *this agent published
this card*. Its decisions still seal under a shared Witness account, so you cannot yet verify
*this agent sealed this decision*. Two different keys; one exists.

**"Can we baseline everything and stop being asked?"** That is what **Baseline** does, and the
card names the bounds it just set. It is reversible from the Baselined classes panel, the
reversal is itself sealed, and past auto-approvals stand rather than being retroactively
unmade.

## If something goes wrong mid-demo

- **A decision times out.** It exceeded the 60s function ceiling, most likely a cold start.
  Fire it again — the instance is now warm. Do not reload the page; the queue is server-side
  and nothing is lost.
- **The card shows a degraded governing clause.** The model failed to produce a parseable
  decision and the card says so rather than inventing a rule. Escalate it and move on — that
  behaviour is defensible in this room, and pretending otherwise is not.
- **`scope_map_verified: false`.** The scope panel is suppressed and a red warning appears
  under the scenario strip. Do not talk around it: it means the displayed scope map and the
  executor disagree, and the panel is being withheld on purpose. Skip the scope narrative and
  present the authority chain instead.
- **The EU AI Act ▸ C2MD button hangs.** C2MD's assessment runs ~55s against the 60s cap and
  can genuinely exceed it on a cold start. It is not part of the ten-minute run; leave it.
- **Everything 503s on `/.well-known/*`.** That is the identity endpoint, not the cockpit, and
  it does not affect the demo.

## What this demo does not show

Say these before someone finds them, because they are the questions that decide a partnership:

- The human is **asserted, not authenticated**. No login sits in front of these decisions.
- Stay Agent is a **bespoke monolith**, not a normalised deployment: it computes its own
  authority, runs its own HITL queue, and holds the Apaleo write itself. A proposing agent
  holding the write is a real architectural gap, and it is on the roadmap to split.
- It runs against the **Apaleo sandbox**, carries no real guests and no real money.
- Anchoring is real, but `verifyTsa` cannot complete on serverless, so records honestly report
  **SIGNED_PENDING** rather than claiming an anchor they have not re-checked locally.
