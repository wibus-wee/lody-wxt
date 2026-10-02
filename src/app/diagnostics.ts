export async function startDiagnostics() {
  if (!import.meta.env.DEV) return;
  if (import.meta.env.VITE_REACT_SCAN === 'true') {
    const { scan } = await import('react-scan');
    scan({ enabled: true });
  }
  if (import.meta.env.VITE_REACT_GRAB === 'true') {
    const { init } = await import('react-grab');
    init();
  }
}
