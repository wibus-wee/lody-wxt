import '@excalidraw/excalidraw/index.css';
import './styles.css';

import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';

import { Documentation } from './Documentation';
import { DocsRoot } from './Root';

// Keep existing hash bookmarks while giving headings native fragment URLs.
if (window.location.pathname === '/' && window.location.hash.startsWith('#/docs')) {
  window.history.replaceState(null, '', window.location.hash.slice(1));
}
const router = createBrowserRouter([
  {
    Component: DocsRoot,
    children: [
      { path: '/', element: <Navigate to="/docs" replace /> },
      ...[
        'architecture',
        'design',
        'testing',
        'browser-assistant-spec',
        'browser-assistant-implementation',
      ].map((slug) => ({
        path: `/docs/${slug}`,
        element: <Navigate to={`/docs/dev/${slug}`} replace />,
      })),
      { path: '/docs/*', Component: Documentation },
    ],
  },
]);
const root = document.getElementById('root');
if (!root) throw new Error('Missing documentation root');
createRoot(root).render(<RouterProvider router={router} />);
