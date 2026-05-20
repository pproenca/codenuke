export type StoredContext = {
  contextId: string;
  storeKey: string;
};

export function storeRequestContext(context: StoredContext): string {
  return `${context.storeKey}:${context.contextId}`;
}
