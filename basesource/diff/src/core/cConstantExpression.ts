export type CConstantDefinitions =
  | Readonly<Record<string, string | number>>
  | ReadonlyMap<string, string | number>;

type Token =
  | { type: "number"; value: string }
  | { type: "identifier"; value: string }
  | { type: "operator"; value: string }
  | { type: "leftParen" }
  | { type: "rightParen" }
  | { type: "end" };

export function evaluateCConstantExpression(
  expression: string,
  constants: CConstantDefinitions = {}
): number | undefined {
  try {
    const value = evaluateBigIntExpression(expression, constants, new Set());
    const result = Number(value);
    return Number.isSafeInteger(result) ? result : undefined;
  } catch {
    return undefined;
  }
}

function evaluateBigIntExpression(
  expression: string,
  constants: CConstantDefinitions,
  resolving: Set<string>
): bigint {
  const parser = new ConstantExpressionParser(tokenize(expression), constants, resolving);
  const value = parser.parse();
  if (!parser.isAtEnd()) {
    throw new Error("Unexpected trailing token");
  }
  return value;
}

class ConstantExpressionParser {
  private index = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly constants: CConstantDefinitions,
    private readonly resolving: Set<string>
  ) {}

  parse(): bigint {
    return this.parseBitwiseOr();
  }

  isAtEnd(): boolean {
    return this.peek().type === "end";
  }

  private parseBitwiseOr(): bigint {
    let value = this.parseBitwiseXor();
    while (this.matchOperator("|")) {
      value |= this.parseBitwiseXor();
    }
    return value;
  }

  private parseBitwiseXor(): bigint {
    let value = this.parseBitwiseAnd();
    while (this.matchOperator("^")) {
      value ^= this.parseBitwiseAnd();
    }
    return value;
  }

  private parseBitwiseAnd(): bigint {
    let value = this.parseShift();
    while (this.matchOperator("&")) {
      value &= this.parseShift();
    }
    return value;
  }

  private parseShift(): bigint {
    let value = this.parseAdditive();
    while (true) {
      if (this.matchOperator("<<")) {
        value <<= checkedShift(this.parseAdditive());
      } else if (this.matchOperator(">>")) {
        value >>= checkedShift(this.parseAdditive());
      } else {
        return value;
      }
    }
  }

  private parseAdditive(): bigint {
    let value = this.parseMultiplicative();
    while (true) {
      if (this.matchOperator("+")) {
        value += this.parseMultiplicative();
      } else if (this.matchOperator("-")) {
        value -= this.parseMultiplicative();
      } else {
        return value;
      }
    }
  }

  private parseMultiplicative(): bigint {
    let value = this.parseUnary();
    while (true) {
      if (this.matchOperator("*")) {
        value *= this.parseUnary();
      } else if (this.matchOperator("/")) {
        const divisor = this.parseUnary();
        if (divisor === 0n) {
          throw new Error("Division by zero");
        }
        value /= divisor;
      } else if (this.matchOperator("%")) {
        const divisor = this.parseUnary();
        if (divisor === 0n) {
          throw new Error("Division by zero");
        }
        value %= divisor;
      } else {
        return value;
      }
    }
  }

  private parseUnary(): bigint {
    if (this.matchOperator("+")) {
      return this.parseUnary();
    }
    if (this.matchOperator("-")) {
      return -this.parseUnary();
    }
    if (this.matchOperator("~")) {
      return ~this.parseUnary();
    }
    return this.parsePrimary();
  }

  private parsePrimary(): bigint {
    const token = this.advance();
    if (token.type === "number") {
      return parseIntegerLiteral(token.value);
    }
    if (token.type === "identifier") {
      return this.resolveIdentifier(token.value);
    }
    if (token.type === "leftParen") {
      const value = this.parseBitwiseOr();
      if (this.advance().type !== "rightParen") {
        throw new Error("Expected closing parenthesis");
      }
      return value;
    }
    throw new Error("Expected integer expression");
  }

  private resolveIdentifier(name: string): bigint {
    if (this.resolving.has(name)) {
      throw new Error(`Cyclic constant ${name}`);
    }
    const definition = getConstant(this.constants, name);
    if (definition === undefined) {
      throw new Error(`Unknown constant ${name}`);
    }
    if (typeof definition === "number") {
      if (!Number.isSafeInteger(definition)) {
        throw new Error(`Unsafe constant ${name}`);
      }
      return BigInt(definition);
    }

    const nestedResolving = new Set(this.resolving);
    nestedResolving.add(name);
    return evaluateBigIntExpression(definition, this.constants, nestedResolving);
  }

  private matchOperator(operator: string): boolean {
    const token = this.peek();
    if (token.type === "operator" && token.value === operator) {
      this.index += 1;
      return true;
    }
    return false;
  }

  private peek(): Token {
    return this.tokens[this.index] ?? { type: "end" };
  }

  private advance(): Token {
    const token = this.peek();
    this.index += 1;
    return token;
  }
}

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < expression.length) {
    const char = expression[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (/[0-9]/.test(char)) {
      const start = index;
      if (char === "0" && /[xX]/.test(expression[index + 1] ?? "")) {
        index += 2;
        const digitStart = index;
        while (/[0-9a-fA-F]/.test(expression[index] ?? "")) index += 1;
        if (index === digitStart) throw new Error("Invalid hexadecimal literal");
      } else if (char === "0" && /[bB]/.test(expression[index + 1] ?? "")) {
        index += 2;
        const digitStart = index;
        while (/[01]/.test(expression[index] ?? "")) index += 1;
        if (index === digitStart) throw new Error("Invalid binary literal");
      } else {
        while (/[0-9]/.test(expression[index] ?? "")) index += 1;
      }
      while (/[uUlL]/.test(expression[index] ?? "")) index += 1;
      tokens.push({ type: "number", value: expression.slice(start, index) });
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const start = index;
      index += 1;
      while (/[A-Za-z0-9_]/.test(expression[index] ?? "")) index += 1;
      tokens.push({ type: "identifier", value: expression.slice(start, index) });
      continue;
    }
    const pair = expression.slice(index, index + 2);
    if (pair === "<<" || pair === ">>") {
      tokens.push({ type: "operator", value: pair });
      index += 2;
      continue;
    }
    if ("+-*/%&|^~".includes(char)) {
      tokens.push({ type: "operator", value: char });
      index += 1;
      continue;
    }
    if (char === "(") {
      tokens.push({ type: "leftParen" });
      index += 1;
      continue;
    }
    if (char === ")") {
      tokens.push({ type: "rightParen" });
      index += 1;
      continue;
    }
    throw new Error(`Unsupported token ${char}`);
  }
  tokens.push({ type: "end" });
  return tokens;
}

function parseIntegerLiteral(raw: string): bigint {
  const value = raw.replace(/[uUlL]+$/, "");
  if (/^0[xX][0-9a-fA-F]+$/.test(value)) {
    return BigInt(value);
  }
  if (/^0[bB][01]+$/.test(value)) {
    return BigInt(value);
  }
  if (/^0[0-7]+$/.test(value)) {
    return BigInt(`0o${value.slice(1)}`);
  }
  if (/^(?:0|[1-9][0-9]*)$/.test(value)) {
    return BigInt(value);
  }
  throw new Error(`Invalid integer literal ${raw}`);
}

function checkedShift(value: bigint): bigint {
  if (value < 0n || value > 63n) {
    throw new Error("Invalid shift count");
  }
  return value;
}

function getConstant(
  constants: CConstantDefinitions,
  name: string
): string | number | undefined {
  if (constants instanceof Map) {
    return constants.get(name);
  }
  const record = constants as Readonly<Record<string, string | number>>;
  return Object.prototype.hasOwnProperty.call(record, name)
    ? record[name]
    : undefined;
}
