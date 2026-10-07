import * as v from 'valibot';

import { screenshotViewportSchema } from './screenshot';

export const screenshotPortName = 'lody:screenshot-selection';
const pixel = v.pipe(v.number(), v.integer(), v.minValue(0));
const dimension = v.pipe(v.number(), v.integer(), v.minValue(1));
export const screenshotSelectionSchema = v.variant('type', [
  v.object({ type: v.literal('cancel') }),
  v.object({ type: v.literal('error'), message: v.string() }),
  v.object({ type: v.literal('full') }),
  v.object({
    type: v.literal('crop'),
    region: v.object({ x: pixel, y: pixel, width: dimension, height: dimension }),
  }),
]);
export type ScreenshotSelection = v.InferOutput<typeof screenshotSelectionSchema>;
export const screenshotOverlaySchema = v.object({
  data: v.pipe(v.string(), v.startsWith('data:image/png;base64,')),
  css: v.string(),
  width: dimension,
  height: dimension,
  viewport: screenshotViewportSchema,
});
