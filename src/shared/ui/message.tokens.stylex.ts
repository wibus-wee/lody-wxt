import * as stylex from '@stylexjs/stylex';

// Lody product syntax palette; light constants/comments are darkened to meet AA on fence fill.
const DARK = '@media (prefers-color-scheme: dark)';
export const syntax = stylex.defineVars({
  keyword: { default: 'hsl(262 60% 48%)', [DARK]: 'hsl(262 90% 74%)' },
  string: { default: 'hsl(153 55% 30%)', [DARK]: 'hsl(154 68% 55%)' },
  number: { default: 'hsl(24 85% 36%)', [DARK]: 'hsl(28 88% 62%)' },
  comment: { default: 'hsl(220 7% 41%)', [DARK]: 'hsl(216 18% 70%)' },
  function: { default: 'hsl(210 65% 40%)', [DARK]: 'hsl(197 85% 58%)' },
  variable: { default: 'hsl(330 55% 42%)', [DARK]: 'hsl(330 78% 70%)' },
  title: { default: 'hsl(220 82% 48%)', [DARK]: 'hsl(330 78% 70%)' },
  fence: { default: 'hsl(240 14% 94.1%)', [DARK]: 'hsl(216 7.7% 12.7% / 0.9)' },
});
export const syntaxLight = stylex.createTheme(syntax, {
  keyword: 'hsl(262 60% 48%)',
  string: 'hsl(153 55% 30%)',
  number: 'hsl(24 85% 36%)',
  comment: 'hsl(220 7% 41%)',
  function: 'hsl(210 65% 40%)',
  variable: 'hsl(330 55% 42%)',
  title: 'hsl(220 82% 48%)',
  fence: 'hsl(240 14% 94.1%)',
});
export const syntaxDark = stylex.createTheme(syntax, {
  keyword: 'hsl(262 90% 74%)',
  string: 'hsl(154 68% 55%)',
  number: 'hsl(28 88% 62%)',
  comment: 'hsl(216 18% 70%)',
  function: 'hsl(197 85% 58%)',
  variable: 'hsl(330 78% 70%)',
  title: 'hsl(330 78% 70%)',
  fence: 'hsl(216 7.7% 12.7% / 0.9)',
});
