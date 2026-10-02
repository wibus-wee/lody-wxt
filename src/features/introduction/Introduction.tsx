import { SequenceStepProvider, useSequenceStep } from '@wibus/cuelens/react';

import { introduction } from './sequence';

export function Introduction() {
  return (
    <SequenceStepProvider definition={introduction} initialStep="welcome">
      <IntroductionStep />
    </SequenceStepProvider>
  );
}

function IntroductionStep() {
  const step = useSequenceStep();
  const content = introduction.steps[step.index]?.state;
  if (!content) throw new Error('Introduction step is out of range');
  return (
    <section aria-label="Introduction">
      <div aria-live="polite">
        <h2>{content.title}</h2>
        <p>{content.body}</p>
      </div>
      <p>
        Step {step.index + 1} of {introduction.steps.length}
      </p>
      <button type="button" disabled={step.index === 0} onClick={() => step.previous()}>
        Back
      </button>{' '}
      <button
        type="button"
        disabled={step.index === introduction.steps.length - 1}
        onClick={() => step.next()}
      >
        Continue
      </button>{' '}
      <button type="button" onClick={() => step.reset()}>
        Start over
      </button>
    </section>
  );
}
