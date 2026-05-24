import { describe, it } from "@effect/vitest";

/**
 * Artifact validation (RULE-022/023/024/030/054) is the central fail-closed gate.
 * The readers decode via Schema then recompute-and-compare (anti-tamper) — that
 * effectful machinery lands in a later wave, so `ArtifactsLive` is a stub here and
 * these acceptance tests are SKIPPED. They are written now so the RULE-054/030
 * FIXES stay tracked in the traceability map.
 */
describe("Artifacts service (stubbed — Schema decode + recompute-and-compare)", () => {
  // RULE-022 — fence artifact status + anti-tamper
  it.skip("RULE-022 hand-edited region (admissible:true but lo<threshold) → invalid-regions", () => {
    // TODO: re-derive wilson(caught,total); compare p/lo/hi within 1e-9; check admissible==(lo>=threshold).
  });

  it.skip("RULE-022 stored p differing from wilson(caught,total) by >1e-9 → invalid-regions", () => {
    // TODO: anti-tamper Wilson re-derivation.
  });

  it.skip("RULE-022 method!=ast-aware or threshold!=fenceLB → invalid-metadata; baseline drift → stale", () => {
    // TODO: metadata + staleness checks.
  });

  // RULE-023 — calibration artifact status + provenance
  it.skip("RULE-023 commitsSampled=2 with custom scales → invalid-provenance; with default scales → usable", () => {
    // TODO: provenance branch (<3 commits but == defaults ⇒ valid).
  });

  it.skip("RULE-023 sL=0 → invalid-scales; drifted baseline → stale", () => {
    // TODO: positive-finite scale check + staleness.
  });

  // RULE-024 — value-proxy validation contract + re-derivation
  it.skip("RULE-024 stored rho differs from rho re-derived from rows by >1e-9 → fails", () => {
    // TODO: re-run validateValueProxy; require matching rho/pValue within 1e-9 and identical pMethod.
  });

  it.skip("RULE-024 hand-edited passed:true with mismatched p-value → rejected by re-derivation", () => {
    // TODO: anti-tamper p-value re-derivation.
  });

  // RULE-030 — fail-closed startup gate (ordered), INCLUDING the RULE-054 changecost step (FIX)
  it.skip("RULE-030 startup gate fails closed at the FIRST gap in fixed order (fence → calibration → value-proxy)", () => {
    // TODO: ordered check; first failure → exitCode 1, stop.
  });

  it.skip("RULE-030/054 validateAll INCLUDES a changecost readiness check (FIX — legacy gate omitted it)", () => {
    // TODO: assert Artifacts.validateAll() runs readChangeCost() so value-proxy Vhat
    // provenance chains to a validated changecost artifact. This is the RULE-054 fix.
  });

  // RULE-054 — changecost artifact re-derivation (UN-WIRED in legacy; FIX = wire it)
  it.skip("RULE-054 stored cost differing from editTokens + beta*verifyFrac by >1e-9 → invalid", () => {
    // TODO: per done-result, verifyFrac ~= changeCostVerifyFrac(regions,fence); cost ~= editTokens + beta*verifyFrac;
    //       Vhat===null iff no done results else mean(costs); tolerance 1e-9; null-fence → expected verifyFrac 1.
  });

  it.skip("RULE-054 changecost is reachable from the startup gate (no production module bypasses it) — the defect to fix", () => {
    // TODO: call-graph assertion — Artifacts.validateAll is the single caller path
    // for changecost validation; nothing derives value-proxy from an unvalidated changecost.
  });
});
