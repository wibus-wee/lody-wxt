import { RootProvider } from 'fumadocs-ui/provider/react-router';
import { Outlet } from 'react-router';

import { DocsSearchDialog } from './Search';
import { translations } from './translations';

export function DocsRoot() {
  return (
    <RootProvider
      theme={{ defaultTheme: 'system', enableSystem: true, disableTransitionOnChange: true }}
      i18n={{ locale: 'zh-CN', translations }}
      search={{ SearchDialog: DocsSearchDialog }}
    >
      <Outlet />
    </RootProvider>
  );
}
