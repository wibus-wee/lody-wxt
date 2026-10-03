import { SequenceStepProvider, useSequenceStep } from '@wibus/cuelens/react';

import { Button } from '../../shared/ui';
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
      <Button
        variant="secondary"
        type="button"
        disabled={step.index === 0}
        onClick={() => step.previous()}
      >
        Back
      </Button>{' '}
      <Button
        type="button"
        disabled={step.index === introduction.steps.length - 1}
        onClick={() => step.next()}
      >
        Continue
      </Button>{' '}
      <Button variant="ghost" type="button" onClick={() => step.reset()}>
        Start over
      </Button>
    </section>
  );
}
