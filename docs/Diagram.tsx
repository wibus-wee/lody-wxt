/* oxlint-disable jsx-a11y/prefer-tag-over-role, jsx-a11y/no-redundant-roles -- Canvas figures use an image role; render anchors override Button's default button role. */
/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- The figure scroll region must be reachable for keyboard scrolling. */
import type { ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types';
import * as stylex from '@stylexjs/stylex';
import { useTheme } from 'next-themes';
import type { ComponentProps } from 'react';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';

import metadata from './diagrams/metadata.json';

window.EXCALIDRAW_ASSET_PATH = new URL('/excalidraw/', window.location.origin).href;

const Excalidraw = lazy(() =>
  import('@excalidraw/excalidraw').then((module) => ({ default: module.Excalidraw })),
);
type Scene = Pick<ExcalidrawInitialDataState, 'elements' | 'appState' | 'files'>;
type DiagramAPI = Parameters<NonNullable<ComponentProps<typeof Excalidraw>['excalidrawAPI']>>[0];
const scenes = import.meta.glob<Scene>('./diagrams/*.excalidraw.json', { import: 'default' });

const styles = stylex.create({
  figure: { marginBlock: 28, marginInline: 0 },
  scroll: { overflowX: 'auto', borderRadius: 12, border: '1px solid light-dark(#d4d9e1, #485364)' },
  canvas: (ratio: string) => ({
    width: '100%',
    minWidth: { default: 0, '@media (max-width: 767px)': 880 },
    aspectRatio: ratio,
  }),
  placeholder: { padding: 24 },
  caption: {
    marginTop: 10,
    fontSize: 12,
    color: 'light-dark(#4b596b, #bcc8d8)',
    textAlign: 'center',
    opacity: 0.6,
  },
  footer: { display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginTop: 8 },
});

function SceneView({ scene, theme }: { scene: Scene; theme: 'light' | 'dark' }) {
  const ref = useRef<HTMLDivElement>(null);
  const [api, setApi] = useState<DiagramAPI | null>(null);
  useEffect(() => {
    const node = ref.current;
    const elements = scene.elements;
    if (!node || !api || !elements) return;
    let frame = 0;
    const fit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        api.scrollToContent(elements, { fitToViewport: true, viewportZoomFactor: 0.96 }),
      );
    };
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    fit();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [api, scene]);
  return (
    <div ref={ref} className="docs-excalidraw">
      <Excalidraw
        initialData={{ ...scene, appState: { ...scene.appState, theme } }}
        excalidrawAPI={setApi}
        viewModeEnabled
        gridModeEnabled={false}
        zenModeEnabled
        theme={theme}
        langCode="zh-CN"
        UIOptions={{
          canvasActions: {
            loadScene: false,
            saveToActiveFile: false,
            export: false,
            changeViewBackgroundColor: false,
            toggleTheme: false,
          },
        }}
      />
    </div>
  );
}

export function Diagram({ id }: { id: string }) {
  const entry = metadata[id as keyof typeof metadata];
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === 'dark' ? 'dark' : 'light';
  const [loaded, setLoaded] = useState<{ path: string; scene: Scene } | null>(null);
  const [error, setError] = useState<{ path: string; message: string } | null>(null);
  const path = `./diagrams/${id}.${theme}.excalidraw.json`;

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((item) => item.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '300px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    const load = scenes[path];
    if (!load) throw new Error(`Missing documentation scene: ${path}`);
    void load()
      .then((scene) => {
        if (active) {
          setLoaded({ path, scene });
          setError(null);
        }
      })
      .catch((cause: Error) => {
        if (active) setError({ path, message: cause.message });
      });
    return () => {
      active = false;
    };
  }, [visible, path, id]);

  if (!entry) throw new Error(`Unknown documentation diagram: ${id}`);
  const scene = loaded?.path === path ? loaded.scene : null;
  const failure = error?.path === path ? error.message : null;
  return (
    <figure ref={ref} {...stylex.props(styles.figure)}>
      <section {...stylex.props(styles.scroll)} aria-label={entry.title} tabIndex={0}>
        <div
          role="img"
          aria-label={entry.alt}
          {...stylex.props(styles.canvas(`${entry.width} / ${entry.height}`))}
        >
          <div aria-hidden="true" inert className="docs-diagram-renderer">
            {failure ? (
              <p {...stylex.props(styles.placeholder)}>图未能加载：{failure}</p>
            ) : scene ? (
              <Suspense fallback={<p {...stylex.props(styles.placeholder)}>正在载入示意图…</p>}>
                <SceneView key={path} scene={scene} theme={theme} />
              </Suspense>
            ) : (
              <p {...stylex.props(styles.placeholder)}>正在载入示意图…</p>
            )}
          </div>
        </div>
      </section>
      <figcaption {...stylex.props(styles.caption)}>{entry.alt}</figcaption>
    </figure>
  );
}
