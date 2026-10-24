/**
 * Evaluator for skill step `condition` strings.
 *
 * Conditions used to run through `new Function(...)`, which resolves free names
 * against the host's globals: a skill file — imported from a catalog or drafted by
 * the learning loop — could read `process.env` or call `fetch` (audit CQ-034).
 * This evaluator understands only the documented expression subset and can reach
 * nothing but the variables it is given.
 *
 * Supported: literals (numbers, strings, template literals, true/false/null/undefined,
 * arrays), variables, `.` / `?.` / `[]` member access, the operators
 * `! - + * / % < <= > >= == != === !== && || ??` and `?:`, parentheses, and calls
 * of a fixed set of string/array methods (`includes`, `startsWith`, `endsWith`,
 * `toLowerCase`, `toUpperCase`, `trim`, `indexOf`, `join`, `slice`).
 */

export class ConditionSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConditionSyntaxError';
  }
}

export class ConditionEvaluationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConditionEvaluationError';
  }
}

type Node =
  | { kind: 'literal'; value: unknown }
  | { kind: 'template'; parts: Array<string | Node> }
  | { kind: 'array'; items: Node[] }
  | { kind: 'identifier'; name: string }
  | { kind: 'member'; object: Node; property: Node; computed: boolean; optional: boolean }
  | { kind: 'call'; callee: Node; args: Node[]; optional: boolean }
  | { kind: 'unary'; op: '!' | '-' | '+'; operand: Node }
  | { kind: 'binary'; op: string; left: Node; right: Node }
  | { kind: 'conditional'; test: Node; consequent: Node; alternate: Node };

type Token =
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'template'; parts: Array<string | Token[]> }
  | { type: 'identifier'; value: string }
  | { type: 'punct'; value: string }
  | { type: 'eof' };

const PUNCTUATORS = [
  '===',
  '!==',
  '?.',
  '??',
  '&&',
  '||',
  '==',
  '!=',
  '<=',
  '>=',
  '(',
  ')',
  '[',
  ']',
  '.',
  ',',
  '!',
  '<',
  '>',
  '+',
  '-',
  '*',
  '/',
  '%',
  '?',
  ':',
];

const ALLOWED_METHODS = new Set([
  'includes',
  'startsWith',
  'endsWith',
  'toLowerCase',
  'toUpperCase',
  'trim',
  'indexOf',
  'join',
  'slice',
]);

const FORBIDDEN_PROPERTIES = new Set(['__proto__', 'constructor', 'prototype']);

const MAX_EXPRESSION_LENGTH = 2_000;

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(source[i + 1] ?? ''))) {
      const match = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(i))!;
      tokens.push({ type: 'number', value: Number(match[0]) });
      i += match[0].length;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      const match = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(source.slice(i))!;
      tokens.push({ type: 'identifier', value: match[0] });
      i += match[0].length;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const { value, end } = readQuoted(source, i, ch);
      tokens.push({ type: 'string', value });
      i = end;
      continue;
    }
    if (ch === '`') {
      const { parts, end } = readTemplate(source, i);
      tokens.push({ type: 'template', parts });
      i = end;
      continue;
    }
    const punct = PUNCTUATORS.find((p) => source.startsWith(p, i));
    if (!punct) throw new ConditionSyntaxError(`Unexpected character "${ch}" at ${i}`);
    // `?.` followed by a digit is a ternary with a decimal (`a ?.5 : 1`), not optional chaining.
    if (punct === '?.' && /[0-9]/.test(source[i + 2] ?? '')) {
      tokens.push({ type: 'punct', value: '?' });
      i += 1;
      continue;
    }
    tokens.push({ type: 'punct', value: punct });
    i += punct.length;
  }
  tokens.push({ type: 'eof' });
  return tokens;
}

const ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  '0': '\0',
  b: '\b',
  f: '\f',
  v: '\v',
};

function readQuoted(source: string, start: number, quote: string): { value: string; end: number } {
  let value = '';
  let i = start + 1;
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === quote) return { value, end: i + 1 };
    if (ch === '\\') {
      const next = source[i + 1] ?? '';
      value += ESCAPES[next] ?? next;
      i += 2;
      continue;
    }
    value += ch;
    i++;
  }
  throw new ConditionSyntaxError('Unterminated string literal');
}

