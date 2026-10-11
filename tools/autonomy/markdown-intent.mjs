import assert from 'node:assert/strict';

const heading = /^#{2,3}[ \t]+(\S.*)$/;
const checkbox = /^- +\[([ x])\] +(\S.*)$/i;
const bullet = /^- +/;
const markdownLink = /^\[[^\]]+\]\(([^\s)]+)\)$/;
const inlineCode = /^`([^`]+)`$/;
const fence = /^\s*(`{3,}|~{3,})/;
const comment = /<!--[\s\S]*?-->/g;
const intentHeadings = new Set([
  'what changed?',
  'who does this help?',
  'expected behavior',
  'failure and recovery',
  'scope',
  'verification',
  'test links',
  'affected journeys',
  'added or updated journeys',
  'capture plan',
  'why browser or ui evidence is unnecessary',
  'unchanged behavior',
  'performance evidence',
  'release note',
]);
const wrapper = /^\s*<\/?(?:details|summary)\b[^>]*>.*$/i;
const empty = /^(?:none|not applicable|n\/a)$/i;
const types = new Map([
  ['bug fix', 'fix'],
  ['new feature', 'feat'],
  ['performance improvement', 'perf'],
  ['refactor', 'refactor'],
  ['documentation', 'docs'],
  ['maintenance', 'chore'],
]);
const areas = new Map([
  ['web app', 'web'],
  ['browser extension', 'extension'],
  ['documentation', 'docs'],
  ['sdk', 'sdk'],
  ['tooling', 'tooling'],
]);
function sectionsOf(body) {
  const sections = new Map();
  let section;
  let closing;
  for (const line of body.replace(comment, '').split('\n')) {
    const marker = line.match(fence)?.[1];
    if (closing) {
      if (marker?.[0] === closing[0] && marker.length >= closing.length) closing = undefined;
      continue;
    }
    if (marker) {
      closing = marker;
      continue;
    }
    if (wrapper.test(line)) {
      if (line.trim().toLowerCase() === '</details>') section = undefined;
      continue;
    }
    const title = line.match(heading)?.[1].trim().toLowerCase();
    if (title) {
      section = undefined;
      if (intentHeadings.has(title)) {
        assert.ok(!sections.has(title), `Duplicate PR section: ${title}`);
        section = [];
        sections.set(title, section);
      }
    } else section?.push(line);
  }
  assert.ok(!closing, 'Close the fenced block in the PR description');
  return new Map(Array.from(sections, ([key, lines]) => [key, lines.join('\n').trim()]));
}
function field(section, label, required = true) {
  const matches = section
    .split('\n')
    .map((line) => line.replaceAll('**', '').trim())
    .filter((line) => line.toLowerCase().startsWith(`${label.toLowerCase()}:`));
  assert.ok(matches.length <= 1, `Duplicate PR field: ${label}`);
  const value = matches[0]?.slice(label.length + 1).trim() ?? '';
  assert.ok(!required || value, `Fill in ${label}`);
  return value;
}
function checked(section, label, required = true) {
  const entries = section
    .split('\n')
    .map((line) => line.trim().match(checkbox))
    .filter((match) => match?.[2].trim().toLowerCase() === label.toLowerCase());
  assert.ok(
    entries.length <= 1 && (!required || entries.length === 1),
    `Keep one '${label}' checkbox`,
  );
  return Boolean(entries[0] && entries[0][1].toLowerCase() === 'x');
}
function list(value, title) {
  if (!value || empty.test(value)) return [];
  return value
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      assert.ok(bullet.test(line.trim()), `Use one bullet per item under '${title}'`);
      const item = line.trim().replace(bullet, '').trim();
      const link = item.match(markdownLink);
      return link?.[1] ?? item.replace(inlineCode, '$1');
    })
    .filter((item) => !empty.test(item));
}
export function parseMarkdownIntent(body) {
  const sections = sectionsOf(body);
  const required = (name) => {
    const value = sections.get(name.toLowerCase());
    assert.ok(value, `Fill in the '${name}' section of the PR description`);
    return value;
  };
  const scope = required('Scope');
  const type = types.get(field(scope, 'Type').toLowerCase());
  assert.ok(
    type,
    'Type must be Bug fix, New feature, Performance improvement, Refactor, Documentation or Maintenance',
  );
  const surfaces = field(scope, 'Areas')
    .split(',')
    .map((value) => areas.get(value.trim().toLowerCase()));
  assert.ok(
    surfaces.every(Boolean) && new Set(surfaces).size === surfaces.length,
    'Areas must list Web app, Browser extension, Documentation, SDK or Tooling once each',
  );
  const verification = required('Verification');
  const capture = sections.get('capture plan') ?? '';
  const references = list(capture, 'Capture plan');
  assert.ok(references.length <= 1, 'Link at most one capture plan file');
  const change = {
    type,
    summary: required('What changed?'),
    user_impact: required('Who does this help?'),
    expected_path: required('Expected behavior'),
    negative_path: required('Failure and recovery'),
    breaking: checked(scope, 'Breaking change'),
    surfaces,
    affected_journeys: list(sections.get('affected journeys'), 'Affected journeys'),
    added_or_updated_journeys: list(
      sections.get('Added or updated journeys'.toLowerCase()),
      'Added or updated journeys',
    ),
    test_links: list(sections.get('test links'), 'Test links'),
    evidence: {
      e2e: checked(verification, 'Browser journeys passed'),
      packaged_extension: checked(verification, 'Packaged extension journeys passed'),
      screenshots: [],
    },
    release_note: required('Release note'),
  };
  if (references[0]) change.capture_plan = references[0];
  const reason = sections.get('why browser or ui evidence is unnecessary');
  if (reason && !empty.test(reason)) change.nonvisual_reason = reason;
  const unchanged = sections.get('unchanged behavior');
  if (unchanged && !empty.test(unchanged)) change.unchanged_behavior = unchanged;
  if (type === 'perf') {
    const performance = required('Performance evidence');
    change.performance = {
      interaction: field(performance, 'Interaction'),
      baseline: field(performance, 'Baseline'),
      environment: field(performance, 'Environment'),
      sample_size: Number(field(performance, 'Samples')),
    };
  }
  return change;
}
