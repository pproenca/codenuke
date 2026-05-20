export type RequestContext = {
  contextId: string;
  requestId: string;
};

export function readRequestContext(context: RequestContext): string {
  return `${context.requestId}:${context.contextId}`;
}
