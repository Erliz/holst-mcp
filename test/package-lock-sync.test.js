import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// The #27 regression: release commits bumped package.json version and
// engines after v0.3.0 without regenerating package-lock.json. npm mirrors
// the root package metadata into the lockfile (top-level "version" and
// packages[""]), so any `npm install` re-synced it and leaked unrelated
// metadata hunks into whatever PR the contributor was working on.
//
// CI stayed green because `npm ci` validates only the dependency graph,
// not the mirrored root fields. These guards fail the suite the moment
// package.json metadata changes without a lockfile regen.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8'));

describe('package-lock.json mirrors package.json root metadata (#27)', () => {
  test('lockfile version matches package.json version', () => {
    // npm writes the root version in two places; both must track the source.
    assert.equal(
      lock.version,
      pkg.version,
      `top-level lockfile version ${lock.version} != package.json ${pkg.version}: run npm install and commit package-lock.json`
    );
    assert.equal(
      lock.packages[''].version,
      pkg.version,
      `packages[""].version ${lock.packages[''].version} != package.json ${pkg.version}: run npm install and commit package-lock.json`
    );
  });

  test('lockfile engines match package.json engines', () => {
    assert.deepEqual(
      lock.packages[''].engines,
      pkg.engines,
      `packages[""].engines ${JSON.stringify(lock.packages[''].engines)} != package.json ${JSON.stringify(pkg.engines)}: run npm install and commit package-lock.json`
    );
  });
});
