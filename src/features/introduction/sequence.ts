import { defineSequenceSteps, validateSequenceSteps } from '@wibus/cuelens';

export const introduction = defineSequenceSteps({
  steps: [
    { id: 'welcome', state: { title: 'Welcome', body: 'A workspace that feels like yours.' } },
    {
      id: 'personalize',
      state: {
        title: 'Make it yours',
        body: 'Choose an icon mood and name your workspace in Settings.',
      },
    },
    { id: 'ready', state: { title: 'Ready', body: 'Your preferences stay with your browser.' } },
  ],
});
const issues = validateSequenceSteps(introduction);
if (issues.length) throw new Error(issues.map((issue) => issue.message).join('\n'));
