import * as v from 'valibot';

const webUrlSchema = v.pipe(
  v.string(),
  v.url(),
  v.check((value) => {
    const url = new URL(value);
    return new Set(['https:', 'http:']).has(url.protocol) && !url.username && !url.password;
  }),
);

export const pageContextSchema = v.strictObject({
  id: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
  kind: v.picklist(['page', 'selection', 'link']),
  title: v.pipe(v.string(), v.maxLength(200)),
  url: webUrlSchema,
  text: v.pipe(v.string(), v.minLength(1), v.maxLength(32_000)),
  trust: v.literal('untrusted'),
  capturedAt: v.exactOptional(v.pipe(v.string(), v.isoTimestamp())),
  truncated: v.exactOptional(v.boolean()),
  sourceLength: v.exactOptional(v.pipe(v.number(), v.integer(), v.minValue(0))),
  tabId: v.exactOptional(v.pipe(v.number(), v.integer(), v.minValue(0))),
  frameId: v.exactOptional(v.pipe(v.number(), v.integer(), v.minValue(0))),
  documentId: v.exactOptional(v.string()),
  sourceRevision: v.exactOptional(v.string()),
});

export type PageContext = v.InferOutput<typeof pageContextSchema>;

export function parsePageContext(value: unknown): PageContext {
  return v.parse(pageContextSchema, value);
}

const capturedPageContextSchema = v.strictObject({
  url: webUrlSchema,
  title: v.pipe(v.string(), v.maxLength(200)),
  selection: v.pipe(v.string(), v.maxLength(32_000)),
});

export type CapturedPageContext = v.InferOutput<typeof capturedPageContextSchema>;

export function parseCapturedPageContext(value: unknown): CapturedPageContext {
  return v.parse(capturedPageContextSchema, value);
}

const repositoryName = /^[\w.-]+$/;
const gitSuffix = /\.git$/;
export function githubRepository(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'github.com' || parsed.protocol !== 'https:') return undefined;
    const [owner, repo] = parsed.pathname.split('/').filter(Boolean);
    if (!owner || !repo || !repositoryName.test(owner) || !repositoryName.test(repo))
      return undefined;
    const name = repo.replace(gitSuffix, '');
    return name ? `${owner}/${name}` : undefined;
  } catch {
    return undefined;
  }
}
