export type EnvMetadata = {
  envName: string;
  deploymentTier: string;
};

export function describeEnvMetadata(metadata: EnvMetadata): string {
  return `${metadata.envName}:${metadata.deploymentTier}`;
}
