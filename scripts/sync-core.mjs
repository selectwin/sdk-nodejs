// Sync the generated core (openapi-generator typescript-fetch output) into
// src/generated. The core is produced in the `selectwin-sdks` repo
// (`generate-sdks.{sh,ps1} typescript-fetch`). This copies its output here, where
// the hand-written DX shell in src/ wraps it. Committed so installs don't need
// the generator.
//
// Override the source repo with: SELECTWIN_SDKS=C:\path\to\selectwin-sdks
import { rm, mkdir, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

const sdksRoot =
  process.env.SELECTWIN_SDKS ??
  'C:/Users/brunm/OneDrive/Documentos/Projects/selectwin-sdks';
const src = path.join(sdksRoot, 'sdks', 'typescript-fetch', 'src');
const dest = path.join(repoRoot, 'src', 'generated');

if (!existsSync(src)) {
  console.error(
    `Generated core not found at: ${src}\n` +
      `Run \`generate-sdks.ps1 typescript-fetch\` (or .sh) in selectwin-sdks first, ` +
      `or set SELECTWIN_SDKS to the repo path.`,
  );
  process.exit(1);
}

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });
await cp(src, dest, { recursive: true });
console.log(`Synced generated core → src/generated (from ${src})`);
