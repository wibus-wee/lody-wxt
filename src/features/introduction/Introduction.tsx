import { SequenceStepProvider, useSequenceStep } from '@wibus/cuelens/react';
import { NavLink } from 'react-router';

import { Button } from '../../shared/ui/button';
import { Card } from '../../shared/ui/card';
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
      <Card.Root>
        <div aria-live="polite">
          <Card.Header>
            <Card.Title as="h2">{content.title}</Card.Title>
            <Card.Description>{content.body}</Card.Description>
          </Card.Header>
        </div>
        <p>
          第 {step.index + 1} 步，共 {introduction.steps.length} 步
        </p>
        <Card.Footer>
          <Button
            type="button"
            variant="secondary"
            disabled={step.index === 0}
            onClick={() => step.previous()}
          >
            上一步
          </Button>
          <Button
            type="button"
            disabled={step.index === introduction.steps.length - 1}
            onClick={() => step.next()}
          >
            下一步
          </Button>
          <Button type="button" variant="ghost" onClick={() => step.reset()}>
            重新查看
          </Button>
          <Button nativeButton={false} variant="ghost" render={<NavLink to="/" />}>
            开始对话
          </Button>
        </Card.Footer>
      </Card.Root>
    </section>
  );
}
