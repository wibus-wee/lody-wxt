export interface RecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: { transcript: string };
}
export interface SpeechRecognitionPort {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onresult: ((event: { results: ArrayLike<RecognitionResult> }) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type RecognitionConstructor = new () => SpeechRecognitionPort;
function constructor() {
  const host = globalThis as typeof globalThis & {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return host.SpeechRecognition ?? host.webkitSpeechRecognition;
}
export function dictationAvailable() {
  return constructor() !== undefined;
}
export function createRecognition(): SpeechRecognitionPort {
  const Recognition = constructor();
  if (!Recognition) throw new Error('当前浏览器不支持听写，请使用键盘输入。');
  return new Recognition();
}
export function recognitionText(results: ArrayLike<RecognitionResult>) {
  let final = '';
  let interim = '';
  for (const result of Array.from(results)) {
    const text = result[0]?.transcript ?? '';
    if (result.isFinal) final += text;
    else interim += text;
  }
  return { final, interim };
}