function readTemplate(
  source: string,
  start: number,
): { parts: Array<string | Token[]>; end: number } {
  const parts: Array<string | Token[]> = [];
  let text = '';
  let i = start + 1;
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === '`') {
      parts.push(text);
      return { parts, end: i + 1 };
    }
    if (ch === '\\') {
      const next = source[i + 1] ?? '';
      text += ESCAPES[next] ?? next;
      i += 2;
      continue;
    }
    if (ch === '$' && source[i + 1] === '{') {
      parts.push(text);
      text = '';
      let depth = 1;
      let j = i + 2;
      while (j < source.length && depth > 0) {
        if (source[j] === '{') depth++;
        else if (source[j] === '}') depth--;
        if (depth > 0) j++;
      }
      if (depth !== 0) throw new ConditionSyntaxError('Unterminated template expression');
      const inner = tokenize(source.slice(i + 2, j));
      parts.push(inner);
      i = j + 1;
      continue;
    }
    text += ch;
    i++;
  }
  throw new ConditionSyntaxError('Unterminated template literal');
}

class Parser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  parseRoot(): Node {
    const node = this.parseConditional();
    if (this.peek().type !== 'eof')
      throw new ConditionSyntaxError(`Unexpected token ${describe(this.peek())}`);
    return node;
  }

  private peek(): Token {
    return this.tokens[this.pos]!;
  }

  private isPunct(value: string): boolean {
    const token = this.peek();
    return token.type === 'punct' && token.value === value;
  }

  private eat(value: string): boolean {
    if (!this.isPunct(value)) return false;
    this.pos++;
    return true;
  }

  private expect(value: string): void {
    if (!this.eat(value))
      throw new ConditionSyntaxError(`Expected "${value}" but found ${describe(this.peek())}`);
  }

  private parseConditional(): Node {
    const test = this.parseBinary(0);
    if (!this.eat('?')) return test;
    const consequent = this.parseConditional();
    this.expect(':');
    const alternate = this.parseConditional();
    return { kind: 'conditional', test, consequent, alternate };
  }

  private static readonly LEVELS: string[][] = [
    ['??'],
    ['||'],
    ['&&'],
    ['==', '!=', '===', '!=='],
    ['<', '<=', '>', '>='],
    ['+', '-'],
    ['*', '/', '%'],
  ];

  private parseBinary(level: number): Node {
    if (level >= Parser.LEVELS.length) return this.parseUnary();
    let left = this.parseBinary(level + 1);
    for (;;) {
      const token = this.peek();
      if (token.type !== 'punct' || !Parser.LEVELS[level]!.includes(token.value)) return left;
      this.pos++;
      const right = this.parseBinary(level + 1);
      left = { kind: 'binary', op: token.value, left, right };
    }
  }

  private parseUnary(): Node {
    for (const op of ['!', '-', '+'] as const) {
      if (this.eat(op)) return { kind: 'unary', op, operand: this.parseUnary() };
    }
    return this.parsePostfix(this.parsePrimary());
  }

  private parsePostfix(node: Node): Node {
    for (;;) {
      if (this.eat('.')) {
        node = {
          kind: 'member',
          object: node,
          property: this.identifierLiteral(),
          computed: false,
          optional: false,
        };
      } else if (this.eat('?.')) {
        if (this.eat('(')) {
          node = { kind: 'call', callee: node, args: this.parseArgs(), optional: true };
        } else if (this.eat('[')) {
          const property = this.parseConditional();
          this.expect(']');
          node = { kind: 'member', object: node, property, computed: true, optional: true };
        } else {
          node = {
            kind: 'member',
            object: node,
            property: this.identifierLiteral(),
            computed: false,
            optional: true,
          };
        }
      } else if (this.eat('[')) {
        const property = this.parseConditional();
        this.expect(']');
        node = { kind: 'member', object: node, property, computed: true, optional: false };
      } else if (this.eat('(')) {
        node = { kind: 'call', callee: node, args: this.parseArgs(), optional: false };
      } else {
        return node;
      }
    }
  }

  private identifierLiteral(): Node {
    const token = this.peek();
    if (token.type !== 'identifier')
      throw new ConditionSyntaxError(`Expected property name, found ${describe(token)}`);
    this.pos++;
    return { kind: 'literal', value: token.value };
  }

  private parseArgs(): Node[] {
    const args: Node[] = [];
    if (this.eat(')')) return args;
    do {
      args.push(this.parseConditional());
    } while (this.eat(','));
    this.expect(')');
    return args;
  }

  private parsePrimary(): Node {
    const token = this.peek();
    this.pos++;
    switch (token.type) {
      case 'number':
      case 'string':
        return { kind: 'literal', value: token.value };
      case 'template':
        return {
          kind: 'template',
          parts: token.parts.map((part) =>
            typeof part === 'string' ? part : new Parser(part).parseRoot(),
          ),
        };
      case 'identifier':
        switch (token.value) {
          case 'true':
            return { kind: 'literal', value: true };
          case 'false':
            return { kind: 'literal', value: false };
          case 'null':
            return { kind: 'literal', value: null };
          case 'undefined':
            return { kind: 'literal', value: undefined };
          default:
            return { kind: 'identifier', name: token.value };
        }
      case 'punct':
        if (token.value === '(') {
          const inner = this.parseConditional();
          this.expect(')');
          return inner;
        }
        if (token.value === '[') {
          const items: Node[] = [];
          if (!this.eat(']')) {
            do {
              items.push(this.parseConditional());
            } while (this.eat(','));
            this.expect(']');
          }
          return { kind: 'array', items };
        }
        throw new ConditionSyntaxError(`Unexpected token "${token.value}"`);
      case 'eof':
        throw new ConditionSyntaxError('Unexpected end of expression');
    }
  }
}

