import ts from "typescript";

type Surface = {
  readonly type: boolean;
  readonly value: boolean;
};

const TYPE_SURFACE: Surface = { type: true, value: false };
const VALUE_SURFACE: Surface = { type: false, value: true };
const BOTH_SURFACE: Surface = { type: true, value: true };
const NO_SURFACE: Surface = { type: false, value: false };

const merge = (a: Surface, b: Surface): Surface => ({
  type: a.type || b.type,
  value: a.value || b.value,
});

const scriptKind = (name: string): ts.ScriptKind =>
  name.endsWith(".jsx")
    ? ts.ScriptKind.JSX
    : /\.(?:t|j)sx$/u.test(name)
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS;

const parse = (name: string, text: string): ts.SourceFile =>
  ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, scriptKind(name));

const has = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((mod) => mod.kind === kind) ?? false);

const namesOf = (name: ts.BindingName): readonly string[] => {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) => (ts.isBindingElement(element) ? namesOf(element.name) : []));
};

const add = (out: Set<string>, name: string, surface: Surface): void => {
  if (surface.type) out.add(`type:${name}`);
  if (surface.value) out.add(`value:${name}`);
};

const set = (locals: Map<string, Surface>, name: string, surface: Surface): void => {
  locals.set(name, merge(locals.get(name) ?? NO_SURFACE, surface));
};

const localSurface = (statement: ts.Statement): readonly [string, Surface][] => {
  if (ts.isFunctionDeclaration(statement) && statement.name) return [[statement.name.text, VALUE_SURFACE]];
  if (ts.isClassDeclaration(statement) && statement.name) return [[statement.name.text, BOTH_SURFACE]];
  if (ts.isInterfaceDeclaration(statement)) return [[statement.name.text, TYPE_SURFACE]];
  if (ts.isTypeAliasDeclaration(statement)) return [[statement.name.text, TYPE_SURFACE]];
  if (ts.isEnumDeclaration(statement)) return [[statement.name.text, BOTH_SURFACE]];
  if (ts.isModuleDeclaration(statement) && ts.isIdentifier(statement.name)) return [[statement.name.text, BOTH_SURFACE]];
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.flatMap((decl) =>
      namesOf(decl.name).map((name): [string, Surface] => [name, VALUE_SURFACE]),
    );
  }
  if (ts.isImportDeclaration(statement) && statement.importClause) {
    const surfaces: [string, Surface][] = [];
    const surface = statement.importClause.isTypeOnly ? TYPE_SURFACE : BOTH_SURFACE;
    if (statement.importClause.name) surfaces.push([statement.importClause.name.text, surface]);
    const named = statement.importClause.namedBindings;
    if (named && ts.isNamedImports(named)) {
      surfaces.push(
        ...named.elements.map((spec): [string, Surface] => [
          spec.name.text,
          statement.importClause?.isTypeOnly || spec.isTypeOnly ? TYPE_SURFACE : BOTH_SURFACE,
        ]),
      );
    }
    if (named && ts.isNamespaceImport(named)) surfaces.push([named.name.text, surface]);
    return surfaces;
  }
  return [];
};

const exportedDeclaration = (statement: ts.Statement): readonly [string, Surface][] => {
  if (!has(statement, ts.SyntaxKind.ExportKeyword)) return [];
  const name = has(statement, ts.SyntaxKind.DefaultKeyword) ? "default" : null;
  if (ts.isFunctionDeclaration(statement)) return [[name ?? statement.name?.text ?? "default", VALUE_SURFACE]];
  if (ts.isClassDeclaration(statement)) return [[name ?? statement.name?.text ?? "default", BOTH_SURFACE]];
  if (ts.isInterfaceDeclaration(statement)) return [[name ?? statement.name.text, TYPE_SURFACE]];
  if (ts.isTypeAliasDeclaration(statement)) return [[statement.name.text, TYPE_SURFACE]];
  if (ts.isEnumDeclaration(statement)) return [[statement.name.text, BOTH_SURFACE]];
  if (ts.isModuleDeclaration(statement) && ts.isIdentifier(statement.name)) return [[statement.name.text, BOTH_SURFACE]];
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.flatMap((decl) =>
      namesOf(decl.name).map((id): [string, Surface] => [id, VALUE_SURFACE]),
    );
  }
  return [];
};

const namespaceBody = (statement: ts.Statement): ts.ModuleBlock | null =>
  ts.isModuleDeclaration(statement) && statement.body && ts.isModuleBlock(statement.body)
    ? statement.body
    : null;

const namespaceInfo = (
  statement: ts.Statement,
): { readonly local: string; readonly path: string; readonly body: ts.ModuleBlock } | null => {
  if (!ts.isModuleDeclaration(statement) || !ts.isIdentifier(statement.name)) return null;
  const read = (
    body: ts.ModuleBody | undefined,
    names: readonly string[],
  ): { readonly local: string; readonly path: string; readonly body: ts.ModuleBlock } | null => {
    if (body && ts.isModuleDeclaration(body) && ts.isIdentifier(body.name)) {
      return read(body.body, [...names, body.name.text]);
    }
    if (!body || !ts.isModuleBlock(body)) return null;
    return { local: names[0] ?? "", path: names.join("."), body };
  };
  return read(statement.body, [statement.name.text]);
};

