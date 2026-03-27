# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **AI**: Anthropic Claude via Replit AI Integrations (no user API key required)

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   ├── api-server/         # Express API server
│   └── vda-os/             # Value Driven AI Operating System (React + Vite)
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   ├── db/                 # Drizzle ORM schema + DB connection
│   └── integrations-anthropic-ai/  # Anthropic AI integration via Replit proxy
├── scripts/                # Utility scripts (single workspace package)
├── pnpm-workspace.yaml     # pnpm workspace
├── tsconfig.base.json      # Shared TS options
├── tsconfig.json           # Root TS project references
└── package.json            # Root package with hoisted devDeps
```

## Applications

### `artifacts/vda-os` — Value Driven AI Operating System

React + Vite frontend for the VDA-MD Framework. A governance AI operating system that:
- Configures industry-specific AI governance frameworks (Hospitality, Financial, Healthcare, Retail, Professional Services, Manufacturing)
- Ingests brand context from company websites and uploaded documents
- Generates NIST SP 800-53 compliant governance Markdown files via Claude AI (C2MD Translation Engine)
- Runs exception overlay engine comparing baseline vs exception governance decisions
- Maintains a Witness Agent audit trail (SOC 2, GDPR, EU AI Act, ISO 42001 compliant)

Entry: `src/VdaOS.jsx` — full self-contained component
App: `src/App.tsx` — thin wrapper that renders VdaOS

All AI API calls go to `/api/ai/messages` (backend proxy), NOT directly to Anthropic.

### `artifacts/api-server` — Express API Server

- `/api/healthz` — health check
- `/api/ai/messages` — Anthropic API proxy (uses Replit AI Integration, no user key needed)
  - Automatically maps model names (e.g. `claude-sonnet-4-20250514` → `claude-sonnet-4-6`)

## AI Integration

Uses Replit AI Integrations for Anthropic access:
- `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` — auto-set by Replit
- `AI_INTEGRATIONS_ANTHROPIC_API_KEY` — auto-set by Replit
- No user API key required; charges billed to Replit credits

Available models (via proxy):
- `claude-sonnet-4-6` (recommended)
- `claude-opus-4-6`
- `claude-haiku-4-5`

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Routes in `src/routes/`.
- `health.ts` — `GET /api/healthz`
- `ai-proxy.ts` — `POST /api/ai/messages` (Anthropic proxy)

### `lib/integrations-anthropic-ai` (`@workspace/integrations-anthropic-ai`)

Pre-configured Anthropic SDK client using Replit AI Integration env vars.

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL.

### `lib/api-spec` (`@workspace/api-spec`)

OpenAPI spec + Orval codegen config.

Run codegen: `pnpm --filter @workspace/api-spec run codegen`
