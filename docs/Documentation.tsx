import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import type { TOCPopoverProps } from 'fumadocs-ui/layouts/docs/page/slots/toc';
import { TOC, TOCPopover, TOCProvider } from 'fumadocs-ui/layouts/docs/page/slots/toc';
import { useEffect } from 'react';
import { Link, useLocation } from 'react-router';

import { getMDXComponents } from './mdx';
import { source } from './source';

const tree = source.getPageTree();
const productTree = {
  ...tree,
  $id: 'product',
  children: tree.children.filter(
    (node) => node.type !== 'folder' || node.index?.url !== '/docs/dev',
  ),
};

function MobileTOC(props: TOCPopoverProps) {
  return (
    <nav aria-label="本页目录" className="contents xl:hidden">
      <TOCPopover {...props} />
    </nav>
  );
}

const pageSlots = { toc: { provider: TOCProvider, main: TOC, popover: MobileTOC } };

export function Documentation() {
  const location = useLocation();
  const page = source.getPage(location.pathname.slice('/docs'.length).split('/').filter(Boolean));
  useEffect(() => {
    document.title = `${page?.data.title ?? '找不到文档'} · Lody`;
    const frame = requestAnimationFrame(() => {
      if (location.hash) {
        document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
      } else window.scrollTo(0, 0);
    });
    return () => cancelAnimationFrame(frame);
  }, [page, location.hash]);

  const Content = page?.data.body;
  return (
    <DocsLayout
      tree={location.pathname.startsWith('/docs/dev') ? tree : productTree}
      nav={{ title: 'Lody · 使用文档', url: '/docs' }}
      links={[
        { text: '产品文档', url: '/docs', active: 'none' },
        { text: '开发资料', url: '/docs/dev', active: 'nested-url' },
      ]}
      sidebar={{ defaultOpenLevel: 1 }}
      themeSwitch={{ mode: 'light-dark-system' }}
    >
      <DocsPage
        key={page?.url ?? location.pathname}
        toc={page?.data.toc ?? []}
        slots={pageSlots}
        tableOfContent={{ container: { role: 'navigation', 'aria-label': '本页目录' } }}
      >
        <DocsTitle>{page?.data.title ?? '找不到这篇文档'}</DocsTitle>
        {page && <DocsDescription>{page.data.description}</DocsDescription>}
        <DocsBody>
          {Content && page ? (
            <Content components={getMDXComponents(page)} />
          ) : (
            <p>
              请从导航选择文档，或<Link to="/docs">返回首页</Link>。
            </p>
          )}
        </DocsBody>
      </DocsPage>
    </DocsLayout>
  );
}
