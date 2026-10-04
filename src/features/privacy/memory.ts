import * as v from 'valibot';

const memorySchema = v.object({
  version: v.literal(1),
  enabled: v.boolean(),
  text: v.pipe(v.string(), v.maxLength(4000)),
  revision: v.pipe(v.number(), v.integer(), v.minValue(0)),
});
export type PersonalMemory = v.InferOutput<typeof memorySchema>;
const empty: PersonalMemory = { version: 1, enabled: false, text: '', revision: 0 };
const eventName = 'lody:personal-memory';
function key(scope: string) {
  if (!scope) throw new Error('请先选择账户和工作区。');
  return `lody:personal-memory:${scope}`;
}
export function readPersonalMemory(scope: string): PersonalMemory {
  const raw = localStorage.getItem(key(scope));
  if (raw === null) return { ...empty };
  const result = v.safeParse(memorySchema, JSON.parse(raw));
  if (!result.success) throw new Error('个人偏好记录无法读取，请在设置中检查。');
  return result.output;
}
export async function savePersonalMemory(
  scope: string,
  memory: Pick<PersonalMemory, 'enabled' | 'text' | 'revision'>,
) {
  return navigator.locks.request(key(scope), () => {
    const existing = readPersonalMemory(scope);
    if (existing.revision !== memory.revision)
      throw new Error('个人偏好已在另一个窗口更新，请重新读取。');
    const next = v.parse(memorySchema, {
      ...memory,
      version: 1,
      text: memory.text.trim(),
      revision: existing.revision + 1,
    });
    localStorage.setItem(key(scope), JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(eventName, { detail: scope }));
    return next;
  });
}
export async function deletePersonalMemory(scope: string) {
  await navigator.locks.request(key(scope), () => {
    localStorage.removeItem(key(scope));
    window.dispatchEvent(new CustomEvent(eventName, { detail: scope }));
  });
}
export function subscribePersonalMemory(scope: string, listener: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === key(scope)) listener();
  };
  const local = (event: Event) => {
    if (event instanceof CustomEvent && event.detail === scope) listener();
  };
  window.addEventListener('storage', storage);
  window.addEventListener(eventName, local);
  return () => {
    window.removeEventListener('storage', storage);
    window.removeEventListener(eventName, local);
  };
}
export function personalMemoryPrompt(scope: string): string | null {
  const memory = readPersonalMemory(scope);
  return memory.enabled && memory.text.trim() ? memory.text.trim() : null;
}
