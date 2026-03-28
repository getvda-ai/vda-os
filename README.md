# VDA-MD Framework

**Value-Driven AI Operating System — Governance-as-Markdown**

A structured governance framework for AI agents built on plain markdown files with YAML front matter, mandatory compliance enforcement, referential integrity checking, and a built-in file manager with audit trail. Designed to sit between "a folder of prompts nobody governs" and "a $200k enterprise AI platform."

---

## Contents

- [Why VDA-MD](#why-vda-md)
- [Concepts](#concepts)
- [File Schema](#file-schema)
- [YAML Front Matter Reference](#yaml-front-matter-reference)
- [File Types and Clause Thresholds](#file-types-and-clause-thresholds)
- [Compliance Enforcement](#compliance-enforcement)
- [Referential Integrity](#referential-integrity)
- [Industry Profiles](#industry-profiles)
- [Example: AGENTS.md](#example-agentsmd)
- [Example: EXCEPTION.md](#example-exceptionmd)
- [REST API](#rest-api)
- [CI/CD Integration](#cicd-integration)
- [Running Locally](#running-locally)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Licence](#licence)

---

## Why VDA-MD

Most organisations deploying AI face the same failure mode: agents are built quickly, governance is bolted on afterwards, and nobody can answer "which version of this agent is in production, who approved it, and does it still meet our regulatory obligations?"

VDA-MD makes governance the *starting point* rather than the audit layer. Every agent, SOP, skill, and exception policy is a markdown file with:

- A fixed schema enforced at save time
- Mandatory regulatory clauses verified against industry-specific control sets
- A full version history with structured, categorised commit messages
- Cross-reference tracking so archiving one file cannot silently break another

Because the files are plain markdown, they live comfortably in Git, are reviewable in PRs, and integrate with any CI/CD pipeline that can run a shell command.

### Execution-layer agnostic by design

VDA-MD governs *what* agents are authorised to do and *how* that authorisation is documented — not *how* the agents run. The governance mandate is independent of which model, framework, or platform executes your agents today.

Your AGENTS.md file does not reference GPT-4, Claude, LangChain, or AutoGen. It defines roles, constraints, compliance obligations, and escalation paths. When the AI landscape changes — and it will — your governance estate remains intact. Swap the model, re-platform the runtime, migrate to the next orchestration framework: the governance files, the version history, the audit trail, and the compliance coverage do not move.

This is a deliberate architectural choice. Governance that is entangled with the execution layer becomes a liability every time the technology shifts. Governance that sits above the execution layer becomes a durable organisational asset.

---

## Concepts

| Term | Meaning |
|------|---------|
| **Company Hub** | A named configuration containing industry profile, brand context, and the set of governance files for one organisation |
| **Governance File** | A `.md` file with YAML front matter, typed by role (AGENTS, SOP, COMPLIANCE, SKILL, EXCEPTION, CUSTOM) |
| **Axis** | The organisational dimension a file belongs to: `vertical` (journey), `horizontal` (shared services), or `compliance` |
| **Compliance Shield** | Live per-element view of NIST controls, frameworks, and clause counts for the file currently being edited |
| **FM Agent** | The AI co-pilot embedded in the File Manager — generates content, surfaces integrity issues, and produces release notes |
| **Core Files** | AGENTS, COMPLIANCE, and SOP files — these cannot be archived; they form the mandatory governance baseline |
| **Dilution** | A save that reduces the count of a mandatory element below the saved baseline, triggering a structured override |

---

## File Schema

Every governance file in VDA-MD follows this structure:

```markdown
---
title: "Booking Agent"
type: AGENTS
owner: "Operations Lead"
axis: vertical
stage: "Reservation"
agent_id: "agent-booking-001"
nist_control: "AC-2"
expires_at: ""
exception_reason: ""
---

## Purpose
[Brief description of what this agent does]

## Responsibilities
The agent MUST authenticate every booking request against the identity provider.
The agent MUST NOT access customer payment data directly.
The agent MAY escalate unresolvable conflicts to the Duty Manager.

## Escalation Path
Unresolved exceptions follow the process defined in EXCEPTION-Loyalty.md.

## Compliance Baseline
- NIST AC-2: Account Management — access provisioned via SSO only
- NIST AU-2: Audit Events — all transactions logged to audit stream
- GDPR: Customer data processed under lawful basis per COMPLIANCE-Data.md

## Constraints
[Any limitations, integrations, or environmental notes]
```

### Rules

1. Files must begin with a `---` YAML front matter block.
2. The `type` field must be one of: `AGENTS`, `SOP`, `COMPLIANCE`, `SKILL`, `EXCEPTION`, `CUSTOM`.
3. MUST, MUST NOT, and MAY clauses are counted at save time and stored — they form the clause baseline.
4. Cross-references to other files use bare filenames: `EXCEPTION-Loyalty.md`, `SOP-Refunds.md`. These are tracked for referential integrity.
5. The `## Compliance Baseline` section is not enforced structurally but is expected by convention in all AGENTS, SOP, and COMPLIANCE files.

---

## YAML Front Matter Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | yes | Human-readable name shown in the File Manager |
| `type` | enum | yes | File role — `AGENTS`, `SOP`, `COMPLIANCE`, `SKILL`, `EXCEPTION`, `CUSTOM` |
| `owner` | string | no | Name or role responsible for this file |
| `axis` | enum | yes | `vertical` (journey), `horizontal` (shared services), `compliance` |
| `stage` | string | no | Journey stage for vertical files (e.g. `Reservation`, `Check-in`) |
| `agent_id` | string | no | Stable identifier used to reference this agent from external systems |
| `nist_control` | string | no | Primary NIST SP 800-53 control this file addresses |
| `expires_at` | date string | conditional | Required for EXCEPTION files — ISO 8601 date |
| `exception_reason` | string | conditional | Required for EXCEPTION files — justification text |
| `domain` | string | no | Service domain (e.g. `payments`, `identity`, `logistics`) |
| `vendor` | string | no | Third-party service this file governs |
| `baseline` | boolean | no | If `true`, this file is part of the signed release baseline |

Fields are parsed at save time. `owner` and `expires_at` in the front matter take precedence over values set through the UI.

---

## File Types and Clause Thresholds

The compliance engine counts `MUST`, `MUST NOT`, and `MAY` occurrences in file content. Minimum counts are enforced per file type:

| Type | MUST | MUST NOT | MAY | Notes |
|------|------|----------|-----|-------|
| `AGENTS` | 3 | 2 | 2 | Core — cannot be archived |
| `COMPLIANCE` | 3 | 2 | 2 | Core — cannot be archived |
| `SOP` | 3 | 1 | 1 | Core — cannot be archived |
| `SKILL` | 2 | 1 | 1 | |
| `EXCEPTION` | 1 | 1 | 1 | Requires `expires_at` |
| `CUSTOM` | 1 | 0 | 0 | Minimum enforcement only |

If a save reduces any count below the saved baseline, it is flagged as **dilution** and the save is blocked until a structured override is provided.

---

## Compliance Enforcement

### How it runs

Every save triggers a synchronous compliance check **before** the write is committed. The check runs in three passes:

**Pass 1 — NIST controls**
Each required control ID (e.g. `AC-2`) is counted in the file content using a case-insensitive regex. If the count has decreased since the last saved version, the element is marked **DILUTED**. If it is absent entirely, it is **MISSING**.

**Pass 2 — Regulatory frameworks**
Industry-specific framework keywords are scanned (e.g. `["HIPAA", "DSPT", "health data", "patient data"]` for healthcare). Same dilution logic applies.

**Pass 3 — Clause counts**
`MUST`, `MUST NOT`, and `MAY` are counted and compared to the per-file-type thresholds and the saved baseline.

### Status semantics

| Status | Meaning |
|--------|---------|
| `PRESENT` | Element found at or above baseline |
| `DILUTED` | Element present but count decreased from saved version |
| `MISSING` | Element not found in current content |

### Override flow

When a save is blocked, the user must complete a structured override form before the write proceeds:

```
Override reason (one of):
  ○ Temporary — will be restored before next release
  ○ Business exception — approved by [name/role]
  ○ Control not applicable — reason: [text]
  ○ Superseded by — references: [file or policy ID]

Acknowledgements:
  ☐ I understand this override will be permanently recorded
  ☐ I accept accountability as [role] for this decision
```

If any **framework** element (a legal requirement such as HIPAA, GDPR, or DORA) is involved, the role field only accepts `CFO` or `CEO`.

The override is appended to the commit message in machine-readable format:

```
[OVERRIDE: Control not applicable — read-only integration, no direct data access | Approved: CTO] — Updated escalation path
```

This format is parseable for aggregate reporting — for example, counting how many overrides were `Temporary` versus `Business exception` across all files and versions.

### Compliance check API

```http
POST /api/fm/compliance-check
Content-Type: application/json

{
  "content": "...",
  "savedContent": "...",
  "industry": "healthcare",
  "fileType": "AGENTS"
}
```

Response:

```json
{
  "elements": [
    { "id": "AC-2",  "label": "NIST AC-2",           "category": "nist",      "status": "present"  },
    { "id": "hipaa", "label": "HIPAA / UK DSPT",      "category": "framework", "status": "diluted"  },
    { "id": "must-clauses", "label": "MUST clauses (min 3)", "category": "clause", "status": "missing" }
  ],
  "total": 8,
  "covered": 5,
  "hasDilution": true,
  "clauses": { "mustCount": 1, "mustNotCount": 2, "mayCount": 2, "wordCount": 320 }
}
```

---

## Referential Integrity

Files reference each other by bare filename (e.g. `See EXCEPTION-Loyalty.md`). The framework tracks these links and enforces two rules:

**On save:** The FM Agent panel shows the Reference Graph — all outbound references with `intact` or `broken` status, and all inbound references (other files that depend on this one).

**On archive:** The server checks two conditions before setting `is_archived = true`:
1. If the file type is `AGENTS`, `COMPLIANCE`, or `SOP` → blocked with `403 core_file`
2. If any active file references this file by name → blocked with `409 referenced`, returning the list of blocking files

```http
DELETE /api/fm/file/:id?companyId=1
```

```json
// 409 response
{
  "error": "File is referenced by other active governance files",
  "reason": "referenced",
  "referencedBy": ["AGENTS-Booking.md", "SOP-Escalation.md"]
}
```

### Integrity check API

```http
POST /api/fm/integrity-check
Content-Type: application/json

{
  "companyId": 1,
  "content": "... See EXCEPTION-Loyalty.md ...",
  "filename": "AGENTS-Booking.md",
  "fileId": 12
}
```

Response:

```json
{
  "outboundRefs": [
    { "name": "EXCEPTION-Loyalty.md", "status": "intact" },
    { "name": "SOP-Refunds.md",        "status": "broken" }
  ],
  "inboundRefs": [
    { "name": "AGENTS-Concierge.md", "fileId": 7 }
  ],
  "missingCoreTypes": []
}
```

---

## Industry Profiles

Seven industry profiles ship out of the box. Each maps to a set of required NIST SP 800-53 controls and regulatory frameworks:

| Industry key | NIST Controls | Frameworks |
|---|---|---|
| `healthcare` | AC-2, AU-2, MP-6, SC-28, IA-5 | HIPAA / UK DSPT, NHS DTAC, MDR |
| `financial` | AC-2, AU-2, SC-28, RA-5, IR-4 | SOX, DORA, MiFID II |
| `retail` | AC-2, AU-2, SA-4, SI-10 | PCI DSS, Consumer Duty, GDPR / CCPA |
| `hospitality` | AC-2, AU-2, SA-4, IR-4 | PCI DSS, ISO 22301 |
| `professional` | AC-2, AU-2, AC-17, SC-8 | ISO 27001, SRA / Legal |
| `manufacturing` | AC-2, AU-2, SA-4, PE-3, SC-28 | ISO 9001, ITAR, IEC 62443 |
| `marina` | AC-2, AU-2, SA-4, SI-10 | MCA / MSN Regulations, Consumer Duty, GDPR, Marine Insurance Act |

To add a custom industry profile, extend `INDUSTRY_COMPLIANCE_MAP` in `artifacts/api-server/src/routes/fileManager.ts`.

---

## Example: AGENTS.md

A minimal valid AGENTS file for a healthcare booking agent:

```markdown
---
title: "Patient Booking Agent"
type: AGENTS
owner: "Digital Health Lead"
axis: vertical
stage: "Scheduling"
agent_id: "agent-booking-phc-001"
nist_control: "AC-2"
---

## Purpose
Manages inbound appointment requests for the patient portal, validates availability,
and confirms bookings in the clinical scheduling system.

## Responsibilities
The agent MUST verify patient identity via NHS login before processing any booking.
The agent MUST NOT store patient identifiers outside the authorised EHR integration.
The agent MUST log every booking event to the AU-2 audit stream.
The agent MUST NOT modify appointment records without clinician sign-off.
The agent MAY send confirmation notifications via the approved messaging gateway.
The agent MAY escalate scheduling conflicts to the Duty Coordinator.

## Escalation Path
Clinical conflicts are handled per SOP-ClinicalEscalation.md.
Data subject requests follow COMPLIANCE-DSPT.md.

## Compliance Baseline
- NIST AC-2: Identity verified via NHS login SSO integration
- NIST AU-2: All booking events written to centralised audit log
- NIST MP-6: No local media storage — all data remains in EHR
- NIST SC-28: Data in transit encrypted via TLS 1.3
- NIST IA-5: Authenticator management delegated to NHS login
- HIPAA / UK DSPT: Patient data processed under Data Security and Protection Toolkit obligations
- NHS DTAC: Complies with Digital Technology Assessment Criteria for health and care
```

---

## Example: EXCEPTION.md

```markdown
---
title: "Loyalty Tier Bypass — Q1 Campaign"
type: EXCEPTION
owner: "Head of Marketing"
axis: compliance
expires_at: "2026-03-31"
exception_reason: "Temporary loyalty tier override for Q1 acquisition campaign. Control coverage maintained via manual weekly review by CRM lead."
---

## Exception Scope
This exception permits the Booking Agent to bypass standard loyalty tier validation
for new customer registrations during the Q1 campaign window.

## Conditions
The exception MUST NOT apply to existing customers with active loyalty status.
The exception MAY be applied to new registrations between 2026-01-01 and 2026-03-31.

## Review
Weekly review by CRM Lead. Auto-expires 2026-03-31.
Parent agent: AGENTS-Booking.md
```

---

## REST API

All endpoints are prefixed with `/api`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/fm/files/:companyId` | List all active files for a company |
| `GET` | `/fm/file/:id` | Get a single file with full content |
| `POST` | `/fm/file` | Create a new governance file |
| `PUT` | `/fm/file/:id` | Save new content (creates version entry) |
| `DELETE` | `/fm/file/:id?companyId=` | Archive a file (blocked for core types and referenced files) |
| `GET` | `/fm/versions/:fileId` | List all versions of a file |
| `POST` | `/fm/compliance-check` | Run compliance check on content |
| `POST` | `/fm/integrity-check` | Check referential integrity for a file |
| `POST` | `/fm/sign/:id` | Sign off a file (sets status to `live`) |
| `POST` | `/fm/search/:companyId` | Full-text search across files |
| `POST` | `/fm/agent/suggest` | AI-generate or AI-suggest content for a file |
| `POST` | `/fm/agent/release-notes` | Generate release notes for a file set |

---

## CI/CD Integration

Because VDA-MD governance files are plain markdown, they can live in a Git repository alongside your application code. The compliance check and integrity check endpoints can be called from any CI pipeline.

### GitHub Actions example

```yaml
name: Governance Lint

on: [push, pull_request]

jobs:
  compliance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Check all governance files
        env:
          API_BASE: ${{ secrets.VDAMD_API_BASE }}
          COMPANY_ID: ${{ secrets.VDAMD_COMPANY_ID }}
          INDUSTRY: ${{ secrets.VDAMD_INDUSTRY }}
        run: |
          set -e
          FAILED=0
          for file in governance/**/*.md; do
            TYPE=$(grep -oP '(?<=^type: ).*' "$file" | head -1)
            CONTENT=$(cat "$file")
            RESULT=$(curl -sf -X POST "$API_BASE/api/fm/compliance-check" \
              -H "Content-Type: application/json" \
              -d "{\"content\": $(echo "$CONTENT" | jq -Rs .), \
                   \"industry\": \"$INDUSTRY\", \
                   \"fileType\": \"$TYPE\"}")
            MISSING=$(echo "$RESULT" | jq '[.elements[] | select(.status=="missing")] | length')
            if [ "$MISSING" -gt 0 ]; then
              echo "FAIL: $file has $MISSING missing compliance elements"
              echo "$RESULT" | jq '.elements[] | select(.status=="missing") | .label'
              FAILED=1
            else
              echo "OK:   $file"
            fi
          done
          exit $FAILED
```

### Integrity check in CI

```yaml
      - name: Check referential integrity
        run: |
          for file in governance/**/*.md; do
            FILENAME=$(basename "$file")
            CONTENT=$(cat "$file")
            RESULT=$(curl -sf -X POST "$API_BASE/api/fm/integrity-check" \
              -H "Content-Type: application/json" \
              -d "{\"companyId\": $COMPANY_ID, \
                   \"content\": $(echo "$CONTENT" | jq -Rs .), \
                   \"filename\": \"$FILENAME\"}")
            BROKEN=$(echo "$RESULT" | jq '[.outboundRefs[] | select(.status=="broken")] | length')
            if [ "$BROKEN" -gt 0 ]; then
              echo "FAIL: $FILENAME has $BROKEN broken cross-references"
              echo "$RESULT" | jq '.outboundRefs[] | select(.status=="broken") | .name'
              exit 1
            fi
          done
```

### Recommended repository layout

```
governance/
  agents/
    AGENTS-Booking.md
    AGENTS-Concierge.md
  sops/
    SOP-Escalation.md
    SOP-Refunds.md
  compliance/
    COMPLIANCE-DataProtection.md
  skills/
    SKILL-ReservationLookup.md
  exceptions/
    EXCEPTION-LoyaltyBypass.md
```

Files can be stored flat or nested — the compliance and integrity APIs only care about the filename, not the path.

### Export from the File Manager

The File Manager UI can export any file to a `.md` download from the editor toolbar. For bulk export, query `GET /api/fm/files/:companyId` and write each file's `content` field to disk.

---

## Running Locally

### Requirements

- Node.js 20+
- pnpm 9+
- PostgreSQL 15+

### Setup

```bash
git clone https://github.com/your-org/vda-md-framework.git
cd vda-md-framework

# Install all workspace dependencies
pnpm install

# Set environment variables
cp .env.example .env
# Edit .env: DATABASE_URL, ANTHROPIC_API_KEY (or use Replit AI proxy)

# Push database schema
pnpm --filter @workspace/db run db:push

# Start all services
pnpm --filter @workspace/api-server run dev   # API on :8080
pnpm --filter @workspace/vda-os run dev       # UI on the configured port
```

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `ANTHROPIC_API_KEY` | yes | Anthropic API key for FM Agent AI features |
| `PORT` | no | API server port (default `8080`) |

---

## Roadmap

**Near-term**

- [ ] Export full company governance pack as a ZIP of `.md` files
- [ ] Webhook notifications when a file's compliance status changes
- [ ] Git-native sync — push governance files to a configured repository on save
- [ ] `vdamd lint` CLI tool for local pre-commit compliance checking

**Medium-term**

- [ ] Multi-user sign-off workflow with named approver chains
- [ ] Coverage matrix view — which agents cover which NIST controls across the full file set
- [ ] Scheduled expiry monitor with email alerts for EXCEPTION files approaching their `expires_at`
- [ ] Override analytics dashboard — aggregate reporting on override categories and frequency (governance health score)

**Longer-term**

- [ ] ISO 27001 Annex A control mapping
- [ ] OWASP AI Security controls integration
- [ ] Agent runtime telemetry ingestion — correlate live agent behaviour with its governance file
- [ ] Multi-company governance comparison (useful for group structures and franchises)

---

## Contributing

Contributions are welcome. Please read these guidelines before opening a PR.

### Development setup

Follow the [Running Locally](#running-locally) steps. The monorepo uses pnpm workspaces:

```
artifacts/api-server/   Express API (TypeScript, esbuild)
artifacts/vda-os/       React + Vite frontend
lib/db/                 Drizzle ORM schema and migrations
```

### Conventions

- **Backend routes:** files in `artifacts/api-server/src/routes/` must not include the `/api/` prefix — that is added by the router in `index.ts`
- **AI calls:** all calls to Anthropic must go through the `callAI` helper from `ai-proxy.ts` — never import the Anthropic SDK directly
- **Clause thresholds:** if adding a new file type, add a corresponding entry to `MINIMUM_CLAUSE_THRESHOLDS`
- **Industry profiles:** if adding a new industry, add it to `INDUSTRY_COMPLIANCE_MAP` with at least two NIST controls and one framework

### Opening a PR

1. Fork the repository
2. Create a branch: `git checkout -b feature/my-feature`
3. Make your changes and add tests where applicable
4. Ensure the API server builds without TypeScript errors: `pnpm --filter @workspace/api-server run build`
5. Open a pull request with a clear description of the change and why

### Reporting issues

Please include:
- The file type and industry profile in use
- The content that triggered unexpected behaviour (redact any sensitive data)
- The API response if the issue is backend-side

---

## Licence

MIT Licence

Copyright (c) 2026 VDA-MD Framework Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
