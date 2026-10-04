import * as stylex from '@stylexjs/stylex';

import { composer } from '../../shared/ui/composer.stylex';

export { shareSurface } from '../../../vendor/lody/packages/components/src/components/sharing/surface';
export const styles = stylex.create({
  figure: { margin: 0, minWidth: 0, fontSize: 12, overflowWrap: 'anywhere' },
  image: { width: '100%', maxHeight: 320, objectFit: 'contain' },
  panel: {
    display: 'flex',
    flexDirection: 'column',
    maxHeight: 'calc(100dvh - 24px)',
    minHeight: 0,
    gap: 14,
  },
  body: {
    overflowY: 'auto',
    minHeight: 0,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  stack: { display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 },
  row: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
  grow: { flex: 1, minWidth: 0 },
  footer: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    flexShrink: 0,
  },
  hint: {
    fontSize: 12,
    lineHeight: 1.5,
    color: composer.hint,
    margin: 0,
    overflowWrap: 'anywhere',
  },
  title: { margin: 0, fontSize: 14, fontWeight: 500, overflowWrap: 'anywhere' },
  preview: { minWidth: 0, fontSize: 13, lineHeight: 1.5 },
  raw: {
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    fontSize: 11,
    lineHeight: 1.5,
    maxHeight: 300,
    overflowY: 'auto',
  },
  messages: { paddingBlock: 12, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 },
});
