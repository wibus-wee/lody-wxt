import * as stylex from '@stylexjs/stylex';
import { useReducedMotion } from 'motion/react';
import * as m from 'motion/react-m';
import type { ReactNode } from 'react';

import { feedback } from '../../../vendor/lody/packages/ui/src/feedback/feedback.tokens.stylex';
import { composer } from './composer.stylex';
import { Spinner } from './index';

const compactSpinner = stylex.createTheme(feedback, { spinnerSmall: '12px' });
const styles = stylex.create({
  root: {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    minHeight: 24,
    minWidth: 0,
    paddingInline: 4,
    margin: 0,
    fontSize: 12,
    lineHeight: '18px',
    fontWeight: 400,
    color: composer.hint,
  },
  spinner: {
    flexShrink: 0,
    animationName: { default: null, '@media (prefers-reduced-motion: reduce)': 'none' },
  },
  dot: {
    width: 5,
    height: 5,
    marginInline: 3.5,
    flexShrink: 0,
    borderRadius: '50%',
    backgroundColor: 'currentColor',
  },
  label: { minWidth: 0, overflowWrap: 'anywhere' },
  action: { marginInlineStart: 'auto', flexShrink: 0 },
});

export function ActivityStatus({
  children,
  busy = false,
  action,
}: {
  children: ReactNode;
  busy?: boolean;
  action?: ReactNode;
}) {
  const reduced = useReducedMotion();
  return (
    <m.output
      {...stylex.props(styles.root, compactSpinner)}
      aria-live="polite"
      aria-atomic="true"
      data-activity-status=""
      initial={reduced ? false : { opacity: 0, y: 2 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 32 }}
    >
      {busy ? (
        <Spinner size="small" label={null} {...stylex.props(styles.spinner)} />
      ) : (
        <span aria-hidden="true" {...stylex.props(styles.dot)} />
      )}
      <span {...stylex.props(styles.label)}>{children}</span>
      {action && <span {...stylex.props(styles.action)}>{action}</span>}
    </m.output>
  );
}
