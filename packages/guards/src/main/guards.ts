/**
 * Runtime type guards for codenuke. Migrated from `legacy/codenuke/loop/guards.mjs`.
 */

/**
 * Narrowing guard: `true` iff `value` is a real finite number — not `NaN`, not
 * `±Infinity`, and not a numeric string. Used to validate artifact/config fields
 * before they enter the scoring math.
 */
export const finiteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
