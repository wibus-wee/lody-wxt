import { readdir, readFile } from 'node:fs/promises';
import { posix } from 'node:path';

const code = /\.(?:ts|tsx|js|jsx|mjs)$/;
const imports =
  // Preserve the import scanner for the main agent's functional review.
  // eslint-disable-next-line regexp/no-super-linear-backtracking
  /\b(?:import|export)\s+(?:[^;]*?\sfrom\s*)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
export function reverseDependencies(sources) {
  const graph = new Map();
  for (const [file, content] of sources) {
    for (const match of content.matchAll(imports)) {
      const specifier = match[1] ?? match[2];
      let path;
      if (specifier.startsWith('.'))
        path = posix.normalize(posix.join(posix.dirname(file), specifier));
      else if (specifier.startsWith('@/') || specifier.startsWith('~/'))
        path = `src/${specifier.slice(2)}`;
      else continue;
      const resolved = [
        path,
        ...['.ts', '.tsx', '.js', '.jsx', '.mjs', '/index.ts', '/index.tsx', '/index.js'].map(
          (suffix) => `${path}${suffix}`,
        ),
      ].find((candidate) => sources.has(candidate));
      if (!resolved) continue;
      const dependents = graph.get(resolved) ?? new Set();
      dependents.add(file);
      graph.set(resolved, dependents);
    }
  }
  return graph;
}
export async function loadImpactGraph() {
  const sources = new Map();
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && code.test(path)) sources.set(path, await readFile(path, 'utf8'));
    }
  }
  await Promise.all(['src', 'web', 'packages/lody-sdk/src'].map(visit));
  return reverseDependencies(sources);
}
export function affectedImporters(paths, graph) {
  const affected = new Set(paths);
  const queue = [...paths];
  while (queue.length) {
    const path = queue.shift();
    for (const importer of graph?.get(path) ?? []) {
      if (!affected.has(importer)) {
        affected.add(importer);
        queue.push(importer);
      }
    }
  }
  return affected;
}
