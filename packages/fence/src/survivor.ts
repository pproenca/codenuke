/**
 * RULE-009 — Survivor classification (only green survives).
 *
 * A mutant SURVIVES the fence only if its test outcome is "green" (the tests
 * still passed despite the injected behavior change — the fence failed to catch
 * it). Both "fail" and "timeout" count as CAUGHT (killed). A missing status
 * defaults to "green" — conservative: an unknown outcome is treated as a
 * survivor, lowering the score (fail-toward-risk).
 *
 * caught = #(killed); total = plan.length; the Wilson interval over
 * (caught, total) and the admissibility decision live in wilson.ts (RULE-006).
 */

/** A mutant's test outcome. `undefined`/missing is treated as "green". */
export type MutantStatus = "green" | "fail" | "timeout" | undefined;

/**
 * RULE-009 — classify a single mutant.
 *
 * Two equivalent shapes are accepted so the truth table can be exercised
 * directly and the rule reads naturally:
 *   - `classify(status)` from the raw test outcome, or
 *   - the boolean form via `survivesFromTestPassed(testPassed)`.
 *
 * Returns `true` iff the mutant SURVIVED (escaped the fence).
 */
export const classify = (status: MutantStatus): boolean => status == null || status === "green";

/**
 * RULE-009 — boolean form: a mutant survives iff its tests still PASSED.
 * (testPassed === true  ⇒ green  ⇒ survives;
 *  testPassed === false ⇒ fail/timeout ⇒ caught.)
 */
export const survivesFromTestPassed = (testPassed: boolean): boolean => testPassed === true;

/** A survivor (true) is NOT caught; a caught mutant (false survival) is killed. */
export const isCaught = (status: MutantStatus): boolean => !classify(status);

/**
 * RULE-009 — tally an audit plan's outcomes.
 * caught = #(fail|timeout); survivors = #(green|missing); total = outcomes.length.
 */
export const tally = (
  outcomes: readonly MutantStatus[],
): { readonly caught: number; readonly survivors: number; readonly total: number } => {
  let caught = 0;
  let survivors = 0;
  for (const o of outcomes) {
    if (classify(o)) survivors += 1;
    else caught += 1;
  }
  return { caught, survivors, total: outcomes.length };
};
