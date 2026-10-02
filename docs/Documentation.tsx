import { Link, useLocation } from 'react-router';

import { source } from './source';

export function Documentation() {
  const location = useLocation();
  const page =
    source.getPages().find((page) => page.url === location.pathname) ?? source.getPage([]);
  if (!page)
    return (
      <main>
        <h1>Documentation not found</h1>
      </main>
    );
  const Content = page.data.body;
  return (
    <main style={{ maxWidth: 900, padding: 32, margin: 'auto' }}>
      <h1>Lody documentation</h1>
      <nav aria-label="Documentation" style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {source.getPages().map((item) => (
          <Link key={item.url} to={item.url}>
            {item.data.title}
          </Link>
        ))}
      </nav>
      <article>
        <h2>{page.data.title}</h2>
        <Content />
      </article>
    </main>
  );
}
