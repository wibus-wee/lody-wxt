import * as stylex from '@stylexjs/stylex';

import { feedback } from '../../../vendor/lody/packages/ui/src/feedback/feedback.tokens.stylex';
import { field } from '../../../vendor/lody/packages/ui/src/field/field.tokens.stylex';
import { colors } from '../../../vendor/lody/packages/ui/src/tokens/colors.stylex';

// The upstream hint and tinted-alert text fall below AA at 12px. Theme tokens
// preserve the primitives' geometry and palettes while making this surface readable.
export const readableFieldTheme = stylex.createTheme(field, {
  hint: colors.secondaryLabel,
  placeholder: colors.secondaryLabel,
});
export const readableFeedbackTheme = stylex.createTheme(feedback, {
  description: colors.label,
});
