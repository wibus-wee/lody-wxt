import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { access, readFile } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { test } from 'node:test';

import { digest } from './common.mjs';
import { publishGitHubAttachments } from './github-attachments.mjs';

const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const imageReference = /!\[([^\]]+)\]\(([^)]+)\)/g;
function fixture(count = 2, config = {}) {
  const pr = {
    number: 23,
    head: { sha: 'a'.repeat(40) },
    base: { sha: 'b'.repeat(40) },
    body: 'Author introduction\n<!-- autonomous-ui-evidence:start -->\nold evidence\n<!-- autonomous-ui-evidence:end -->\nAuthor footer',
  };
  const remote = structuredClone(pr);
  const calls = [];
  const captures = Array.from({ length: count }, (_, index) => ({
    path: `capture-${index}.png`,
    contentHash: digest(bytes),
  }));
  const options = {
    captures,
    pr,
    headSha: pr.head.sha,
    baseSha: pr.base.sha,
    token: 'github_pat_fixture',
    policy: { screenshot: { allowedImageHosts: ['github.com'] } },
    github: {
      repo: 'owner/repo',
      api: async () => structuredClone(remote),
    },
    readArtifact: () => bytes,
    fetchImpl: async () => new Response(config.downloadBytes ?? bytes),
    runCommand: async (command, args, settings) => {
      assert.equal(command, 'gh');
      assert.equal(settings.env.GH_TOKEN, options.token);
      assert.equal(settings.env.AUTONOMY_APP_PRIVATE_KEY, undefined);
      assert.equal(settings.env.DOTS_TOKEN, undefined);
      if (args.includes('--help'))
        return { stdout: config.oldCli ? 'Edit a pull request' : '--attach file' };
      calls.push(args);
      assert.deepEqual(args.slice(0, 6), [
        'pr',
        'edit',
        '23',
        '--repo',
        'owner/repo',
        '--body-file',
      ]);
      const bodyFile = args[6];
      assert.ok(isAbsolute(bodyFile));
      let body = await readFile(bodyFile, 'utf8');
      for (let index = 7; index < args.length; index += 2) {
        assert.equal(args[index], '--attach');
        const path = args[index + 1];
        assert.equal(dirname(path), dirname(bodyFile));
        assert.deepEqual(await readFile(path), bytes);
        const url =
          config.url ?? `https://github.com/user-attachments/assets/${calls.length}-${index}`;
        body = body.replace(`](${path})`, `](${url})`);
        if (config.partial) break;
      }
      remote.body = config.editAuthor
        ? body.replace('Author introduction', 'Changed by someone else')
        : body;
      if (config.changeHead) remote.head.sha = 'c'.repeat(40);
      if (config.partial) throw new Error('Upload transport failed');
      return { stdout: 'https://github.com/owner/repo/pull/23' };
    },
  };
  return { options, remote, calls };
}

test('gh uploads verified PNGs as PR attachments, preserving author content and removing scratch files', async () => {
  const { options, remote, calls } = fixture();
  const receipts = await publishGitHubAttachments(options);
  assert.equal(calls.length, 1);
  assert.equal(receipts.length, 2);
  assert.ok(remote.body.startsWith('Author introduction\n'));
  assert.ok(remote.body.endsWith('\nAuthor footer'));
  assert.ok(!remote.body.includes('old evidence'));
  assert.ok(!remote.body.includes('lody-pr-attachments-'));
  assert.equal(options.pr.body, remote.body);
  for (const receipt of receipts) {
    assert.equal(receipt.contentHash, digest(bytes));
    assert.ok(receipt.url.startsWith('https://github.com/user-attachments/assets/'));
  }
  await assert.rejects(access(dirname(calls[0][6])), { code: 'ENOENT' });
});

test('GitHub CDN redirects verify bytes without credentials while keeping the durable PR URL', async () => {
  const { options, remote } = fixture(1);
  const host = 'github-production-user-asset-6210df.s3.amazonaws.com';
  options.policy.screenshot.allowedImageHosts.push(host);
  const requests = [];
  options.fetchImpl = async (url, settings) => {
    requests.push(url.href);
    assert.equal(settings.redirect, 'manual');
    assert.equal(settings.credentials, 'omit');
    assert.equal(settings.headers, undefined);
    return url.hostname === 'github.com'
      ? new Response(null, {
          status: 302,
          headers: { location: `https://${host}/fixture.png?signature=fixture` },
        })
      : new Response(bytes);
  };
  const [receipt] = await publishGitHubAttachments(options);
  assert.equal(requests.length, 2);
  assert.ok(receipt.url.startsWith('https://github.com/user-attachments/assets/'));
  assert.ok(remote.body.includes(receipt.url));
  assert.ok(!remote.body.includes('signature='));
});

