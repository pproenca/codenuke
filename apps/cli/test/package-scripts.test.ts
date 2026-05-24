import { describe, expect, it } from "@effect/vitest"
import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")

async function readPackageJson(path: string): Promise<{
  scripts?: Record<string, string>
}> {
  return JSON.parse(await readFile(path, "utf8"))
}

describe("release build package scripts", () => {
  it("keeps the root build entrypoint wired to recursive workspace builds", async () => {
    const pkg = await readPackageJson(resolve(repoRoot, "package.json"))

    expect(pkg.scripts?.build).toBe("pnpm -r --if-present run build")
  })

  it("keeps the CLI workspace build target available to the root build", async () => {
    const pkg = await readPackageJson(resolve(repoRoot, "apps/cli/package.json"))

    expect(pkg.scripts?.build).toBe("node scripts/bundle-cli.mjs")
  })
})
