import type { SendTurn } from '@lody-mobile/sdk';
import * as v from 'valibot';

import { turnSchema } from './admission';
const schema = v.object({
  sessionId: v.string(),
  kind: v.picklist(['dispatch', 'queue', 'guide']),
  expectedTurnId: v.string(),
  input: turnSchema,
});
export interface PendingTurn {
  sessionId: string;
  kind: 'dispatch' | 'queue' | 'guide';
  expectedTurnId: string;
  input: SendTurn;
}
export class TurnJournal {
  private readonly key: string;
  constructor(scope: string) {
    this.key = `lody:turn:${scope}`;
  }
  load(): PendingTurn | null {
    try {
      const result = v.safeParse(
        v.nullable(schema),
        JSON.parse(localStorage.getItem(this.key) ?? 'null'),
      );
      if (result.success) return result.output;
    } catch {
      /* Invalid persisted state must block admission. */
    }
    throw new Error('Turn journal is corrupt. Sending is blocked.');
  }
  save(turn: PendingTurn) {
    localStorage.setItem(this.key, JSON.stringify(v.parse(schema, turn)));
  }
  claim(turn: PendingTurn): Promise<boolean> {
    return navigator.locks.request(this.key, () => {
      if (this.load()) return false;
      this.save(turn);
      return true;
    });
  }
  clear(requestId?: string) {
    return navigator.locks.request(this.key, () => {
      if (requestId === undefined || this.load()?.input.requestId === requestId)
        localStorage.removeItem(this.key);
    });
  }
}
