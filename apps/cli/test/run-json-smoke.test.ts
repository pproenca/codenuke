import { describe, expect, it } from "@effect/vitest"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const cli = resolve(repoRoot, "apps/cli/dist/cli.cjs")
const wilsonAllCaught60 = {
  p: 1,
  lo: 0.9398260695220669,
  hi: 0.9999999999999999,
}

describe("cli run --json smoke", () => {
  it("emits parseable NDJSON progress without the human summary", () => {
    execFileSync("pnpm", ["--filter", "codenuke", "run", "build"], { cwd: repoRoot, stdio: "ignore" })

    const repo = mkdtempSync(resolve(tmpdir(), "codenuke-run-json-"))
    try {
      mkdirSync(resolve(repo, "src"), { recursive: true })
      mkdirSync(resolve(repo, ".codenuke"), { recursive: true })
      writeFileSync(resolve(repo, "src/index.ts"), "export const value = 1\n// codenuke:remove\n")

      execFileSync("git", ["init"], { cwd: repo, stdio: "ignore" })
      execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repo })
      execFileSync("git", ["config", "user.name", "Test User"], { cwd: repo })
      execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: repo })
      execFileSync("git", ["add", "."], { cwd: repo })
      execFileSync("git", ["commit", "-m", "init"], { cwd: repo, stdio: "ignore" })
      const baselineSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim()
      writeFileSync(
        resolve(repo, ".codenuke/fence-fidelity.json"),
        `${JSON.stringify({
          schemaVersion: 1,
          baseline: "HEAD",
          baselineSha,
          generatedAt: "2026-05-25T00:00:00.000Z",
          method: "ast-aware",
          threshold: 0.9,
          capPerRegion: 60,
          seed: 1337,
          regions: {
            src: {
              caught: 60,
              total: 60,
              ...wilsonAllCaught60,
              admissible: true,
              survivorSpecs: [],
            },
          },
        })}\n`,
      )
      writeFileSync(
        resolve(repo, ".codenuke/calibration.json"),
        `${JSON.stringify({
          schemaVersion: 1,
          baseline: "HEAD",
          baselineSha,
          generatedAt: "2026-05-25T00:00:00.000Z",
          commitsSampled: 3,
          scales: { sL: 150, sCx: 15, sDup: 5 },
        })}\n`,
      )
      writeFileSync(
        resolve(repo, ".codenuke/changecost.json"),
        `${JSON.stringify({
          schemaVersion: 1,
          ref: "HEAD",
          beta: 60,
          Vhat: null,
          done: 0,
          total: 0,
          results: [],
        })}\n`,
      )

      const result = spawnSync("node", [cli, "run", "--json", "1"], {
        cwd: repo,
        env: {
          ...process.env,
          CN_SRC: "src",
          CN_TEST_FILE: "node",
          CN_TEST_ARGS_JSON: '["-e","process.exit(0)"]',
          CN_PROPOSER_PROVIDER: "fake",
          CN_FAKE_FILE: "src/index.ts",
        },
        encoding: "utf8",
      })

      expect(result.status).toBe(0)
      const lines = result.stdout.trim().split("\n").filter(Boolean)
      expect(lines.length).toBeGreaterThan(0)
      const events = lines.map((line) => JSON.parse(line) as { type?: string })
      expect(events.map((ev) => ev.type)).toContain("runStarted")
      expect(events.map((ev) => ev.type)).toContain("runFinished")
      expect(events.some((ev) => (ev as { schemaVersion?: number }).schemaVersion === 2)).toBe(true)
      expect(result.stdout).not.toContain("run: kept")
      expect(result.stdout).not.toContain("journal:")
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })
})
