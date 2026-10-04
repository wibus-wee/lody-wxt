import * as stylex from '@stylexjs/stylex';

const DARK = '@media (prefers-color-scheme: dark)';
export const composer = stylex.defineVars({
  canvas: { default: 'hsl(0 0% 97.6%)', [DARK]: 'hsl(220 7.3% 8%)' },
  background: { default: 'white', [DARK]: 'hsl(216 7.7% 12.7% / 0.9)' },
  border: { default: 'hsl(225 7.1% 11% / 0.1)', [DARK]: 'hsl(220 6.5% 18% / 0.7)' },
  label: { default: 'hsl(225 7.1% 11%)', [DARK]: 'hsl(210 2.6% 84.7%)' },
  hint: { default: 'hsl(220 8.9% 46.1%)', [DARK]: 'hsl(214.3 3.7% 62.5%)' },
  elevation: {
    default: '0 3px 6px -2px hsl(0 0% 0% / 0.02), 0 1px 1px hsl(0 0% 0% / 0.04)',
    [DARK]: 'none',
  },
});

export const composerLight = stylex.createTheme(composer, {
  canvas: 'hsl(0 0% 97.6%)',
  background: 'white',
  border: 'hsl(225 7.1% 11% / 0.1)',
  label: 'hsl(225 7.1% 11%)',
  hint: 'hsl(220 8.9% 46.1%)',
  elevation: '0 3px 6px -2px hsl(0 0% 0% / 0.02), 0 1px 1px hsl(0 0% 0% / 0.04)',
});
export const composerDark = stylex.createTheme(composer, {
  canvas: 'hsl(220 7.3% 8%)',
  background: 'hsl(216 7.7% 12.7% / 0.9)',
  border: 'hsl(220 6.5% 18% / 0.7)',
  label: 'hsl(210 2.6% 84.7%)',
  hint: 'hsl(214.3 3.7% 62.5%)',
  elevation: 'none',
});
