/** One unused host belongs to one runtime; disposal removes its realm and callbacks. */
export interface DataHost {
  start: (context: {
    instanceId: string;
    receive: (message: string) => void;
    fail: () => void;
  }) => void;
  send: (message: string) => void;
  dispose: () => void;
}
