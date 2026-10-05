import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
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
  machine: ['gadgets/laptop.svg', 'Code.svg'],
  terminal: ['code/terminal.svg', 'Code.svg'],
  microphone: ['playback/mic.svg', 'Microphone 2.svg'],
  tools: ['metrics/sliders-horizontal.svg', 'SettingsSliderHor 4.svg'],
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
  writing: ['tools/pencil.svg', 'Pencil.svg'],
};
const output = {};
const rootDimensions = /\s(?:width|height)="[^"]*"/g;
const rootAriaHidden = /\saria-hidden="[^"]*"/g;
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
      (mood === 'glass' && name === 'machine') ||
      (mood === 'fill' && ['terminal', 'microphone', 'tools'].includes(name))
        ? path.join(upstream, 'public/normal', regular)
        : mood === 'glass'
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
const brandRoot = path.resolve('vendor/lody/packages/components/src/components/icons');
const brands = {};
for (const [name, file] of Object.entries({
  openai: 'openai-icon',
  anthropic: 'anthropic-icon',
  deepseek: 'deepseek-icon',
  glm: 'glm-icon',
  minimax: 'minimax-icon',
})) {
  const source = await readFile(path.join(brandRoot, `${file}.tsx`), 'utf8');
  const svg = source.match(/<svg\b[\s\S]*<\/svg>/)?.[0]?.replace('{...props}', '');
  if (!svg || /[{}]/.test(svg)) throw new Error(`Expected a static upstream SVG: ${file}`);
  brands[name] = svg;
}
for (const file of (await readdir(path.join(brandRoot, 'registry-assets'))).toSorted()) {
  if (file.endsWith('.svg'))
    brands[`registry:${file.slice(0, -4)}`] = await readFile(
      path.join(brandRoot, 'registry-assets', file),
      'utf8',
    );
}
for (const name of ['bub', 'dimcode', 'lody']) {
  const svg = await readFile(
    path.resolve(`vendor/lody/packages/components/src/assets/${name}.svg`),
    'utf8',
  );
  brands[name] = name === 'lody' ? svg.replaceAll('fill="#E2E8F0"', 'fill="currentColor"') : svg;
}
brands.mimo = await readFile('tools/icons/xiaomi.svg', 'utf8');
for (const [name, svg] of Object.entries(brands)) {
  brands[name] = svg
    .replace(/<svg\b[^>]*>/, (root) => root.replace(rootDimensions, '').replace(rootAriaHidden, ''))
    .replace(/<svg\b/, '<svg aria-hidden="true" width="100%" height="100%"')
    .replaceAll('fillRule=', 'fill-rule=')
    .replaceAll('clipRule=', 'clip-rule=');
}
await mkdir('src/shared/icons', { recursive: true });
await writeFile(
  'src/shared/icons/generated.ts',
  `// Generated from pinned Runeicons and upstream Lody brand assets. Run pnpm prepare.\nconst brands = ${JSON.stringify(brands, null, 2)} as const;\nexport const iconMarkup = {${Object.entries(
    output,
  )
    .map(
      ([mood, glyphs]) =>
        `${JSON.stringify(mood)}: {...${JSON.stringify(glyphs, null, 2)}, ...brands}`,
    )
    .join(',\n')}} as const;\n`,
);
