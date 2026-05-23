import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function sourceWithMutationSites(count) {
  return (
    Array.from(
      { length: count },
      (_, index) => `export const isAbove${index} = (value: number): boolean => value > ${index};`,
    ).join("\n") + "\n"
  );
}

export function writeFixtureFile(root, path, contents) {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents, "utf8");
}
