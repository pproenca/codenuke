export type RuntimeCfgValidation = {
  runtimeCfgPath: string;
  validationMode: string;
};

export function validateRuntimeCfg(input: RuntimeCfgValidation): boolean {
  return input.runtimeCfgPath.length > 0 && input.validationMode.length > 0;
}
