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
// and the citizenM /sops folder (POST /api/sops/ingest scans process.cwd()/sops,
// which is the function root on Vercel).
await cp(path.resolve(dir, "src/public"), path.join(funcDir, "public"), { recursive: true });
await cp(path.resolve(dir, "src/governance"), path.join(funcDir, "governance"), { recursive: true });
await cp(path.join(repoRoot, "sops"), path.join(funcDir, "sops"), { recursive: true });

// Vercel Node function config — default export of index.mjs is the Express app.
await writeFile(
  path.join(funcDir, ".vc-config.json"),
  JSON.stringify({ runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs", shouldAddHelpers: false }, null, 2),
);

// Route everything to the function (well-known + /api + /stay all handled by Express).
// Cron: drain the fail-open seal-outbox every 5 min so seals delayed by a Witness
// outage land even with no dashboard traffic (drain is idempotent + never seals PII).
await writeFile(
  path.join(outRoot, "config.json"),
  JSON.stringify({
    version: 3,
    routes: [{ handle: "filesystem" }, { src: "/(.*)", dest: "/index" }],
    crons: [{ path: "/api/stay/seal/drain", schedule: "*/5 * * * *" }],
  }, null, 2),
);

console.log("Vercel Build Output ready:", outRoot);
