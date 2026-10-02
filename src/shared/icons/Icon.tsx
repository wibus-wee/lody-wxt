import { useAtomValue } from 'jotai';

import { moodAtom } from '../../features/preferences/state';
import { iconMarkup } from './generated';

export function Icon() {
  const mood = useAtomValue(moodAtom);
  return (
    <span
      aria-hidden="true"
      data-icon-mood={mood}
      dangerouslySetInnerHTML={{ __html: iconMarkup[mood] }}
    />
  );
}
