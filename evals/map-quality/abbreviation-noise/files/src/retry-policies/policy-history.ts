export type RetryPolicyHistory = {
  retryPolicyName: string;
  changedAt: string;
};

export function formatRetryPolicyHistory(history: RetryPolicyHistory): string {
  return `${history.retryPolicyName}:${history.changedAt}`;
}
