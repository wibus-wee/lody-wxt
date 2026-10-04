import * as stylex from '@stylexjs/stylex';

import { settingsSurface } from '../../../vendor/lody/packages/components/src/components/settings/surface';
import { composer } from '../../shared/ui/composer.stylex';

export const scheduleCard = settingsSurface.card;
export const automationStyles = stylex.create({
  page: {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    color: composer.label,
    backgroundColor: composer.canvas,
  },
  header: { display: 'flex', alignItems: 'center', gap: 8, padding: 12, flexShrink: 0 },
  heading: { fontSize: 16, fontWeight: 600, margin: 0, flex: 1, minWidth: 0 },
  body: {
    minHeight: 0,
    overflowY: 'auto',
    paddingInline: 12,
    paddingBottom: 20,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  section: { display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 },
  row: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
  wrap: { flexWrap: 'wrap' },
  grow: { minWidth: 0, flex: 1 },
  title: { fontSize: 14, fontWeight: 500, margin: 0, overflowWrap: 'anywhere' },
  hint: {
    fontSize: 12,
    color: composer.hint,
    lineHeight: 1.5,
    margin: 0,
    overflowWrap: 'anywhere',
  },
  card: { padding: 12, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 },
  editor: { display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 },
  prompt: { minHeight: 100, maxHeight: 220, resize: 'none' },
  property: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, auto) minmax(0, 1fr)',
    alignItems: 'center',
    gap: 12,
    minHeight: 44,
    minWidth: 0,
  },
  value: { display: 'flex', justifyContent: 'end', flexWrap: 'wrap', gap: 6, minWidth: 0 },
});
