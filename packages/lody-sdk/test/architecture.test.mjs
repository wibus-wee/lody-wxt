import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const root = fileURLToPath(new URL('../src/', import.meta.url));

async function sources(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory()
        ? sources(resolve(directory, entry.name))
        : entry.name.endsWith('.ts')
          ? [resolve(directory, entry.name)]
          : [],
    ),
  );
  return nested.flat();
}

function imports(source) {
  const specifiers = [];
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      specifiers.push(node.argument.literal.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      assert.ok(
        ts.isStringLiteral(node.arguments[0]),
        'Dynamic SDK imports must have a literal target',
      );
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specifiers;
}

test('DDD dependency direction, context boundaries and acyclic imports are enforced', async () => {
  const graph = new Map();
  for (const file of await sources(root)) {
    const name = relative(root, file);
    const [context, layer] = name.split('/');
    const dependencies = imports(
      ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest),
    );
    const edges = [];
    for (const specifier of dependencies) {
      const label = `${name} -> ${specifier}`;
      if (!specifier.startsWith('.')) {
        assert.ok(
          layer !== 'domain' && layer !== 'application',
          `External library in inner layer: ${label}`,
        );
        continue;
      }
      const target = relative(root, resolve(dirname(file), specifier.replace(/\.js$/, '.ts')));
      const [targetContext, targetLayer] = target.split('/');
      if (['domain', 'application', 'infrastructure'].includes(layer)) {
        assert.ok(
          ['domain', 'application', 'infrastructure'].includes(targetLayer),
          `Inner layer imports composition root: ${label}`,
        );
        if (layer === 'domain')
          assert.equal(targetLayer, 'domain', `Domain depends on an outer layer: ${label}`);
        if (layer === 'application')
          assert.notEqual(
            targetLayer,
            'infrastructure',
            `Application depends on adapter: ${label}`,
          );
        if (context === 'shared')
          assert.equal(targetContext, 'shared', `Shared kernel depends on context: ${label}`);
        else if (targetContext !== context && targetContext !== 'shared') {
          assert.ok(
            context === 'streams' && target === 'workspaces/domain/workspace-id.ts',
            `Undeclared context dependency: ${label}`,
          );
        }
      }
      edges.push(target);
    }
    graph.set(name, edges);
  }
  const visited = new Set();
  const active = new Set();
  function visit(file) {
    assert.ok(graph.has(file), `Import does not resolve to SDK source: ${file}`);
    assert.ok(!active.has(file), `Circular SDK import at ${file}`);
    if (visited.has(file)) return;
    active.add(file);
    for (const dependency of graph.get(file)) visit(dependency);
    active.delete(file);
    visited.add(file);
  }
  for (const file of graph.keys()) visit(file);
});
