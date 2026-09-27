// Configuration contract only: never execute capture-fixture.ts against a live
// enclave (it performs inference and writes real receipts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('the Render blueprint uses the canonical API for its TEE upstream', async () => {
  const yaml = await readFile(new URL('render.yaml', root), 'utf8');
  const endpoint = yaml.match(/- key: TEE_ENDPOINT\s+value: (\S+)/)?.[1];
  assert.equal(endpoint, 'https://api.solrouter.com/tee');
});

test('the manual capture example uses the same canonical API origin', async () => {
  const source = await readFile(new URL('scripts/capture-fixture.ts', root), 'utf8');
  const base = source.match(/const BASE = '([^']+)'/)?.[1];
  assert.equal(base, 'https://api.solrouter.com');
});
