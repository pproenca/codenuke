export type RuntimeConfigSource = {
  runtimeConfigPath: string;
  loaderName: string;
};

export function loadRuntimeConfig(source: RuntimeConfigSource): string {
  return `${source.loaderName}:${source.runtimeConfigPath}`;
}
