import process from 'node:process';

import type { Locator, Page } from '@playwright/test';

import { model } from './model.mjs';

export interface ResponseBoundary {
  selector: string;
  text?: string;
  nonEmpty?: boolean;
  attribute?: { name: string; value: string };
  enabled?: boolean;
  absent?: string;
}
interface BrowserSample {
  startedAt: number | null;
  endedAt: number | null;
  hidden: boolean;
  event: string | null;
  tasks?: { startTime: number; duration: number }[];
  longTaskSupported?: boolean;
}
declare global {
  interface Window {
    lodyAssuranceSamples: Record<string, BrowserSample>;
  }
}
export interface InteractionSample {
  id: string;
  status: 'observed' | 'timeout' | 'hidden' | 'missing-event';
  durationMs: number | null;
  environment: object;
  attribution: object;
}

// Measurement starts at the trusted browser event, not before Playwright actionability waits.
export async function armInteraction(
  page: Page,
  trigger: Locator,
  id: string,
  boundary: ResponseBoundary,
) {
  const definition = model.interactions.find((entry) => entry.id === id);
  if (!definition) throw new Error(`Unauthored interaction ${id}`);
  await trigger.evaluate(
    (element, id) =>
      element.setAttribute(
        'data-assurance-trigger',
        `${element.getAttribute('data-assurance-trigger') ?? ''} ${id}`,
      ),
    id,
  );
  // tsx's function-name helper must be available in the isolated browser realm.
  await page.evaluate('globalThis.__name ??= (fn) => fn');
  await page.evaluate(
    ({ id, boundary }) => {
      window.lodyAssuranceSamples ??= {};
      // Vite's module graph can fill the default resource buffer before any user action.
      performance.setResourceTimingBufferSize(5_000);
      performance.clearResourceTimings();
      const tasks: { startTime: number; duration: number }[] = [];
      const longTaskSupported = PerformanceObserver.supportedEntryTypes.includes('longtask');
      const observer = longTaskSupported
        ? new PerformanceObserver((list) => {
            tasks.push(
              ...list
                .getEntries()
                .map((entry) => ({ startTime: entry.startTime, duration: entry.duration })),
            );
          })
        : null;
      observer?.observe({ type: 'longtask', buffered: true });
      const sample: BrowserSample & { tasks: typeof tasks; longTaskSupported: boolean } = {
        startedAt: null,
        endedAt: null,
        hidden: false,
        event: null,
        tasks,
        longTaskSupported,
      };
      window.lodyAssuranceSamples[id] = sample;
      const matches = () =>
        [...document.querySelectorAll<HTMLElement>(boundary.selector)].some((element) => {
          if (boundary.absent && document.querySelector(boundary.absent)) return false;
          const rect = element.getBoundingClientRect();
          if (
            !rect.width ||
            !rect.height ||
            rect.bottom <= 0 ||
            rect.top >= innerHeight ||
            rect.right <= 0 ||
            rect.left >= innerWidth ||
            element.closest('[hidden],[inert],[aria-hidden="true"]')
          )
            return false;
          if (getComputedStyle(element).visibility !== 'visible') return false;
          let left = Math.max(0, rect.left);
          let right = Math.min(innerWidth, rect.right);
          let top = Math.max(0, rect.top);
          let bottom = Math.min(innerHeight, rect.bottom);
          for (
            let ancestor: HTMLElement | null = element;
            ancestor;
            ancestor = ancestor.parentElement
          ) {
            const style = getComputedStyle(ancestor);
            if (Number(style.opacity) === 0) return false;
            const bounds = ancestor.getBoundingClientRect();
            if (['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowX)) {
              left = Math.max(left, bounds.left);
              right = Math.min(right, bounds.right);
            }
            if (['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowY)) {
              top = Math.max(top, bounds.top);
              bottom = Math.min(bottom, bounds.bottom);
            }
          }
          if (right <= left || bottom <= top) return false;
          if (boundary.nonEmpty && !element.textContent?.trim()) return false;
          if (boundary.text && !element.textContent?.includes(boundary.text)) return false;
          if (
            boundary.attribute &&
            element.getAttribute(boundary.attribute.name) !== boundary.attribute.value
          )
            return false;
          if (boundary.enabled !== undefined && element.matches(':disabled') === boundary.enabled)
            return false;
          return true;
        });
      if (matches()) throw new Error(`Response ${id} already visible before action`);
      const capture = (event: Event) => {
        if (
          !event.isTrusted ||
          !(event.target instanceof Element) ||
          !event.target.closest(`[data-assurance-trigger~="${id}"]`)
        )
          return;
        if (event instanceof KeyboardEvent && event.key !== 'Enter') return;
        sample.startedAt = performance.now();
        sample.event = event.type;
        document.removeEventListener('click', capture, true);
        document.removeEventListener('keydown', capture, true);
        const observe = () => {
          sample.hidden ||= document.visibilityState !== 'visible';
          if (matches()) {
            sample.endedAt = performance.now();
            tasks.push(
              ...(observer?.takeRecords() ?? []).map((entry) => ({
                startTime: entry.startTime,
                duration: entry.duration,
              })),
            );
            observer?.disconnect();
          } else if (performance.now() - sample.startedAt! < 15_000) requestAnimationFrame(observe);
          else observer?.disconnect();
        };
        requestAnimationFrame(observe);
      };
      document.addEventListener('click', capture, true);
      document.addEventListener('keydown', capture, true);
    },
    { id, boundary },
  );
  return async (): Promise<InteractionSample> => {
    await page
      .waitForFunction((id) => window.lodyAssuranceSamples[id]?.endedAt !== null, id, {
        timeout: 15_000,
      })
      .catch(() => {});
    const sample = await page.evaluate((id) => {
      const sample = window.lodyAssuranceSamples[id]!;
      const start = sample.startedAt ?? 0;
      const end = sample.endedAt ?? performance.now();
      const resources = performance
        .getEntriesByType('resource')
        .filter((entry) => entry.startTime < end && entry.startTime + entry.duration > start)
        .map((entry) => ({
          family:
            new URL(entry.name).origin === location.origin
              ? 'application'
              : new URL(entry.name).hostname.includes('convex')
                ? 'directory'
                : new URL(entry.name).hostname === 'api.lody.ai'
                  ? 'document-or-machine-stream'
                  : 'identity-or-grant',
          startMs: Math.max(0, entry.startTime - start),
          overlapMs: Math.max(
            0,
            Math.min(end, entry.startTime + entry.duration) - Math.max(start, entry.startTime),
          ),
        }));
      const longTasks = (sample.tasks ?? [])
        .filter((entry) => entry.startTime < end && entry.startTime + entry.duration > start)
        .map((entry) => ({
          startMs: Math.max(0, entry.startTime - start),
          durationMs: entry.duration,
        }));
      return {
        ...sample,
        resources,
        longTasks,
        motion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      };
    }, id);
    return {
      id,
      status:
        sample.startedAt === null
          ? 'missing-event'
          : sample.hidden
            ? 'hidden'
            : sample.endedAt === null
              ? 'timeout'
              : 'observed',
      durationMs:
        sample.startedAt !== null && sample.endedAt !== null
          ? sample.endedAt - sample.startedAt
          : null,
      environment: {
        measurement: 'trusted-event-to-visible-raf-v2',
        browser: page.context().browser()?.version(),
        platform: process.platform,
        architecture: process.arch,
        viewport: page.viewportSize(),
        reducedMotion: sample.motion,
        surface: new URL(page.url()).protocol.includes('extension') ? 'extension' : 'web',
        fixture: 'controlled-http-streams',
        ...(process.env.ASSURANCE_REQUIRE_PERFORMANCE === '1' ? {} : { execution: 'functional' }),
        workload: definition.workload,
      },
      attribution: {
        event: sample.event,
        browserStartMs: sample.startedAt,
        browserEndMs: sample.endedAt,
        boundary,
        clock: 'page performance.now',
        resourceScope:
          'Completed page resources only; worker/background and still-open streams require trace investigation.',
        resources: sample.resources,
        longTasks: sample.longTasks,
        longTaskSupported: sample.longTaskSupported,
        unallocated:
          'Overlapping resource/long-task intervals; no inferred critical-path subtraction.',
      },
    };
  };
}
