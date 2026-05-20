export type RetryPolicyRecord = {
  retryPolicyName: string;
  maxRetries: number;
};

export function listRetryPolicies(records: RetryPolicyRecord[]): string[] {
  return records.map((record) => record.retryPolicyName);
}
