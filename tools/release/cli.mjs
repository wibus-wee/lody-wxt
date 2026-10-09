import { readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { packageRelease, validateVersion } from './artifacts.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const [command, tag] = process.argv.slice(2);
try {
  if (command === 'check') {
    const { version } = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    );
    validateVersion(version, tag);
    console.info(`Release tag ${tag} matches version ${version}.`);
  } else if (command === 'package') {
    console.info(`Release assets: ${packageRelease(root)}`);
  } else {
    throw new Error('Usage: pnpm release:check v<version> | pnpm release:package');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
