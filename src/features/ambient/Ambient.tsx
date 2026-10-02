import { MeshGradient } from '@paper-design/shaders-react';
import { useAtomValue } from 'jotai';
import { useReducedMotion } from 'motion/react';

import { preferencesAtom } from '../preferences/state';

export function Ambient() {
  const { ambient } = useAtomValue(preferencesAtom);
  const reduced = useReducedMotion();
  if (!ambient || reduced) return null;
  return (
    <div
      aria-hidden="true"
      data-testid="ambient"
      style={{ position: 'fixed', inset: 0, zIndex: -1, opacity: 0.2, pointerEvents: 'none' }}
    >
      <MeshGradient
        colors={['#c7d8ff', '#e4ccf5', '#d7ede6', '#fff4dc']}
        speed={0.25}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
}
