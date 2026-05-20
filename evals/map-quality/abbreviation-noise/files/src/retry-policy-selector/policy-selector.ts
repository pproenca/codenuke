export type RetryPolicyInput = {
  retryPolicyName: string;
  retryAttempt: number;
};

export function selectRetryPolicy(input: RetryPolicyInput): string {
  return `${input.retryPolicyName}:${input.retryAttempt}`;
}
