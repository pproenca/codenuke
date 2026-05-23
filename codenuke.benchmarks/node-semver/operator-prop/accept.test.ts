"use strict";
const { test } = require("tap");

const operators = { gt: ">", gte: ">=", lt: "<", lte: "<=", eq: "===", neq: "!==" };

test("each comparator exposes its operator string", (t) => {
  for (const [name, op] of Object.entries(operators)) {
    t.equal(require(`../functions/${name}`).operator, op, `${name}.operator === ${op}`);
  }
  t.end();
});