const ambientName = (statement: ts.Statement): string | null => {
  if (!ts.isModuleDeclaration(statement) || !has(statement, ts.SyntaxKind.DeclareKeyword)) return null;
  if (ts.isStringLiteral(statement.name)) return `module:${statement.name.text}`;
  if (ts.isIdentifier(statement.name) && statement.name.text === "global") return "global";
  return null;
};

const addNamespace = (
  body: ts.ModuleBlock,
  prefix: string,
  out: Set<string>,
  typeOnly: boolean,
  ambient = false,
  declaration = false,
): void => {
  const temp = typeOnly ? new Set<string>() : out;
  collect(body.statements, prefix, temp, ambient, declaration);
  if (typeOnly) {
    for (const item of temp) {
      if (item.startsWith("type:")) out.add(item);
    }
  }
};

const collect = (
  statements: ts.NodeArray<ts.Statement>,
  prefix: string,
  out: Set<string>,
  ambient = false,
  declaration = false,
): void => {
  const locals = new Map<string, Surface>();
  const namespaces = new Map<string, { readonly path: string; readonly body: ts.ModuleBlock; readonly ambient: boolean }[]>();

  for (const statement of statements) {
    for (const [name, surface] of localSurface(statement)) set(locals, name, surface);
    const info = namespaceInfo(statement);
    if (info) {
      namespaces.set(info.local, [
        ...(namespaces.get(info.local) ?? []),
        { path: info.path, body: info.body, ambient: ambient || declaration || has(statement, ts.SyntaxKind.DeclareKeyword) },
      ]);
    }
  }

  for (const statement of statements) {
    if (ambient && !ts.isImportDeclaration(statement)) {
      for (const [name, surface] of localSurface(statement)) add(out, `${prefix}${name}`, surface);
    }
    for (const [name, surface] of exportedDeclaration(statement)) add(out, `${prefix}${name}`, surface);
    const info = namespaceInfo(statement);
    if (
      info &&
      ts.isModuleDeclaration(statement) &&
      has(statement, ts.SyntaxKind.ExportKeyword) &&
      ts.isIdentifier(statement.name)
    ) {
      addNamespace(
        info.body,
        `${prefix}${info.path}.`,
        out,
        false,
        ambient || declaration || has(statement, ts.SyntaxKind.DeclareKeyword),
        declaration,
      );
    }
    if (ambient && info) {
      addNamespace(info.body, `${prefix}${info.path}.`, out, false, true, declaration);
    }
    const name = ambientName(statement);
    const body = namespaceBody(statement);
    if (body && name) addNamespace(body, `${prefix}${name}.`, out, false, true, declaration);

    if (ts.isExportDeclaration(statement)) {
      const surface = statement.isTypeOnly ? TYPE_SURFACE : BOTH_SURFACE;
      const from = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : "";
      if (!statement.exportClause) {
        add(out, `${prefix}*:${from}`, surface);
        continue;
      }
      if (ts.isNamespaceExport(statement.exportClause)) {
        add(out, `${prefix}*as:${statement.exportClause.name.text}:${from}`, surface);
        continue;
      }
      for (const spec of statement.exportClause.elements) {
        const exported = spec.name.text;
        if (statement.moduleSpecifier) {
          add(out, `${prefix}${exported}`, statement.isTypeOnly || spec.isTypeOnly ? TYPE_SURFACE : BOTH_SURFACE);
          continue;
        }
        const local = spec.propertyName?.text ?? spec.name.text;
        add(
          out,
          `${prefix}${exported}`,
          statement.isTypeOnly || spec.isTypeOnly ? TYPE_SURFACE : (locals.get(local) ?? BOTH_SURFACE),
        );
        for (const ns of namespaces.get(local) ?? []) {
          addNamespace(
            ns.body,
            `${prefix}${exported}${ns.path.slice(local.length)}.`,
            out,
            statement.isTypeOnly || spec.isTypeOnly,
            ns.ambient,
            declaration,
          );
        }
      }
      continue;
    }

    if (ts.isExportAssignment(statement)) {
      if (statement.isExportEquals) {
        const surface = ts.isIdentifier(statement.expression)
          ? (locals.get(statement.expression.text) ?? VALUE_SURFACE)
          : VALUE_SURFACE;
        add(out, `${prefix}export=`, surface);
        if (ts.isIdentifier(statement.expression)) {
          for (const ns of namespaces.get(statement.expression.text) ?? []) {
            addNamespace(
              ns.body,
              `${prefix}export=${ns.path.slice(statement.expression.text.length)}.`,
              out,
              false,
              ns.ambient,
              declaration,
            );
          }
        }
        continue;
      }
      const surface = ts.isIdentifier(statement.expression)
        ? (locals.get(statement.expression.text) ?? VALUE_SURFACE)
        : VALUE_SURFACE;
      add(out, `${prefix}default`, surface);
      if (ts.isIdentifier(statement.expression)) {
        for (const ns of namespaces.get(statement.expression.text) ?? []) {
          addNamespace(
            ns.body,
            `${prefix}default${ns.path.slice(statement.expression.text.length)}.`,
            out,
            false,
            ns.ambient,
            declaration,
          );
        }
      }
    }
  }
};

export const publicExportSurface = (source: string, file = "source.ts"): readonly string[] => {
  const out = new Set<string>();
  const sf = parse(file, source);
  const declaration = /\.d\.[cm]?ts$/u.test(file);
  collect(sf.statements, "", out, declaration && !ts.isExternalModule(sf), declaration);

  return [...out].sort();
};