test('repository/foreign redirects and redirect loops cannot authorize screenshot publication', async () => {
  for (const location of [
    'https://github.com/owner/repo/raw/main/image.png',
    'https://raw.githubusercontent.com/owner/repo/main/image.png',
    'https://attacker.example/image.png',
    'http://github.com/user-attachments/assets/insecure',
  ]) {
    const { options } = fixture(1);
    let requests = 0;
    options.fetchImpl = async () => {
      requests++;
      return new Response(null, { status: 302, headers: { location } });
    };
    await assert.rejects(publishGitHubAttachments(options), /redirect host or path not allowed/);
    assert.equal(requests, 1);
  }
  const { options } = fixture(1);
  let requests = 0;
  options.fetchImpl = async () => {
    requests++;
    return new Response(null, {
      status: 302,
      headers: { location: 'https://github.com/user-attachments/assets/loop' },
    });
  };
  await assert.rejects(publishGitHubAttachments(options), /redirect limit/);
  assert.equal(requests, 4);
});

test('merge-queue candidate identity is distinct from the current PR source head', async () => {
  const { options, calls } = fixture();
  options.headSha = 'd'.repeat(40);
  const receipts = await publishGitHubAttachments(options);
  assert.equal(receipts.length, 2);
  assert.equal(calls.length, 1);
  assert.equal(options.pr.head.sha, 'a'.repeat(40));
});

test('more than 50 images use bounded CLI batches and retain every previously uploaded reference', async () => {
  const { options, remote, calls } = fixture(51);
  const receipts = await publishGitHubAttachments(options);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].filter((arg) => arg === '--attach').length, 50);
  assert.equal(calls[1].filter((arg) => arg === '--attach').length, 1);
  assert.equal(receipts.length, 51);
  assert.equal([...remote.body.matchAll(imageReference)].length, 51);
});

test('CLI capability, token type, PNG hash and filename are checked before modifying the PR', async () => {
  for (const mutate of [
    (o) => {
      o.token = 'ghs_unsupported';
    },
    (o) => {
      o.captures[0].path = '../injected.png';
    },
    (o) => {
      o.captures[0].contentHash = 'f'.repeat(64);
    },
    (o) => {
      o.readArtifact = () => Buffer.from('fake image');
    },
  ]) {
    const { options, calls } = fixture();
    mutate(options);
    await assert.rejects(publishGitHubAttachments(options));
    assert.equal(calls.length, 0);
  }
  const { options, calls } = fixture(2, { oldCli: true });
  await assert.rejects(publishGitHubAttachments(options), /must support gh pr edit --attach/);
  assert.equal(calls.length, 0);
});

test('stale PR body and source revisions block publication before a CLI write', async () => {
  for (const field of ['body', 'head', 'base']) {
    const { options, remote, calls } = fixture();
    if (field === 'body') remote.body += '\nConcurrent edit';
    else remote[field].sha = 'c'.repeat(40);
    await assert.rejects(publishGitHubAttachments(options), /changed/);
    assert.equal(calls.length, 0);
  }
});

test('repository images, transient URLs, foreign hosts and mismatched downloaded bytes cannot satisfy publication', async () => {
  for (const config of [
    { url: 'https://github.com/owner/repo/blob/main/candidate.png' },
    { url: 'https://github.com/owner/repo/raw/main/candidate.png' },
    { url: 'https://github.com/user-attachments/assets/id?temporary=1' },
    { url: 'https://attacker.example/image.png' },
    { downloadBytes: Buffer.from('forged') },
  ]) {
    const { options } = fixture(2, config);
    await assert.rejects(publishGitHubAttachments(options));
  }
});

test('partial CLI failure is inspected and preserved, never automatically retried or accepted', async () => {
  const { options, remote, calls } = fixture(2, { partial: true });
  await assert.rejects(publishGitHubAttachments(options), /may contain partial uploads/);
  assert.equal(calls.length, 1);
  assert.ok(remote.body.includes('https://github.com/user-attachments/assets/'));
  assert.notEqual(options.pr.body, remote.body);
  await assert.rejects(access(dirname(calls[0][6])), { code: 'ENOENT' });
});

test('unexpected author edits and a head change during upload fail closed', async () => {
  for (const config of [{ editAuthor: true }, { changeHead: true }]) {
    const { options } = fixture(2, config);
    await assert.rejects(publishGitHubAttachments(options), /changed/);
  }
});
