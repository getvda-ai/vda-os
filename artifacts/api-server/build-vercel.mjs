/**
 * build-vercel.mjs — produce a Vercel Build Output (v3) that serves the Express
 * app as a single Node serverless function. Run from artifacts/api-server:
 *   node build-vercel.mjs
 * then from the repo root: vercel deploy --prebuilt --prod
 *
 * The whole app + all @workspace deps are bundled by esbuild (no Vercel build /
 * pnpm-workspace resolution needed). Boot seeders/schedulers live in index.ts's
 * app.listen callback, which never runs here — we import src/app.ts (the Express
 * app, default export) directly. The DB is already migrated/seeded on Neon.
 */
import { build as esbuild } from "esbuild";
import { rm, cp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

globalThis.require = createRequire(import.meta.url);
const dir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dir, "../..");
const outRoot = path.join(repoRoot, ".vercel", "output");
const funcDir = path.join(outRoot, "functions", "index.func");

await rm(outRoot, { recursive: true, force: true });
await mkdir(funcDir, { recursive: true });

await esbuild({
  entryPoints: [path.resolve(dir, "src/app.ts")],
  platform: "node",
  target: "node22",
  bundle: true,
  format: "esm",
  outfile: path.join(funcDir, "index.mjs"),
  logLevel: "info",
  // pg optionally requires the native client; keep it external (unused — pure-JS pg).
  external: ["pg-native", "pino-pretty"],
  banner: {
    js: `import { createRequire as __cr } from 'node:module';
import __path from 'node:path';
import __url from 'node:url';
globalThis.require = __cr(import.meta.url);
globalThis.__filename = __url.fileURLToPath(import.meta.url);
globalThis.__dirname = __path.dirname(globalThis.__filename);`,
  },
});

// Runtime assets read by the app: console HTML, governance md (admin re-seed),
// and the /sops folder (POST /api/sops/ingest scans process.cwd()/sops,
// which is the function root on Vercel).
await cp(path.resolve(dir, "src/public"), path.join(funcDir, "public"), { recursive: true });
await cp(path.resolve(dir, "src/governance"), path.join(funcDir, "governance"), { recursive: true });
await cp(path.join(repoRoot, "sops"), path.join(funcDir, "sops"), { recursive: true });

// Vercel Node function config — default export of index.mjs is the Express app.
//
// maxDuration: C2MD's assess_agent_risk is an LLM generation that runs ~55s (measured live),
// plus ~10s cold-start on a scaled-to-zero instance. Without this the function inherits the
// platform default (~10-15s) and 504s long before C2MD answers. 60 is the HOBBY-plan ceiling:
// a warm assess (~55s) fits; a cold-start assess (~65s) can still exceed it and 504. For
// reliable headroom move the project to Pro and raise this to 300 (VERCEL_MAX_DURATION).
const MAX_DURATION = Number(process.env.VERCEL_MAX_DURATION || 60);
await writeFile(
  path.join(funcDir, ".vc-config.json"),
  JSON.stringify({ runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs", shouldAddHelpers: false, maxDuration: MAX_DURATION }, null, 2),
);

// Route everything to the function (well-known + /api + /stay all handled by Express).
// Cron: daily backstop drain of the fail-open seal-outbox (Hobby plan caps crons
// at once/day). Freshness during active use comes from drain-on-read on the tail/
// log endpoints; this cron catches anything left idle. Drain is idempotent + never
// seals PII. On the Pro plan, tighten to "*/5 * * * *" for near-real-time draining.
await writeFile(
  path.join(outRoot, "config.json"),
  JSON.stringify({
    version: 3,
    routes: [{ handle: "filesystem" }, { src: "/(.*)", dest: "/index" }],
    crons: [{ path: "/api/stay/seal/drain", schedule: "0 3 * * *" }],
  }, null, 2),
);

console.log("Vercel Build Output ready:", outRoot);
