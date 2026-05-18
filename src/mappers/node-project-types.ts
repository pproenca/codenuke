export type NodePackageJson = {
  name?: unknown;
  scripts?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
  peerDependencies?: unknown;
  optionalDependencies?: unknown;
  bin?: unknown;
  exports?: unknown;
  main?: unknown;
  module?: unknown;
  types?: unknown;
  workspaces?: unknown;
};

export type NodeProjectTarget = {
  name: string;
};

export type NodeProjectInfo = {
  root: string;
  name: string;
  workspaceMember: boolean;
  packageJsonPath: string | null;
  packageJson: NodePackageJson | null;
  projectJsonPath: string | null;
  sourceRoot: string | null;
  projectType: string | null;
  targets: Record<string, NodeProjectTarget>;
  packageManager: string;
  nxPackageManager: string;
};
