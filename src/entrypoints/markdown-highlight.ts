import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';

import { registerMarkdownHighlightWorker } from '../shared/ui/markdown-highlight';

export default defineUnlistedScript(() => {
  registerMarkdownHighlightWorker();
});
