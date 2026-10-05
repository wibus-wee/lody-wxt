import defaultMDXComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import type { ComponentProps } from 'react';

import { Diagram } from './Diagram';
import { source } from './source';

type Page = ReturnType<typeof source.getPages>[number];
const absoluteScheme = /^[a-z][a-z\d+.-]*:/i;

export function getMDXComponents(page: Page): MDXComponents {
  function ContentLink({ href, ...props }: ComponentProps<'a'>) {
    let resolved = href;
    if (href && !absoluteScheme.test(href) && !href.startsWith('//')) {
      // Fumadocs resolves content files. Repository links leave the documentation site.
      const file = new URL(href, `https://repo.local/docs/contents/${page.path}`);
      resolved =
        href.startsWith('#') ||
        href.startsWith('/docs') ||
        file.pathname.startsWith('/docs/contents/')
          ? source.resolveHref(href, page)
          : `https://github.com/wibus-wee/lody-wxt/blob/main${file.pathname}${file.hash}`;
    }
    const Anchor = defaultMDXComponents.a;
    return <Anchor {...props} href={resolved} />;
  }
  return { ...defaultMDXComponents, Diagram, a: ContentLink };
}
