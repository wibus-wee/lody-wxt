import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';

import { boundedJSON } from './common.mjs';

const repositoryName = /^[\w.-]+\/[\w.-]+$/;
export class GitHub {
  constructor(token, repo) {
    assert.ok(token && repositoryName.test(repo));
    this.token = token;
    this.repo = repo;
  }
  async request(path, { method = 'GET', body, raw = false } = {}) {
    assert.ok(path.startsWith('/') && !path.includes('..'));
    const response = await fetch(`https://api.github.com${path}`, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok)
      throw new Error(`GitHub ${method} ${path.split('?')[0]}: HTTP ${response.status}`);
    if (response.status === 204) return null;
    const data = await response.text();
    assert.ok(Buffer.byteLength(data) < 20_000_000, 'GitHub response exceeds bound');
    return raw ? data : boundedJSON(data, 20_000_000);
  }
  api(path, options) {
    return this.request(`/repos/${this.repo}${path}`, options);
  }
  async pages(path, key) {
    const all = [];
    for (let page = 1; page <= 30; page++) {
      const result = await this.api(
        `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`,
      );
      const items = key ? result[key] : result;
      assert.ok(Array.isArray(items));
      all.push(...items);
      if (items.length < 100) return all;
    }
    throw new Error('GitHub pagination truncated; escalate');
  }
  async content(path, ref) {
    const result = await this.api(`/contents/${path}?ref=${encodeURIComponent(ref)}`);
    assert.equal(result.encoding, 'base64');
    return Buffer.from(result.content, 'base64').toString('utf8');
  }
  async artifact(id) {
    // First redirect is authenticated to GitHub. Never forward a token to the signed storage URL.
    const redirect = await fetch(
      `https://api.github.com/repos/${this.repo}/actions/artifacts/${id}/zip`,
      {
        redirect: 'manual',
        signal: AbortSignal.timeout(30000),
        headers: { Authorization: `Bearer ${this.token}` },
      },
    );
    assert.equal(redirect.status, 302, 'Artifact download unavailable');
    const url = new URL(redirect.headers.get('location'));
    assert.equal(url.protocol, 'https:');
    assert.ok(!url.username && !url.password);
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(60000) });
    assert.ok(response.ok, 'Artifact storage unavailable');
    const chunks = [];
    let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      assert.ok(length <= 200_000_000, 'Artifact exceeds compressed bound');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
}
