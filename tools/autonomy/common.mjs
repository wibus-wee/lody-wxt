import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

export const shaPattern = /^[a-f0-9]{40}$/;
export const hashPattern = /^[a-f0-9]{64}$/;
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export const digest = (value) =>
  createHash('sha256')
    .update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value))
    .digest('hex');
// Artifact paths intentionally reject ASCII control characters.
// eslint-disable-next-line no-control-regex
const controlCharacters = /[\x00-\x1F\x7F]/;
export function safePath(path) {
  assert.equal(typeof path, 'string');
  assert.ok(
    path.length > 0 &&
      path.length < 500 &&
      !path.startsWith('/') &&
      !path.includes('\\') &&
      !controlCharacters.test(path),
    'Unsafe artifact path',
  );
  assert.ok(
    path.split('/').every((part) => part !== '..' && part !== '.'),
    'Unsafe artifact traversal',
  );
  return path;
}
const githubAttachmentPath = /^\/user-attachments\/assets\/[\w-]+$/;
export function isGitHubAttachment(url) {
  return (
    url.protocol === 'https:' &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    !url.port &&
    ((url.hostname === 'github.com' && githubAttachmentPath.test(url.pathname)) ||
      url.hostname === 'user-images.githubusercontent.com' ||
      url.hostname === 'github-production-user-asset-6210df.s3.amazonaws.com')
  );
}

export function text(value, field) {
  assert.ok(
    typeof value === 'string' && value.trim().length > 0 && value.length <= 10000,
    `${field} must be meaningful text`,
  );
  return value;
}
export function parsePolicy(raw) {
  // JSON is a YAML subset, so trusted runners need no parser dependency installation.
  // Keep the protected .yml policy excluded in .oxfmtrc.json: YAML formatting can
  // introduce single quotes or trailing commas that this JSON parser must reject.
  const policy = JSON.parse(raw);
  assert.equal(policy.schemaVersion, 1);
  assert.ok(policy.repository && policy.protectedPrefixes?.length && policy.requiredChecks?.length);
  return { ...policy, version: digest(raw) };
}
export function boundedJSON(raw, max = 2_000_000) {
  assert.ok(Buffer.byteLength(raw) <= max, 'Untrusted JSON exceeds size bound');
  return JSON.parse(raw);
}
