export type RuntimeCfgSource = {
  runtimeCfgPath: string;
  loaderName: string;
};

export function loadRuntimeCfg(source: RuntimeCfgSource): string {
  return `${source.loaderName}:${source.runtimeCfgPath}`;
}
