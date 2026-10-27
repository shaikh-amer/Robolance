// Rebuilds the test fixtures (.hex next to each .ino) with the local toolchain.
// Usage: ROBOLANCE_ARDUINO_CORE=... ROBOLANCE_ARDUINO_LIBS=... node scripts/gen-fixtures.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSketch } from '../packages/hardware-tools/lib/index.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'hardware-sim', 'fixtures');
for (const name of ['bench', 'wall-follower', 'line-follower']) {
  const r = await buildSketch(await readFile(join(fixtures, `${name}.ino`), 'utf8'));
  if (!r.ok) { console.error(name, r.output); process.exit(1); }
  await writeFile(join(fixtures, `${name}.hex`), r.hex);
  console.log(name, r.size);
}
