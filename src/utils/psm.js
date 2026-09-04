const OPERATOR_SYMBOLS = { 1: "+", 2: "-", 3: "*", 4: "/" };
const DISPLAY_SYMBOLS = { "+": "+", "-": "-", "*": "×", "/": "÷" };

export class GenerationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "GenerationError";
    this.details = details;
  }
}

function hashSeed(seed) {
  let hash = 2166136261;
  for (const char of String(seed)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRandom(seed) {
  let state = hashSeed(seed || `${Date.now()}-${Math.random()}`) || 1;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInteger(random, [min, max]) {
  return Math.floor(random() * (max - min + 1)) + min;
}

function lastDigit(value) {
  return Math.abs(value) % 10;
}

function operationMatchesRules(operator, left, right, result, options) {
  if (operator === "+") {
    const hasCarry = lastDigit(left) + lastDigit(right) >= 10;
    return options.carry === 1 || (options.carry === 2 ? hasCarry : !hasCarry);
  }
  if (operator === "-") {
    const hasBorrow = lastDigit(left) < lastDigit(right);
    return options.abdication === 1 || (options.abdication === 2 ? hasBorrow : !hasBorrow);
  }
  if (operator === "/") {
    if (right === 0 || left <= 0 || right < 0) return false;
    const remainder = left % right;
    if (options.remainder === 2 && remainder !== 0) return false;
    if (options.remainder === 3 && remainder === 0) return false;
  }
  return Number.isFinite(result);
}

function applyOperation(operator, left, right, options) {
  let result;
  if (operator === "+") result = left + right;
  if (operator === "-") result = left - right;
  if (operator === "*") result = left * right;
  if (operator === "/") result = right === 0 ? Number.NaN : left / right;
  if (!operationMatchesRules(operator, left, right, result, options)) return null;
  return { result, left, right, operator };
}

function evaluateFlat(numbers, operators, options) {
  const values = [...numbers];
  const ops = [...operators];
  const steps = [];

  for (const precedence of [["*", "/"], ["+", "-"]]) {
    let index = 0;
    while (index < ops.length) {
      if (!precedence.includes(ops[index])) {
        index += 1;
        continue;
      }
      const operation = applyOperation(ops[index], values[index], values[index + 1], options);
      if (!operation) return null;
      steps.push(operation);
      values.splice(index, 2, operation.result);
      ops.splice(index, 1);
    }
  }

  return { result: values[0], steps };
}

function evaluateExpression(numbers, operators, bracketStart, options) {
  if (bracketStart === null) return evaluateFlat(numbers, operators, options);
  const bracketOperation = applyOperation(
    operators[bracketStart],
    numbers[bracketStart],
    numbers[bracketStart + 1],
    options,
  );
  if (!bracketOperation) return null;

  const reducedNumbers = [...numbers];
  const reducedOperators = [...operators];
  reducedNumbers.splice(bracketStart, 2, bracketOperation.result);
  reducedOperators.splice(bracketStart, 1);
  const rest = evaluateFlat(reducedNumbers, reducedOperators, options);
  if (!rest) return null;
  return { result: rest.result, steps: [bracketOperation, ...rest.steps] };
}

function formatExpression(numbers, operators, bracketStart = null) {
  let result = "";
  for (let index = 0; index < numbers.length; index += 1) {
    if (index === bracketStart) result += "(";
    result += String(numbers[index]);
    if (bracketStart !== null && index === bracketStart + 1) result += ")";
    if (operators[index]) result += DISPLAY_SYMBOLS[operators[index]];
  }
  return result;
}

function replaceUnknown(expression, answer, random) {
  const matches = [...expression.matchAll(/\d+/g)];
  if (matches.length === 0) return { display: expression, unknownAnswer: null };
  const match = matches[Math.floor(random() * matches.length)];
  return {
    display: `${expression.slice(0, match.index)}__${expression.slice(match.index + match[0].length)}=${answer}`,
    unknownAnswer: Number(match[0]),
  };
}

export default class FormulasGenerator {
  constructor(addattrs, subattrs, multattrs, divattrs, step, number, isResult, isBracket, multistep, symbols, runtime = {}) {
    if (![1, 2, 3].includes(step)) throw new GenerationError("运算步数只能是 1、2 或 3");
    if (!Number.isInteger(number) || number < 1 || number > 1000) throw new GenerationError("题目数量必须在 1 到 1000 之间");

    this.options = {
      carry: Number(addattrs?.carry ?? 1),
      abdication: Number(subattrs?.abdication ?? 1),
      remainder: Number(divattrs?.remainder ?? 2),
    };
    this.step = step;
    this.number = number;
    this.isResult = Number(isResult);
    this.isBracket = Boolean(isBracket);
    this.ranges = multistep.slice(0, step + 1).map(([min, max]) => [Number(min), Number(max)]);
    this.resultRange = multistep[4].map(Number);
    this.symbols = symbols.slice(0, step).map(items => items.map(Number));
    this.random = createRandom(runtime.seed);
    this.maxAttempts = Number(runtime.maxAttempts ?? Math.max(5000, number * 500));
    this.questions = [];
    this.validateConfiguration();
  }

  validateConfiguration() {
    for (const [min, max] of [...this.ranges, this.resultRange]) {
      if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) {
        throw new GenerationError("所有数值范围必须是最小值不大于最大值的整数区间");
      }
    }
    if (this.symbols.some(items => items.length === 0 || items.some(item => !OPERATOR_SYMBOLS[item]))) {
      throw new GenerationError("每一步至少需要选择一个有效运算符");
    }
    if (![0, 1].includes(this.isResult)) throw new GenerationError("题型设置无效");
    if (this.step > 1 && this.options.remainder === 3 && this.symbols.some(items => items.includes(4))) {
      throw new GenerationError("带余数除法不能用于多步运算");
    }
  }

  createCandidate() {
    const numbers = this.ranges.map(range => randomInteger(this.random, range));
    const operators = this.symbols.map(items => OPERATOR_SYMBOLS[items[Math.floor(this.random() * items.length)]]);
    const bracketStart = this.isBracket && this.step > 1 ? Math.floor(this.random() * this.step) : null;
    const evaluated = evaluateExpression(numbers, operators, bracketStart, this.options);
    if (!evaluated) return null;

    let answer = evaluated.result;
    let remainder = null;
    if (this.step === 1 && operators[0] === "/" && this.options.remainder === 3) {
      answer = Math.floor(numbers[0] / numbers[1]);
      remainder = numbers[0] % numbers[1];
    } else if (!Number.isInteger(answer)) {
      return null;
    }
    if (answer < this.resultRange[0] || answer > this.resultRange[1]) return null;

    const expression = formatExpression(numbers, operators, bracketStart);
    const answerText = remainder === null ? String(answer) : `${answer}余${remainder}`;
    const unknown = this.isResult === 1 ? replaceUnknown(expression, answerText, this.random) : null;
    const display = unknown ? unknown.display : `${expression}=`;

    return {
      id: "",
      display,
      expression,
      answer,
      answerText,
      remainder,
      unknownAnswer: unknown?.unknownAnswer ?? null,
      operators,
      operands: numbers,
      steps: evaluated.steps,
    };
  }

  generateQuestions() {
    const unique = new Map();
    let attempts = 0;
    while (unique.size < this.number && attempts < this.maxAttempts) {
      attempts += 1;
      const question = this.createCandidate();
      if (question) unique.set(question.display, question);
    }
    if (unique.size < this.number) {
      throw new GenerationError(
        `当前条件最多只生成了 ${unique.size} 道不重复题，未达到 ${this.number} 道。请放宽数值范围或规则。`,
        { requested: this.number, generated: unique.size, attempts },
      );
    }
    this.questions = [...unique.values()].map((question, index) => ({ ...question, id: `q-${index + 1}` }));
    return this.questions;
  }

  generate() {
    return this.generateQuestions().map(question => question.display);
  }
}
