import * as stylex from '@stylexjs/stylex';
import { lazy, Suspense, useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router';
import { browser } from 'wxt/browser';

import { ChatHeader } from '../features/chat/ChatHeader';
import { Popup } from '../features/connection/Popup';
import { openSidePanel } from '../features/page-context/actions';
import { usePreferences } from '../features/preferences/use-preferences';
import { Alert, Button, installFocusModality, ThemeRoot, Tooltip } from '../shared/ui';
import { composer, composerDark, composerLight } from '../shared/ui/composer.stylex';
import { syntaxDark, syntaxLight } from '../shared/ui/message.tokens.stylex';
import { readableFeedbackTheme, readableFieldTheme } from '../shared/ui/readable.stylex';

// Every surface opens on the chat or the popup shell. The routes behind the header are
// loaded on demand so a cold open does not parse the workspace, conversations and account
// features, or the markdown renderer they pull in, before the first paint.
const Ambient = lazy(() =>
  import('../features/ambient/Ambient').then((module) => ({ default: module.Ambient })),
);
const Introduction = lazy(() =>
  import('../features/introduction/Introduction').then((module) => ({
    default: module.Introduction,
  })),
);
const AccountRoute = lazy(() =>
  import('../features/account/AccountPage').then((module) => ({ default: module.AccountPage })),
);
const SettingsRoute = lazy(() =>
  import('../features/connection/Settings').then((module) => ({ default: module.Settings })),
);
const Chat = lazy(() =>
  import('../features/chat/ConnectedChat').then((module) => ({ default: module.ConnectedChat })),
);
const styles = stylex.create({
  canvas: { backgroundColor: composer.canvas, minHeight: '100dvh' },
  popupCanvas: { minHeight: 0 },
  shell: {
    height: '100dvh',
    maxWidth: 760,
    marginInline: 'auto',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: composer.canvas,
    color: composer.label,
    position: 'relative',
    isolation: 'isolate',
  },
  popupShell: { height: 'auto' },
  page: { paddingInline: 20, overflowY: 'auto', minHeight: 0, flex: 1 },
  route: { display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 },
  hidden: { display: 'none' },
});
export function App({ surface = 'web' }: { surface?: 'popup' | 'options' | 'sidepanel' | 'web' }) {
  const { preferences, query, mutation } = usePreferences();
  const route = useLocation();
  const isChat = new Set(['web', 'sidepanel']).has(surface) && route.pathname === '/';
  const [popupError, setPopupError] = useState('');
  useEffect(() => installFocusModality(), []);
  if (query.isPending) return <main aria-busy="true">Loading Lody…</main>;
  if (query.isError)
    return (
      <main>
        <Alert.Root tone="danger">
          <Alert.Description>Could not load preferences.</Alert.Description>
          <Alert.Actions>
            <Button onClick={() => void query.refetch()}>Retry</Button>
          </Alert.Actions>
        </Alert.Root>
      </main>
    );
  const settings = (
    <div {...stylex.props(styles.page)}>
      <Suspense fallback={<p>Loading settings…</p>}>
        <SettingsRoute
          preferences={preferences}
          onSave={mutation.mutate}
          pending={mutation.isPending}
        />
      </Suspense>
    </div>
  );
  return (
    <ThemeRoot mode={preferences.theme}>
      <Tooltip.Provider>
        <div
          {...stylex.props(
            styles.canvas,
            surface === 'popup' && styles.popupCanvas,
            preferences.theme === 'dark' && composerDark,
            preferences.theme === 'light' && composerLight,
          )}
        >
          <main
            {...stylex.props(
              styles.shell,
              surface === 'popup' && styles.popupShell,
              readableFieldTheme,
              readableFeedbackTheme,
              preferences.theme === 'dark' && composerDark,
              preferences.theme === 'light' && composerLight,
              preferences.theme === 'dark' && syntaxDark,
              preferences.theme === 'light' && syntaxLight,
            )}
            data-mood={preferences.mood}
            data-theme={preferences.theme}
          >
            {preferences.ambient && (
              <Suspense fallback={null}>
                <Ambient />
              </Suspense>
            )}
            {!isChat && <ChatHeader />}
            {mutation.isError && (
              <Alert.Root tone="danger">
                <Alert.Description>
                  Could not save your preferences. Please try again.
                </Alert.Description>
              </Alert.Root>
            )}
            {new Set(['web', 'sidepanel']).has(surface) && (
              <div
                {...stylex.props(styles.route, !isChat && styles.hidden)}
                hidden={!isChat}
                aria-hidden={!isChat}
                inert={!isChat}
              >
                {/* Stays mounted while another route is active so chat state survives navigation. */}
                <Suspense fallback={<p>Loading chat…</p>}>
                  <Chat active={isChat} />
                </Suspense>
              </div>
            )}
            <div {...stylex.props(styles.route, isChat && styles.hidden)}>
              {surface === 'popup' ? (
                <div {...stylex.props(styles.page)}>
                  <Popup
                    disabled={location.protocol !== 'chrome-extension:'}
                    onOpenPanel={() => {
                      void openSidePanel().catch((reason) =>
                        setPopupError(reason instanceof Error ? reason.message : '无法打开侧栏。'),
                      );
                    }}
                    onOpenSettings={() => {
                      void browser.runtime
                        .openOptionsPage()
                        .catch(() => setPopupError('无法打开设置。'));
                    }}
                    feedback={
                      popupError && (
                        <Alert.Root tone="danger">
                          <Alert.Description>{popupError}</Alert.Description>
                        </Alert.Root>
                      )
                    }
                  />
                </div>
              ) : (
                <Routes>
                  <Route path="/" element={surface === 'options' ? settings : null} />
                  <Route
                    path="/account"
                    element={
                      <div {...stylex.props(styles.page)}>
                        <Suspense fallback={<p>Loading account…</p>}>
                          <AccountRoute />
                        </Suspense>
                      </div>
                    }
                  />
                  <Route path="/settings" element={settings} />
                  <Route
                    path="/intro"
                    element={
                      <Suspense fallback={<p>Loading introduction…</p>}>
                        <div {...stylex.props(styles.page)}>
                          <Introduction />
                        </div>
                      </Suspense>
                    }
                  />
                  <Route
                    path="*"
                    element={
                      <section>
                        <h2>Page not found</h2>
                        <Button variant="link" nativeButton={false} render={<NavLink to="/" />}>
                          Back to workspace
                        </Button>
                      </section>
                    }
                  />
                </Routes>
              )}
            </div>
          </main>
        </div>
      </Tooltip.Provider>
    </ThemeRoot>
  );
}
