import assert from "node:assert/strict";
import test from "node:test";

import { value } from "./index.js";

test("exports marker value", () => {
  assert.equal(value.includes("TODO_REFACTOR"), true);
});
