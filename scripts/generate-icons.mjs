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
const glyphs = {
  home: ['tools/house.svg', 'home-round-door 2.svg'],
  chat: ['messaging/message-circle.svg', 'Bubble.svg'],
  history: ['schedule/history.svg', 'History 2.svg'],
  new: ['documents/file-pen-line.svg', 'EditSmall.svg'],
  settings: ['tools/settings.svg', 'SettingsGear1 2.svg'],
  send: ['arrows/arrow-up.svg', 'Send.svg'],
  stop: ['indicators/square-stop.svg', 'Stop 2.svg'],
  attach: ['documents/paperclip.svg', 'ChainLink3 1.svg'],
  close: ['indicators/x.svg', 'CircleX 1.svg'],
  page: ['documents/file-text.svg', 'FileText.svg'],
  back: ['arrows/arrow-left.svg', 'Back 2.svg'],
  plus: ['indicators/plus.svg', 'CircleX 1.svg'],
  agent: ['tools/sparkles.svg', 'Sparkle3 2.svg'],
  permission: ['identity/shield-check.svg', 'ShieldCheck 1.svg'],
  readOnly: ['senses/eye.svg', 'EyeOpen 1.svg'],
  permissionWarning: ['identity/shield-x.svg', 'ShieldCrossed 1.svg'],
  search: ['tools/search.svg', 'MagnifyingGlass 2.svg'],
  check: ['indicators/check.svg', 'SquareCheck 2.svg'],
  plan: ['documents/clipboard-list.svg', 'Clipboard.svg'],
  fast: ['other/zap.svg', 'Zap 2.svg'],
  copy: ['code/copy.svg', 'FileText.svg'],
  info: ['indicators/info.svg', 'CircleInfo 1.svg'],
  chevron: ['arrows/chevron-right.svg', 'Back 2.svg'],
  delivered: ['indicators/circle-check.svg', 'SquareCheck 2.svg'],
  user: ['indicators/circle-user.svg', 'UserSettings 2.svg'],
  wrap: ['documents/file-text.svg', 'FileText.svg'],
};
const output = {};
const rootDimensions = /\s(?:width|height)="[^"]*"/g;
const fillGlyphs = {
  history: 'schedule/clock.svg',
  new: 'tools/pencil.svg',
  send: 'messaging/send.svg',
  attach: 'documents/clipboard.svg',
  back: 'arrows/step-back.svg',
  plus: 'indicators/cross.svg',
  close: 'indicators/circle-x.svg',
  check: 'indicators/circle-check.svg',
  chevron: 'arrows/skip-forward.svg',
};
for (const [mood, variant] of Object.entries(variants)) {
  output[mood] = {};
  for (const [name, [regular, glass]] of Object.entries(glyphs)) {
    const file =
      mood === 'glass'
        ? path.join(upstream, 'public/glass-icons', glass)
        : path.join(
            upstream,
            'public',
            variant,
            mood === 'fill' ? (fillGlyphs[name] ?? regular) : regular,
          );
    const svg = await readFile(file, 'utf8');
    output[mood][name] = svg
      .replace(/<svg\b[^>]*>/, (root) => root.replace(rootDimensions, ''))
      .replace(/<svg\b/, '<svg aria-hidden="true" width="100%" height="100%"')
      .replace(
        '<svg ',
        mood === 'glass' && name === 'plus'
          ? '<svg style="transform:rotate(45deg)" '
          : mood === 'glass' && name === 'chevron'
            ? '<svg style="transform:rotate(180deg)" '
            : '<svg ',
      )
      .replace(/<\?xml[^>]*\?>/g, '')
      .replaceAll('stroke="black"', 'stroke="currentColor"')
      .replaceAll('fill="black"', 'fill="currentColor"');
  }
}
await mkdir('src/shared/icons', { recursive: true });
await writeFile(
  'src/shared/icons/generated.ts',
  `// Generated from the pinned Runeicons submodule. Run pnpm prepare.\nexport const iconMarkup = ${JSON.stringify(output, null, 2)} as const;\n`,
);
