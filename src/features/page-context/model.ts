export interface PageContext {
  id: string;
  kind: 'page' | 'selection';
  title: string;
  url: string;
  text: string;
  trust: 'untrusted';
}

const repositoryName = /^[\w.-]+$/;
const gitSuffix = /\.git$/;
export function githubRepository(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'github.com' || parsed.protocol !== 'https:') return undefined;
    const [owner, repo] = parsed.pathname.split('/').filter(Boolean);
    if (!owner || !repo || !repositoryName.test(owner + repo)) return undefined;
    return `${owner}/${repo.replace(gitSuffix, '')}`;
  } catch {
    return undefined;
  }
}
