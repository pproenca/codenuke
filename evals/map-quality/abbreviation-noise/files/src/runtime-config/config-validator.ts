export type RuntimeConfigValidation = {
  runtimeConfigPath: string;
  validationMode: string;
};

export function validateRuntimeConfig(input: RuntimeConfigValidation): boolean {
  return input.runtimeConfigPath.length > 0 && input.validationMode.length > 0;
}
