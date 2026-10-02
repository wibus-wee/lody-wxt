import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const upstream = path.resolve('vendor/runeicons');
try {
  await access(path.join(upstream, 'packages/runeicons/package.json'));
} catch {
  throw new Error('Runeicons submodule is missing. Run git submodule update --init --recursive.');
}
const variants = {
  outline: 'normal',
  duotone: 'duotone',
  fill: 'fill',
  pixel: 'pixelated',
  glass: 'glass',
};
const output = {};
for (const [mood, variant] of Object.entries(variants)) {
  const file =
    mood === 'glass'
      ? path.join(upstream, 'public/glass-icons/home-round-door 2.svg')
      : path.join(upstream, 'public', variant, 'tools/house.svg');
  const svg = await readFile(file, 'utf8');
  output[mood] = svg
    .replace(/\s(?:width|height)="[^"]*"/g, '')
    .replace(/<svg\b/, '<svg aria-hidden="true" width="24" height="24"')
    .replace(/<\?xml[^>]*\?>/g, '')
    .replaceAll('stroke="black"', 'stroke="currentColor"')
    .replaceAll('fill="black"', 'fill="currentColor"');
}
await mkdir('src/shared/icons', { recursive: true });
await writeFile(
  'src/shared/icons/generated.ts',
  `// Generated from the pinned Runeicons submodule. Run pnpm prepare.\nexport const iconMarkup = ${JSON.stringify(output, null, 2)} as const;\n`,
);
