import * as stylex from '@stylexjs/stylex';
import { useAtomValue } from 'jotai';

import { moodAtom } from '../../features/preferences/state';
import { iconMarkup } from './generated';

const styles = stylex.create({
  box: (size: number | '100%') => ({
    display: 'inline-flex',
    width: size,
    height: size,
    flexShrink: 0,
  }),
});

export function Icon({
  name = 'home',
  size = 20,
}: {
  name?: keyof typeof iconMarkup.outline;
  size?: number | '100%';
}) {
  const mood = useAtomValue(moodAtom);
  return (
    <span
      {...stylex.props(styles.box(size))}
      aria-hidden="true"
      data-icon-mood={mood}
      data-icon={name}
      dangerouslySetInnerHTML={{ __html: iconMarkup[mood][name] }}
    />
  );
}
