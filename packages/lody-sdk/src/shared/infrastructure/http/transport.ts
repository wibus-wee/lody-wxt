export interface HttpRequest {
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
  credentials: 'omit';
  redirect: 'error';
  signal: AbortSignal;
}

export interface HttpResponse {
  status: number;
  json: () => Promise<unknown>;
}

/** Must honor signal and redirect:error, and must not log credentials or request/response bodies. */
export type HttpTransport = (url: string, request: HttpRequest) => Promise<HttpResponse>;
