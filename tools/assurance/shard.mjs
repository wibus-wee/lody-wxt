import assert from 'node:assert/strict';

export function shardCases(authored, index, count) {
  assert.ok(Number.isInteger(count) && count >= 1 && count <= 16, 'Invalid shard count');
  assert.ok(Number.isInteger(index) && index >= 0 && index < count, 'Invalid shard index');
  assert.equal(new Set(authored).size, authored.length, 'Duplicate authored case');
  const selected = [...authored].sort().filter((_, position) => position % count === index);
  assert.ok(selected.length, 'Empty shard');
  return selected;
}

export function validateShardReport(report, selected) {
  const keys = report.flatMap((feature) =>
    (feature.elements ?? [])
      .filter((item) => item.type === 'scenario')
      .map((scenario) => {
        const tag = (prefix) =>
          scenario.tags.find((item) => item.name.startsWith(prefix))?.name.slice(prefix.length);
        return `${tag('@journey:')}/${tag('@case:')}`;
      }),
  );
  assert.equal(new Set(keys).size, keys.length, 'Duplicate framework case');
  assert.deepEqual(keys.sort(), [...selected].sort(), 'Shard framework coverage mismatch');
}
