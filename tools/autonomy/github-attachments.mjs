import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

import { digest, isGitHubAttachment, shaPattern } from './common.mjs';

const execute = promisify(execFile);
const pngPath = /^[\w-]+\.png$/;
const repositoryName = /^[\w.-]+\/[\w.-]+$/;
const supportedToken = /^(?:github_pat_|ghp_|gho_|ghu_)/;
const attachFlag = /--attach\b/;
const start = '<!-- autonomous-ui-evidence:start -->';
const end = '<!-- autonomous-ui-evidence:end -->';
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function pendingBody(body, lines) {
  const begin = body.indexOf(start);
  const finish = body.indexOf(end);
  const block = `${start}\nScreenshot publication pending; acceptance has not been granted.\n${lines.join('\n')}\n${end}`;
  let updated;
  if (begin === -1 && finish === -1) updated = `${body}${body ? '\n\n' : ''}${block}`;
  else {
    assert.ok(
      begin >= 0 &&
        finish > begin &&
        !body.includes(start, begin + start.length) &&
        !body.includes(end, finish + end.length),
      'Ambiguous UI evidence markers',
    );
    updated = body.slice(0, begin) + block + body.slice(finish + end.length);
  }
  assert.ok(Buffer.byteLength(updated) <= 60000, 'PR body exceeds evidence size bound');
  return updated;
}

async function assertCurrent(github, pr, headSha, baseSha) {
  const current = await github.api(`/pulls/${pr.number}`);
  assert.equal(current.head.sha, headSha, 'Head changed during attachment publication');
  assert.equal(current.base.sha, baseSha, 'Base changed during attachment publication');
  assert.equal(
    current.body ?? '',
    pr.body ?? '',
    'PR body changed concurrently; retry without overwriting author content',
  );
}

export async function verifyGitHubAttachment(url, capture, policy, fetchImpl = fetch) {
  let destination = new URL(url);
  assert.ok(
    isGitHubAttachment(destination) &&
      policy.screenshot.allowedImageHosts.includes(destination.hostname),
    'Screenshot must use a durable GitHub attachment, never a repository image',
  );
  const signal = AbortSignal.timeout(30000);
  let response;
  for (let redirects = 0; ; redirects++) {
    response = await fetchImpl(destination, { redirect: 'manual', credentials: 'omit', signal });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    await response.body?.cancel();
    const location = response.headers.get('location');
    assert.ok(redirects < 3 && location, 'GitHub attachment redirect limit or location invalid');
    const next = new URL(location, destination);
    const trusted = new URL(next);
    // CDN signatures are transient download parameters; the PR keeps the durable original URL.
    trusted.search = '';
    assert.ok(
      isGitHubAttachment(trusted) && policy.screenshot.allowedImageHosts.includes(next.hostname),
      'GitHub attachment redirect host or path not allowed',
    );
    destination = next;
  }
  assert.ok(response.ok, 'GitHub attachment is not viewable');
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    assert.ok(length <= 10000000, 'Published screenshot exceeds bound');
    chunks.push(chunk);
  }
  assert.equal(
    digest(Buffer.concat(chunks)),
    capture.contentHash,
    'GitHub attachment bytes do not match actual capture',
  );
}

