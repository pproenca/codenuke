export type RetryPolicyScore = {
  retryPolicyName: string;
  retryWeight: number;
};

export function scoreRetryPolicy(score: RetryPolicyScore): number {
  return score.retryPolicyName.length * score.retryWeight;
}