function describe(token: Token): string {
  switch (token.type) {
    case 'eof':
      return 'end of expression';
    case 'punct':
    case 'identifier':
      return `"${token.value}"`;
    case 'number':
      return String(token.value);
    case 'string':
      return JSON.stringify(token.value);
    case 'template':
      return 'template literal';
  }
}

/** Parse once; throws {@link ConditionSyntaxError} for anything outside the subset. */
export function parseCondition(source: string): Node {
  if (source.length > MAX_EXPRESSION_LENGTH) {
    throw new ConditionSyntaxError(`Condition longer than ${MAX_EXPRESSION_LENGTH} characters`);
  }
  return new Parser(tokenize(source)).parseRoot();
}

/** Returns an error message for an invalid condition, or null when it parses. */
export function validateCondition(source: string): string | null {
  try {
    parseCondition(source);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const OPTIONAL_SHORT_CIRCUIT = Symbol('optional-short-circuit');

export function evaluateConditionExpression(
  source: string,
  scope: Record<string, unknown>,
): unknown {
  const value = evaluate(parseCondition(source), scope);
  return value === OPTIONAL_SHORT_CIRCUIT ? undefined : value;
}

function evaluate(node: Node, scope: Record<string, unknown>): unknown {
  switch (node.kind) {
    case 'literal':
      return node.value;
    case 'template':
      return node.parts
        .map((part) => (typeof part === 'string' ? part : String(unwrap(evaluate(part, scope)))))
        .join('');
    case 'array':
      return node.items.map((item) => unwrap(evaluate(item, scope)));
    case 'identifier':
      // Matches the old `new Function` behaviour: an unknown name is an error (the
      // caller treats it as "condition false"), not `undefined`.
      if (!Object.prototype.hasOwnProperty.call(scope, node.name)) {
        throw new ConditionEvaluationError(`${node.name} is not defined`);
      }
      return scope[node.name];
    case 'member': {
      const object = evaluate(node.object, scope);
      if (object === OPTIONAL_SHORT_CIRCUIT) return OPTIONAL_SHORT_CIRCUIT;
      if (object === null || object === undefined) {
        if (node.optional) return OPTIONAL_SHORT_CIRCUIT;
        throw new ConditionEvaluationError('Cannot read properties of null or undefined');
      }
      const key = node.computed
        ? unwrap(evaluate(node.property, scope))
        : node.property.kind === 'literal'
          ? node.property.value
          : undefined;
      return readProperty(object, key);
    }
    case 'call':
      return callMethod(node, scope);
    case 'unary': {
      const value = unwrap(evaluate(node.operand, scope));
      if (node.op === '!') return !value;
      return node.op === '-' ? -(value as number) : +(value as number);
    }
    case 'binary':
      return evaluateBinary(node, scope);
    case 'conditional':
      return unwrap(evaluate(node.test, scope))
        ? evaluate(node.consequent, scope)
        : evaluate(node.alternate, scope);
  }
}

function unwrap(value: unknown): unknown {
  return value === OPTIONAL_SHORT_CIRCUIT ? undefined : value;
}

function readProperty(object: unknown, key: unknown): unknown {
  if (typeof key !== 'string' && typeof key !== 'number') {
    throw new ConditionEvaluationError('Property keys must be strings or numbers');
  }
  const name = String(key);
  if (FORBIDDEN_PROPERTIES.has(name))
    throw new ConditionEvaluationError(`Access to "${name}" is not allowed`);
  if ((typeof object === 'string' || Array.isArray(object)) && name === 'length')
    return object.length;
  if (typeof object === 'string') {
    return /^\d+$/.test(name) ? object[Number(name)] : undefined;
  }
  if (typeof object !== 'object' || object === null) return undefined;
  // Own data only: no prototype methods, getters on prototypes, or inherited state.
  return Object.prototype.hasOwnProperty.call(object, name)
    ? (object as Record<string, unknown>)[name]
    : undefined;
}

function callMethod(
  node: Extract<Node, { kind: 'call' }>,
  scope: Record<string, unknown>,
): unknown {
  if (
    node.callee.kind !== 'member' ||
    node.callee.computed ||
    node.callee.property.kind !== 'literal'
  ) {
    throw new ConditionEvaluationError('Only string and array methods can be called');
  }
  const method = String(node.callee.property.value);
  if (!ALLOWED_METHODS.has(method))
    throw new ConditionEvaluationError(`Method "${method}" is not allowed`);
  const receiver = evaluate(node.callee.object, scope);
  if (receiver === OPTIONAL_SHORT_CIRCUIT) return OPTIONAL_SHORT_CIRCUIT;
  if (receiver === null || receiver === undefined) {
    if (node.callee.optional || node.optional) return OPTIONAL_SHORT_CIRCUIT;
    throw new ConditionEvaluationError(`Cannot call ${method} on null or undefined`);
  }
  if (typeof receiver !== 'string' && !Array.isArray(receiver)) {
    throw new ConditionEvaluationError(`${method} can only be called on strings and arrays`);
  }
  const fn = (receiver as unknown as Record<string, unknown>)[method];
  if (typeof fn !== 'function')
    throw new ConditionEvaluationError(`${method} is not available on this value`);
  const args = node.args.map((arg) => unwrap(evaluate(arg, scope)));
  return (fn as (...a: unknown[]) => unknown).apply(receiver, args);
}

function evaluateBinary(
  node: Extract<Node, { kind: 'binary' }>,
  scope: Record<string, unknown>,
): unknown {
  const left = unwrap(evaluate(node.left, scope));
  switch (node.op) {
    case '&&':
      return left ? unwrap(evaluate(node.right, scope)) : left;
    case '||':
      return left ? left : unwrap(evaluate(node.right, scope));
    case '??':
      return left ?? unwrap(evaluate(node.right, scope));
  }
  const right = unwrap(evaluate(node.right, scope)) as never;
  const l = left as never;
  switch (node.op) {
    case '==':
      return l == right;
    case '!=':
      return l != right;
    case '===':
      return l === right;
    case '!==':
      return l !== right;
    case '<':
      return l < right;
    case '<=':
      return l <= right;
    case '>':
      return l > right;
    case '>=':
      return l >= right;
    case '+':
      return (l as string) + (right as string);
    case '-':
      return (l as number) - (right as number);
    case '*':
      return (l as number) * (right as number);
    case '/':
      return (l as number) / (right as number);
    case '%':
      return (l as number) % (right as number);
    default:
      throw new ConditionEvaluationError(`Unknown operator ${node.op}`);
  }
}