// Upload through the supported CLI rather than an external publisher or a Git branch.
// gh can update the body even on partial failure: never retry an ambiguous write here.
export async function publishGitHubAttachments({
  captures,
  readArtifact,
  github,
  pr,
  headSha,
  baseSha,
  policy,
  token,
  fetchImpl = fetch,
  runCommand = execute,
}) {
  assert.ok(repositoryName.test(github.repo ?? ''), 'Explicit GitHub repository required');
  assert.ok(Number.isSafeInteger(pr.number) && pr.number > 0, 'Explicit PR number required');
  const prHeadSha = pr.head.sha;
  assert.ok(
    shaPattern.test(headSha) && shaPattern.test(prHeadSha) && shaPattern.test(baseSha),
    'Authenticated candidate, PR head and base revisions required',
  );
  assert.ok(
    supportedToken.test(token ?? ''),
    'GitHub attachments require a supported user token; installation tokens are unsupported',
  );
  assert.ok(
    Array.isArray(captures) && captures.length > 0 && captures.length <= 128,
    'Screenshot capture count exceeds bound',
  );
  const images = captures.map((capture) => {
    assert.ok(pngPath.test(capture.path ?? ''), 'Invalid capture filename');
    const bytes = Buffer.from(readArtifact(capture.path));
    assert.ok(
      bytes.length > 0 && bytes.length <= 10000000 && digest(bytes) === capture.contentHash,
      'Capture content mismatch',
    );
    assert.ok(bytes.subarray(0, 8).equals(pngSignature), 'Capture is not a PNG');
    return {
      capture,
      bytes,
      label: `autonomy-upload-${digest([capture.path, capture.contentHash])}`,
    };
  });
  assert.equal(
    new Set(images.map(({ capture }) => capture.path)).size,
    images.length,
    'Duplicate screenshot filename',
  );
  const commandOptions = {
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      GH_TOKEN: token,
      GH_HOST: 'github.com',
      GH_PROMPT_DISABLED: '1',
      GH_PAGER: 'cat',
    },
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 1000000,
  };
  const help = await runCommand('gh', ['pr', 'edit', '--help'], commandOptions);
  assert.ok(attachFlag.test(help.stdout), 'Installed GitHub CLI must support gh pr edit --attach');
  // Scratch files live outside the checkout and are always removed, including on failure.
  const directory = await mkdtemp(join(tmpdir(), 'lody-pr-attachments-'));
  const receipts = [];
  try {
    for (const { capture, bytes } of images)
      await writeFile(join(directory, capture.path), bytes, { mode: 0o600 });
    for (let offset = 0; offset < images.length; offset += 50) {
      const batch = images.slice(offset, offset + 50);
      const references = batch.map(({ capture, label }) => ({
        capture,
        label,
        path: join(directory, capture.path),
      }));
      const lines = [
        ...receipts.map((receipt) => `![${receipt.label}](${receipt.url})`),
        ...references.map(({ label, path }) => `![${label}](${path})`),
      ];
      const prepared = pendingBody(pr.body ?? '', lines);
      const bodyFile = join(directory, 'body.md');
      await writeFile(bodyFile, prepared, { mode: 0o600 });
      // A merge-queue candidate SHA differs from the PR's source head SHA.
      await assertCurrent(github, pr, prHeadSha, baseSha);
      const args = [
        'pr',
        'edit',
        String(pr.number),
        '--repo',
        github.repo,
        '--body-file',
        bodyFile,
      ];
      for (const { path } of references) args.push('--attach', path);
      let failed = false;
      try {
        await runCommand('gh', args, commandOptions);
      } catch {
        failed = true;
      }
      // Inspect the write even on nonzero exit; gh documents partial publication.
      const uploaded = await github.api(`/pulls/${pr.number}`);
      assert.equal(uploaded.head.sha, prHeadSha, 'Head changed during attachment publication');
      assert.equal(uploaded.base.sha, baseSha, 'Base changed during attachment publication');
      if (failed)
        throw new Error(
          'GitHub attachment upload failed; PR may contain partial uploads. Inspect the current body before retrying; no acceptance granted',
        );
      const body = uploaded.body ?? '';
      assert.ok(Buffer.byteLength(body) <= 60000, 'PR body exceeds evidence size bound');
      let restored = body;
      const batchReceipts = [];
      for (const { capture, label, path } of references) {
        const prefix = `![${label}](`;
        const begin = restored.indexOf(prefix);
        assert.ok(
          begin >= 0 && !restored.includes(prefix, begin + prefix.length),
          'Uploaded screenshot reference missing or duplicated',
        );
        const finish = restored.indexOf(')', begin + prefix.length);
        assert.ok(finish >= 0, 'Uploaded screenshot reference is malformed');
        const url = restored.slice(begin + prefix.length, finish);
        await verifyGitHubAttachment(url, capture, policy, fetchImpl);
        restored = `${restored.slice(0, begin)}${prefix}${path})${restored.slice(finish + 1)}`;
        batchReceipts.push({ path: capture.path, url, contentHash: capture.contentHash, label });
      }
      assert.equal(
        restored,
        prepared,
        'Attachment upload changed content beyond the expected image references',
      );
      receipts.push(...batchReceipts);
      pr.body = body;
    }
    return receipts.map((receipt) => ({
      path: receipt.path,
      url: receipt.url,
      contentHash: receipt.contentHash,
    }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
