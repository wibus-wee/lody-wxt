import '../src/app/global.css';

import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router';

import { Documentation } from './Documentation';
const root = document.getElementById('root');
if (!root) throw new Error('Missing documentation root');
createRoot(root).render(
  <HashRouter>
    <Documentation />
  </HashRouter>,
);
