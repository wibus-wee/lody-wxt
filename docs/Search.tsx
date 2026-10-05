import DefaultSearchDialog from 'fumadocs-ui/components/dialog/search-default';
import type { SharedProps } from 'fumadocs-ui/contexts/search';
import { useLocation } from 'react-router';

export function DocsSearchDialog(props: SharedProps) {
  const { pathname } = useLocation();
  const api = pathname.startsWith('/docs/dev') ? '/docs-dev-search.json' : '/docs-search.json';
  return <DefaultSearchDialog key={api} {...props} type="static" api={api} />;
}
