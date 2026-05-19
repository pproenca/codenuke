import { suppressedTestCommandTag } from "../mappers/types.js";
import { FeatureRecord } from "../platform/types.js";

export type ValidationCommandConfig = {
  typecheck: string | null;
  lint: string | null;
  format: string | null;
  formatCheck?: string | null | undefined;
  test: string | null;
};

export function validationCommandsForFeature(
  feature: FeatureRecord | null,
  commands: ValidationCommandConfig,
  options: { mutatingFormat?: boolean } = {},
): string[] {
  const featureCommands = (feature?.tests ?? []).flatMap((test) =>
    test.command === null || test.command.length === 0 ? [] : [test.command],
  );
  const configuredTest =
    feature?.tags.includes(suppressedTestCommandTag) === true ? null : commands.test;
  const formatCommand =
    options.mutatingFormat === true
      ? commands.format
      : (commands.formatCheck ?? checkLikeFormatCommand(commands.format));
  const ordered = [
    formatCommand,
    ...featureCommands,
    commands.typecheck,
    commands.lint,
    configuredTest,
  ].filter((command): command is string => command !== null && command.length > 0);
  return Array.from(new Set(ordered));
}

function checkLikeFormatCommand(command: string | null): string | null {
  if (command === null) {
    return null;
  }
  return /\b(?:check|--check|--dry-run|--verify|--test)\b/u.test(command) ? command : null;
}
