export function webhookEventName(topic: string): string {
  return `webhook.${topic}`;
}
