import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const source = require("fs").readFileSync(new URL("../src/utils/psm.js", import.meta.url), "utf8");
const transformed = source
  .replace(/export class GenerationError/g, "class GenerationError")
  .replace(/export default class FormulasGenerator/g, "class FormulasGenerator")
  + "\nmodule.exports = { FormulasGenerator, GenerationError };";
const module = { exports: {} };
new Function("module", "exports", transformed)(module, module.exports);
const { FormulasGenerator, GenerationError } = module.exports;

function generator(overrides = {}) {
  return new FormulasGenerator(
    { carry: 1 }, { abdication: 1 }, {}, { remainder: 2 },
    1, 30, 0, false,
    [[1, 9], [1, 9], [1, 81], [1, 9], [1, 9]],
    [[1, 2, 3]],
    { seed: "test-seed", ...overrides },
  );
}

test("generates deterministic, unique and structured questions", () => {
  const first = generator().generateQuestions();
  const second = generator().generateQuestions();
  assert.deepEqual(first, second);
  assert.equal(first.length, 30);
  assert.equal(new Set(first.map(q => q.display)).size, 30);
  assert.equal(first.every(q => Number.isInteger(q.answer)), true);
});

test("fails instead of looping forever when constraints are impossible", () => {
  const impossible = new FormulasGenerator(
    { carry: 2 }, { abdication: 1 }, {}, { remainder: 2 }, 1, 30, 0, false,
    [[1, 1], [1, 1], [1, 2], [1, 9], [1, 9]], [[1]], { maxAttempts: 20 },
  );
  assert.throws(() => impossible.generateQuestions(), GenerationError);
});

test("rejects division by zero", () => {
  const gen = new FormulasGenerator(
    { carry: 1 }, { abdication: 1 }, {}, { remainder: 2 }, 1, 1, 0, false,
    [[1, 9], [0, 0], [1, 9], [1, 9], [1, 9]], [[4]], { maxAttempts: 10 },
  );
  assert.throws(() => gen.generateQuestions(), GenerationError);
});
