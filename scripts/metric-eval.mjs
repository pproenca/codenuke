#!/usr/bin/env node
import { readFileSync } from "node:fs"

const usage = () => {
  console.error("usage: node scripts/metric-eval.mjs <heldout-corpus.json>")
  process.exitCode = 2
}

const stableHash = (input) => {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

const ratio = (a, b) => (b === 0 ? null : a / b)
const bool = (value) => value === true
const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback)

const readManifest = (file) => {
  const parsed = JSON.parse(readFileSync(file, "utf8"))
  const rows = Array.isArray(parsed) ? parsed : parsed.candidates
  if (!Array.isArray(rows)) throw new Error("manifest must be an array or { candidates: [...] }")
  return rows.map((row, index) => ({
    id: String(row.id ?? `candidate-${index + 1}`),
    dL: num(row.dL),
    loss: row.loss === null || row.loss === undefined ? null : num(row.loss),
    metricKeep: row.metricKeep,
    testsPass: bool(row.testsPass),
    reverted: bool(row.reverted),
    retainedReduction: num(row.retainedReduction, bool(row.reverted) ? 0 : num(row.dL)),
    verificationCost: num(row.verificationCost),
    locOnlyKeep: row.locOnlyKeep,
  }))
}

const evaluate = (name, rows, accept) => {
  const accepted = rows.filter(accept)
  const retainedReduction = accepted.reduce((sum, row) => sum + (row.reverted ? 0 : row.retainedReduction), 0)
  const verificationCost = accepted.reduce((sum, row) => sum + row.verificationCost, 0)
  return {
    policy: name,
    accepted: accepted.length,
    revertRate: ratio(accepted.filter((row) => row.reverted).length, accepted.length),
    retainedReduction,
    verificationCostPerKeptReduction: ratio(verificationCost, retainedReduction),
  }
}

const withLift = (reports, baselineName = "random") => {
  const baseline = reports.find((report) => report.policy === baselineName)
  return reports.map((report) => ({
    ...report,
    lift: baseline ? ratio(report.retainedReduction, baseline.retainedReduction) : null,
  }))
}

const main = () => {
  const file = process.argv[2]
  if (!file) return usage()
  const rows = readManifest(file)
  const metricRate = rows.length === 0
    ? 0
    : rows.filter((row) => row.metricKeep === true || (row.metricKeep === undefined && row.loss !== null && row.loss < 0)).length / rows.length
  const reports = [
    evaluate("weighted-metric", rows, (row) => row.metricKeep === true || (row.metricKeep === undefined && row.loss !== null && row.loss < 0)),
    evaluate("dL-positive", rows, (row) => row.dL > 0),
    evaluate("loc-only", rows, (row) => row.locOnlyKeep === true || (row.locOnlyKeep === undefined && row.dL > 0)),
    evaluate("tests-pass-only", rows, (row) => row.testsPass),
    evaluate("random", rows, (row) => stableHash(row.id) / 0xffffffff < metricRate),
  ]
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, candidates: rows.length, reports: withLift(reports) }, null, 2)}\n`)
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
