import { installFocusModality } from '@lody/ui/focus-modality';
import { text } from '@lody/ui/tokens/scales.stylex';
import * as stylex from '@stylexjs/stylex';
import { lazy, Suspense, useEffect } from 'react';
import { NavLink, Route, Routes } from 'react-router';

import { Chat } from '../features/chat/Chat';
import { Popup } from '../features/connection/Popup';
import { Settings } from '../features/connection/Settings';
import { usePreferences } from '../features/preferences/use-preferences';
import { Icon } from '../shared/icons/Icon';
import { Alert, Badge, Button, ThemeRoot, Tooltip } from '../shared/ui';
import { composer, composerDark, composerLight } from '../shared/ui/composer.stylex';
import { syntaxDark, syntaxLight } from '../shared/ui/message.tokens.stylex';
import { readableFeedbackTheme, readableFieldTheme } from '../shared/ui/readable.stylex';

const Ambient = lazy(() =>
  import('../features/ambient/Ambient').then((module) => ({ default: module.Ambient })),
);
const Introduction = lazy(() =>
  import('../features/introduction/Introduction').then((module) => ({
    default: module.Introduction,
  })),
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
  header: { display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', flexShrink: 0 },
  brand: {
    margin: 0,
    fontSize: text.headlineSize,
    lineHeight: text.headlineLeading,
    letterSpacing: text.controlTracking,
    fontWeight: 600,
  },
  nav: { display: 'flex', alignItems: 'center', gap: 4 },
  page: { paddingInline: 20, overflowY: 'auto', minHeight: 0, flex: 1 },
  route: { display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 },
  status: { marginInlineStart: 'auto' },
});

export function App({ surface = 'web' }: { surface?: 'popup' | 'options' | 'sidepanel' | 'web' }) {
  const { preferences, query, mutation } = usePreferences();
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
  return (
    <ThemeRoot mode={preferences.theme}>
      <Tooltip.Provider>
        <div {...stylex.props(styles.canvas, surface === 'popup' && styles.popupCanvas)}>
          <main
            {...stylex.props(
              styles.shell,
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
            <header {...stylex.props(styles.header)}>
              <Button
                nativeButton={false}
                // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- NavLink renders an anchor; override Base UI's non-native button role.
                role="link"
                variant="ghost"
                size="small"
                icon
                render={<NavLink to="/" aria-label="Workspace" />}
              >
                <Icon name="chat" size={18} />
              </Button>
              <h1 {...stylex.props(styles.brand)}>Lody</h1>
              <span {...stylex.props(styles.status)}>
                <Badge tone={preferences.mode === 'demo' ? 'neutral' : 'warning'}>
                  {preferences.mode === 'demo' ? '演示模式' : '真实 Lody · 未连接'}
                </Badge>
              </span>
              {surface !== 'popup' && (
                <nav aria-label="Main" {...stylex.props(styles.nav)}>
                  <Tooltip.Root>
                    <Tooltip.Trigger
                      render={
                        <Button
                          nativeButton={false}
                          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- NavLink renders an anchor; override Base UI's non-native button role.
                          role="link"
                          variant="ghost"
                          size="small"
                          icon
                          render={<NavLink to="/settings" aria-label="Settings" />}
                        />
                      }
                    >
                      <Icon name="settings" size={16} />
                    </Tooltip.Trigger>
                    <Tooltip.Content>设置</Tooltip.Content>
                  </Tooltip.Root>
                  <Tooltip.Root>
                    <Tooltip.Trigger
                      render={
                        <Button
                          nativeButton={false}
                          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- NavLink renders an anchor; override Base UI's non-native button role.
                          role="link"
                          variant="ghost"
                          size="small"
                          icon
                          render={<NavLink to="/intro" aria-label="Intro" />}
                        />
                      }
                    >
                      <Icon name="page" size={16} />
                    </Tooltip.Trigger>
                    <Tooltip.Content>使用指南</Tooltip.Content>
                  </Tooltip.Root>
                </nav>
              )}
            </header>
            {mutation.isError && (
              <Alert.Root tone="danger">
                <Alert.Description>
                  Could not save your preferences. Please try again.
                </Alert.Description>
              </Alert.Root>
            )}
            <div {...stylex.props(styles.route)}>
              {surface === 'popup' ? (
                <div {...stylex.props(styles.page)}>
                  <Popup />
                </div>
              ) : (
                <Routes>
                  <Route
                    path="/"
                    element={
                      surface === 'options' ? (
                        <div {...stylex.props(styles.page)}>
                          <Settings
                            preferences={preferences}
                            onSave={mutation.mutate}
                            pending={mutation.isPending}
                          />
                        </div>
                      ) : (
                        <Chat />
                      )
                    }
                  />
                  <Route
                    path="/settings"
                    element={
                      <div {...stylex.props(styles.page)}>
                        <Settings
                          preferences={preferences}
                          onSave={mutation.mutate}
                          pending={mutation.isPending}
                        />
                      </div>
                    }
                  />
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
                        <NavLink to="/">Back to workspace</NavLink>
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
