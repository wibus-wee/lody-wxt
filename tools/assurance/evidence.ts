import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

import * as v from 'valibot';

import { findCase, modelHash } from './catalog.mjs';
import type { InteractionSample } from './interaction';

const runSchema = v.object({ id: v.string(), sourceHash: v.string(), modelHash: v.string() });

export class JourneyEvidence {
  readonly checkpoints: { id: string; observedAt: string }[] = [];
  readonly interactions: InteractionSample[] = [];
  readonly contract;
  constructor(
    readonly journey: string,
    readonly variant: string,
    readonly layer: 'web' | 'extension',
  ) {
    this.contract = findCase(journey, variant);
  }
  async check(id: string, assertions: () => Promise<void> | void) {
    assert.ok(this.contract.variant.obligations.includes(id), `Unauthored checkpoint ${id}`);
    assert.ok(
      !this.checkpoints.some((checkpoint) => checkpoint.id === id),
      `Duplicate checkpoint ${id}`,
    );
    await assertions();
    this.checkpoints.push({ id, observedAt: new Date().toISOString() });
  }
  async write(status: 'passed' | 'failed' | 'incomplete', trace: string, frameworkId?: string) {
    const directory = process.env.ASSURANCE_RUN_DIRECTORY;
    if (!directory) return;
    const run = v.parse(runSchema, JSON.parse(await readFile(`${directory}/run.json`, 'utf8')));
    assert.equal(run.modelHash, modelHash);
    const repetition = process.env.ASSURANCE_REPETITION ?? '1';
    await writeFile(
      `${directory}/${this.journey}-${this.variant}-${this.layer}-${repetition}.evidence.json`,
      JSON.stringify(
        {
          runId: run.id,
          modelHash,
          sourceHash: run.sourceHash,
          journey: this.journey,
          case: this.variant,
          namespace: this.contract.journey.namespace,
          layer: this.layer,
          status,
          trace,
          repetition: Number(repetition),
          frameworkId,
          checkpoints: this.checkpoints,
          interactions: this.interactions,
        },
        null,
        2,
      ),
    );
  }
}
