export function tomlTable(source: string, name: string): string {
  const escapedName = escapeRegExp(name);
  const match = new RegExp(`^\\s*\\[${escapedName}\\]\\s*(?:#.*)?$`, "mu").exec(source);
  if (match?.index === undefined) {
    return "";
  }
  return tomlSectionAfter(source, match.index + match[0].length);
}

export function tomlTables(source: string, names: readonly string[]): string[] {
  return names.flatMap((name) => {
    const escapedName = escapeRegExp(name);
    const pattern = new RegExp(`^\\s*\\[${escapedName}\\]\\s*(?:#.*)?$`, "gmu");
    return tomlTablesForHeaderPattern(source, pattern);
  });
}

export function tomlTablesMatching(source: string, namePattern: RegExp): string[] {
  const tables: string[] = [];
  for (const match of source.matchAll(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/gmu)) {
    const name = match[1];
    if (name === undefined || !namePattern.test(name)) {
      continue;
    }
    tables.push(tomlSectionAfter(source, match.index + match[0].length));
  }
  return tables;
}

function tomlTablesForHeaderPattern(source: string, pattern: RegExp): string[] {
  const tables: string[] = [];
  for (const match of source.matchAll(pattern)) {
    tables.push(tomlSectionAfter(source, match.index + match[0].length));
  }
  return tables;
}

function tomlSectionAfter(source: string, start: number): string {
  const rest = source.slice(start);
  const next = tomlHeaderPattern.exec(rest);
  return next?.index === undefined ? rest : rest.slice(0, next.index);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

const tomlHeaderPattern = /^\s*\[\[?[^\]]+\]\]?\s*(?:#.*)?$/mu;
