export type EnvMetadataWrite = {
  envName: string;
  metadataValue: string;
};

export function writeEnvMetadata(metadata: EnvMetadataWrite): string {
  return `${metadata.envName}:${metadata.metadataValue}`;
}
