import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APPROVED_VERSION = "3.26.6";
const COMPARED_FIELDS = Object.freeze([
  "slug",
  "name",
  "roleDefinition",
  "whenToUse",
  "description",
  "customInstructions",
  "groups",
]);
const CANONICAL_CODE_PROMPT_PREFIX =
  '${Por({cwd:e,supportsComputerUse:n,settings:b,isSubtask:F},H)}\n${X}';
const PINNED_OJU_PARAMETERS =
  "(t,e,n,r,o,s,a,l,c,p,d,m,u,I,A,h,b,E,F,Z)";
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");

function isIdentifierCharacter(character) {
  return character !== undefined && /[$\w]/u.test(character);
}

function skipLineComment(text, start) {
  const newline = text.indexOf("\n", start + 2);
  return newline === -1 ? text.length : newline + 1;
}

function skipBlockComment(text, start) {
  const end = text.indexOf("*/", start + 2);
  if (end === -1) {
    throw new Error("Unterminated JavaScript block comment");
  }
  return end + 2;
}

function skipQuotedString(text, start, quote) {
  for (let index = start + 1; index < text.length; index += 1) {
    if (text[index] === "\\") {
      index += 1;
    } else if (text[index] === quote) {
      return index + 1;
    }
  }
  throw new Error("Unterminated JavaScript string");
}

function skipRegularExpression(text, start) {
  let inCharacterClass = false;

  for (let index = start + 1; index < text.length; index += 1) {
    const character = text[index];
    if (character === "\n" || character === "\r") return null;
    if (character === "\\") {
      index += 1;
    } else if (character === "[") {
      inCharacterClass = true;
    } else if (character === "]") {
      inCharacterClass = false;
    } else if (character === "/" && !inCharacterClass) {
      index += 1;
      while (/[A-Za-z]/u.test(text[index] ?? "")) index += 1;
      return index;
    }
  }

  return null;
}

const REGEX_PREFIX_KEYWORDS = new Set([
  "await",
  "case",
  "delete",
  "do",
  "else",
  "in",
  "instanceof",
  "new",
  "of",
  "return",
  "throw",
  "typeof",
  "void",
  "yield",
]);

function scanJavaScriptIdentifiers(bundleText, visitIdentifier) {
  const templateExpressionDepths = [];
  let mode = "code";
  let canStartRegex = true;
  let previousCodeToken = null;
  let braceDepth = 0;

  for (let index = 0; index < bundleText.length; index += 1) {
    const character = bundleText[index];
    const next = bundleText[index + 1];

    if (mode === "template") {
      if (character === "\\") {
        index += 1;
      } else if (character === "`") {
        mode = "code";
        canStartRegex = false;
        previousCodeToken = "literal";
      } else if (character === "$" && next === "{") {
        templateExpressionDepths.push(1);
        mode = "code";
        canStartRegex = true;
        previousCodeToken = "{";
        braceDepth += 1;
        index += 1;
      }
      continue;
    }

    if (/\s/u.test(character)) continue;

    if (character === "'" || character === '"') {
      index = skipQuotedString(bundleText, index, character) - 1;
      canStartRegex = false;
      previousCodeToken = "literal";
      continue;
    }
    if (character === "`") {
      mode = "template";
      continue;
    }
    if (character === "/" && next === "/") {
      index = skipLineComment(bundleText, index) - 1;
      continue;
    }
    if (character === "/" && next === "*") {
      index = skipBlockComment(bundleText, index) - 1;
      continue;
    }
    if (character === "/" && canStartRegex) {
      const end = skipRegularExpression(bundleText, index);
      if (end !== null) {
        index = end - 1;
        canStartRegex = false;
        previousCodeToken = "literal";
        continue;
      }
    }
    if (character === "/") {
      canStartRegex = true;
      previousCodeToken = "/";
      continue;
    }

    if (/[$A-Za-z_]/u.test(character)) {
      let end = index + 1;
      while (/[$\w]/u.test(bundleText[end] ?? "")) end += 1;
      const identifier = bundleText.slice(index, end);

      visitIdentifier(
        identifier,
        index,
        end,
        previousCodeToken,
        braceDepth,
      );

      canStartRegex = REGEX_PREFIX_KEYWORDS.has(identifier);
      previousCodeToken = identifier;
      index = end - 1;
      continue;
    }

    if (/\d/u.test(character)) {
      let end = index + 1;
      while (/[\w.]/u.test(bundleText[end] ?? "")) end += 1;
      index = end - 1;
      canStartRegex = false;
      previousCodeToken = "literal";
      continue;
    }

    if (templateExpressionDepths.length > 0) {
      const last = templateExpressionDepths.length - 1;
      if (character === "{") {
        templateExpressionDepths[last] += 1;
      } else if (character === "}") {
        templateExpressionDepths[last] -= 1;
        if (templateExpressionDepths[last] === 0) {
          templateExpressionDepths.pop();
          mode = "template";
          previousCodeToken = "}";
          braceDepth -= 1;
          continue;
        }
      }
    }

    canStartRegex = !/[)\]}]/u.test(character);
    previousCodeToken = character;
    if (character === "{") {
      braceDepth += 1;
    } else if (character === "}") {
      braceDepth -= 1;
    }
  }
}

function findDefaultModesArrayStarts(bundleText) {
  const starts = [];

  scanJavaScriptIdentifiers(
    bundleText,
    (identifier, _start, end, previousCodeToken) => {
      if (identifier !== "Mxe" || previousCodeToken === ".") return;

      let cursor = end;
      while (/\s/u.test(bundleText[cursor] ?? "")) cursor += 1;
      if (bundleText[cursor] !== "=" || bundleText[cursor + 1] === "=") return;

      cursor += 1;
      while (/\s/u.test(bundleText[cursor] ?? "")) cursor += 1;
      if (bundleText[cursor] === "[") starts.push(cursor);
    },
  );

  return starts;
}

function extractBalancedJavaScript(bundleText, start, label) {
  const closerByOpener = {
    "(": ")",
    "[": "]",
    "{": "}",
  };
  const rootCloser = closerByOpener[bundleText[start]];
  if (!rootCloser) {
    throw new Error(`${label} must start with a JavaScript delimiter`);
  }

  const delimiters = [{ closer: rootCloser, returnsToTemplate: false }];
  let mode = "code";

  for (let index = start + 1; index < bundleText.length; index += 1) {
    const character = bundleText[index];
    const next = bundleText[index + 1];

    if (mode === "single" || mode === "double") {
      if (character === "\\") {
        index += 1;
      } else if (
        (mode === "single" && character === "'") ||
        (mode === "double" && character === '"')
      ) {
        mode = "code";
      }
      continue;
    }

    if (mode === "template") {
      if (character === "\\") {
        index += 1;
      } else if (character === "`") {
        mode = "code";
      } else if (character === "$" && next === "{") {
        delimiters.push({ closer: "}", returnsToTemplate: true });
        mode = "code";
        index += 1;
      }
      continue;
    }

    if (character === "'") {
      mode = "single";
      continue;
    }
    if (character === '"') {
      mode = "double";
      continue;
    }
    if (character === "`") {
      mode = "template";
      continue;
    }
    if (character === "/" && next === "/") {
      index = skipLineComment(bundleText, index) - 1;
      continue;
    }
    if (character === "/" && next === "*") {
      index = skipBlockComment(bundleText, index) - 1;
      continue;
    }

    if (character === "[") {
      delimiters.push({ closer: "]", returnsToTemplate: false });
    } else if (character === "{") {
      delimiters.push({ closer: "}", returnsToTemplate: false });
    } else if (character === "(") {
      delimiters.push({ closer: ")", returnsToTemplate: false });
    } else if (character === "]" || character === "}" || character === ")") {
      const delimiter = delimiters.pop();
      if (!delimiter || delimiter.closer !== character) {
        throw new Error(`Unbalanced ${label} near character ${index}`);
      }
      if (delimiters.length === 0) {
        return bundleText.slice(start, index + 1);
      }
      if (delimiter.returnsToTemplate) {
        mode = "template";
      }
    }
  }

  throw new Error(`Unterminated ${label}`);
}

function extractBalancedArray(bundleText, start) {
  return extractBalancedJavaScript(bundleText, start, "DEFAULT_MODES array");
}

function literalParseError(message, index) {
  return new Error(
    `literal-only DEFAULT_MODES parse error at character ${index}: ${message}`,
  );
}

function parseHexEscape(source, index, length, label) {
  const digits = source.slice(index, index + length);
  if (!new RegExp(`^[0-9A-Fa-f]{${length}}$`, "u").test(digits)) {
    throw literalParseError(`invalid ${label} escape`, index);
  }
  return {
    character: String.fromCodePoint(Number.parseInt(digits, 16)),
    nextIndex: index + length,
  };
}

function parseJavaScriptString(source, state, quote) {
  const isTemplate = quote === "`";
  let value = "";
  state.index += 1;

  while (state.index < source.length) {
    const character = source[state.index];
    const next = source[state.index + 1];

    if (character === quote) {
      state.index += 1;
      return value;
    }
    if (isTemplate && character === "$" && next === "{") {
      throw literalParseError(
        "template interpolation is not supported",
        state.index,
      );
    }
    if (character === "\n" || character === "\r") {
      if (!isTemplate) {
        throw literalParseError("unterminated string literal", state.index);
      }
      if (character === "\r" && next === "\n") state.index += 1;
      value += "\n";
      state.index += 1;
      continue;
    }
    if (character !== "\\") {
      value += character;
      state.index += 1;
      continue;
    }

    state.index += 1;
    if (state.index >= source.length) {
      throw literalParseError("unterminated escape sequence", state.index);
    }

    const escaped = source[state.index];
    if (escaped === "\n") {
      state.index += 1;
      continue;
    }
    if (escaped === "\r") {
      state.index += source[state.index + 1] === "\n" ? 2 : 1;
      continue;
    }

    const simpleEscapes = {
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
      v: "\v",
      0: "\0",
    };
    if (Object.hasOwn(simpleEscapes, escaped)) {
      value += simpleEscapes[escaped];
      state.index += 1;
      continue;
    }
    if (escaped === "x") {
      const parsed = parseHexEscape(source, state.index + 1, 2, "hexadecimal");
      value += parsed.character;
      state.index = parsed.nextIndex;
      continue;
    }
    if (escaped === "u") {
      if (source[state.index + 1] === "{") {
        const close = source.indexOf("}", state.index + 2);
        const digits =
          close === -1 ? "" : source.slice(state.index + 2, close);
        if (!/^[0-9A-Fa-f]{1,6}$/u.test(digits)) {
          throw literalParseError("invalid Unicode escape", state.index);
        }
        const codePoint = Number.parseInt(digits, 16);
        if (codePoint > 0x10ffff) {
          throw literalParseError(
            "Unicode escape is outside the valid range",
            state.index,
          );
        }
        value += String.fromCodePoint(codePoint);
        state.index = close + 1;
        continue;
      }
      const parsed = parseHexEscape(source, state.index + 1, 4, "Unicode");
      value += parsed.character;
      state.index = parsed.nextIndex;
      continue;
    }

    value += escaped;
    state.index += 1;
  }

  throw literalParseError(
    `unterminated ${isTemplate ? "template" : "string"} literal`,
    state.index,
  );
}

function parseLiteralNumber(source, state) {
  const numberMatch =
    /^[+-]?(?:0[xX][0-9A-Fa-f]+|0[bB][01]+|0[oO][0-7]+|(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?)/u.exec(
      source.slice(state.index),
    );
  if (!numberMatch) {
    throw literalParseError("invalid number literal", state.index);
  }

  state.index += numberMatch[0].length;
  const value = Number(numberMatch[0]);
  if (!Number.isFinite(value)) {
    throw literalParseError("number literal must be finite", state.index);
  }
  return value;
}

function parseLiteralIdentifier(source, state) {
  const start = state.index;
  state.index += 1;
  while (/[$A-Za-z0-9_]/u.test(source[state.index] ?? "")) {
    state.index += 1;
  }
  return source.slice(start, state.index);
}

function skipLiteralWhitespace(source, state) {
  while (/\s/u.test(source[state.index] ?? "")) state.index += 1;
}

function parseLiteralValue(source, state) {
  skipLiteralWhitespace(source, state);
  const character = source[state.index];

  if (character === "[") return parseLiteralArray(source, state);
  if (character === "{") return parseLiteralObject(source, state);
  if (character === "'" || character === '"' || character === "`") {
    return parseJavaScriptString(source, state, character);
  }
  if (
    /[0-9+-]/u.test(character ?? "") ||
    (character === "." && /\d/u.test(source[state.index + 1] ?? ""))
  ) {
    return parseLiteralNumber(source, state);
  }
  if (/[$A-Za-z_]/u.test(character ?? "")) {
    const identifier = parseLiteralIdentifier(source, state);
    if (identifier === "true") return true;
    if (identifier === "false") return false;
    if (identifier === "null") return null;
    throw literalParseError(
      `executable or unsupported identifier "${identifier}"`,
      state.index - identifier.length,
    );
  }

  throw literalParseError(
    `executable or unsupported token ${JSON.stringify(character)}`,
    state.index,
  );
}

function parseLiteralArray(source, state) {
  const values = [];
  state.index += 1;
  skipLiteralWhitespace(source, state);
  if (source[state.index] === "]") {
    state.index += 1;
    return values;
  }

  while (state.index < source.length) {
    values.push(parseLiteralValue(source, state));
    skipLiteralWhitespace(source, state);
    if (source[state.index] === "]") {
      state.index += 1;
      return values;
    }
    if (source[state.index] !== ",") {
      throw literalParseError('expected "," or "]"', state.index);
    }
    state.index += 1;
    skipLiteralWhitespace(source, state);
    if (source[state.index] === "]") {
      state.index += 1;
      return values;
    }
  }

  throw literalParseError("unterminated array literal", state.index);
}

function parseLiteralObject(source, state) {
  const value = {};
  state.index += 1;
  skipLiteralWhitespace(source, state);
  if (source[state.index] === "}") {
    state.index += 1;
    return value;
  }

  while (state.index < source.length) {
    skipLiteralWhitespace(source, state);
    const character = source[state.index];
    let key;
    if (character === "'" || character === '"') {
      key = parseJavaScriptString(source, state, character);
    } else if (/[$A-Za-z_]/u.test(character ?? "")) {
      key = parseLiteralIdentifier(source, state);
    } else {
      throw literalParseError(
        "object keys must be identifiers or string literals",
        state.index,
      );
    }

    skipLiteralWhitespace(source, state);
    if (source[state.index] !== ":") {
      throw literalParseError('expected ":" after object key', state.index);
    }
    state.index += 1;
    value[key] = parseLiteralValue(source, state);
    skipLiteralWhitespace(source, state);
    if (source[state.index] === "}") {
      state.index += 1;
      return value;
    }
    if (source[state.index] !== ",") {
      throw literalParseError('expected "," or "}"', state.index);
    }
    state.index += 1;
    skipLiteralWhitespace(source, state);
    if (source[state.index] === "}") {
      state.index += 1;
      return value;
    }
  }

  throw literalParseError("unterminated object literal", state.index);
}

function parseDefaultModesLiteral(arraySource) {
  const state = { index: 0 };
  const modes = parseLiteralArray(arraySource, state);
  skipLiteralWhitespace(arraySource, state);
  if (state.index !== arraySource.length) {
    throw literalParseError("unexpected content after array", state.index);
  }
  return modes;
}

export function extractDefaultModes(bundleText) {
  if (typeof bundleText !== "string") {
    throw new TypeError("bundleText must be a string");
  }

  const starts = findDefaultModesArrayStarts(bundleText);
  if (starts.length === 0) {
    throw new Error("DEFAULT_MODES assignment Mxe=[...] was not found");
  }
  if (starts.length > 1) {
    throw new Error(
      `Ambiguous DEFAULT_MODES assignment: found ${starts.length} standalone Mxe=[...] candidates`,
    );
  }

  const arraySource = extractBalancedArray(bundleText, starts[0]);
  const modes = parseDefaultModesLiteral(arraySource);
  if (
    !modes.some(
      (mode) =>
        mode !== null && typeof mode === "object" && mode.slug === "code",
    )
  ) {
    throw new Error(
      'Expected exactly one built-in mode with slug "code" in DEFAULT_MODES; found 0',
    );
  }
  return modes;
}

function parseConstrainedString(value, label, { allowBare = false } = {}) {
  if (value.startsWith('"')) {
    let parsed;
    try {
      parsed = JSON.parse(value);
    } catch (error) {
      throw new Error(`${label} must be a valid JSON double-quoted string`, {
        cause: error,
      });
    }
    if (typeof parsed !== "string") {
      throw new Error(`${label} must be a string`);
    }
    return parsed;
  }

  if (allowBare && /^[A-Za-z0-9_-]+$/u.test(value)) {
    return value;
  }

  throw new Error(`${label} must be a JSON double-quoted string`);
}

export function parseProjectModesYaml(yamlText) {
  if (typeof yamlText !== "string") {
    throw new TypeError("yamlText must be a string");
  }

  const lines = yamlText.replaceAll("\r\n", "\n").split("\n");
  let index = 0;
  const skipIgnorable = () => {
    while (
      index < lines.length &&
      (lines[index].trim() === "" || lines[index].trimStart().startsWith("#"))
    ) {
      index += 1;
    }
  };

  skipIgnorable();
  if (lines[index] !== "customModes:") {
    throw new Error("YAML must start with customModes:");
  }
  index += 1;

  const modes = [];
  const slugLines = new Map();
  const scalarFields = new Set([
    "name",
    "roleDefinition",
    "whenToUse",
    "description",
    "customInstructions",
  ]);

  while (index < lines.length) {
    skipIgnorable();
    if (index >= lines.length) break;

    const slugMatch = /^  - slug:\s+(.+)$/u.exec(lines[index]);
    if (!slugMatch) {
      throw new Error(`Expected "  - slug:" at line ${index + 1}`);
    }
    const slugLine = index + 1;
    const mode = {
      slug: parseConstrainedString(slugMatch[1], "slug", {
        allowBare: true,
      }),
    };
    if (slugLines.has(mode.slug)) {
      throw new Error(
        `Duplicate mode slug ${JSON.stringify(mode.slug)} at line ${slugLine}; first defined at line ${slugLines.get(mode.slug)}`,
      );
    }
    slugLines.set(mode.slug, slugLine);
    const seenFields = new Set(["slug"]);
    index += 1;

    while (index < lines.length) {
      if (/^  - slug:\s+/u.test(lines[index])) break;
      if (
        lines[index].trim() === "" ||
        lines[index].trimStart().startsWith("#")
      ) {
        index += 1;
        continue;
      }

      if (lines[index] === "    groups:") {
        if (seenFields.has("groups")) {
          throw new Error(`Duplicate groups field at line ${index + 1}`);
        }
        seenFields.add("groups");
        mode.groups = [];
        index += 1;

        while (index < lines.length) {
          const groupMatch = /^      -\s+(.+)$/u.exec(lines[index]);
          if (!groupMatch) break;
          mode.groups.push(
            parseConstrainedString(groupMatch[1], "group", {
              allowBare: true,
            }),
          );
          index += 1;
        }
        if (mode.groups.length === 0) {
          throw new Error("groups must contain at least one string");
        }
        continue;
      }

      const fieldMatch = /^    ([A-Za-z][A-Za-z0-9]*):\s+(.+)$/u.exec(
        lines[index],
      );
      if (!fieldMatch || !scalarFields.has(fieldMatch[1])) {
        throw new Error(`Unsupported YAML content at line ${index + 1}`);
      }
      const [, field, value] = fieldMatch;
      if (seenFields.has(field)) {
        throw new Error(`Duplicate ${field} field at line ${index + 1}`);
      }
      seenFields.add(field);
      mode[field] = parseConstrainedString(value, field);
      index += 1;
    }

    modes.push(mode);
  }

  if (modes.length === 0) {
    throw new Error("customModes must contain at least one mode");
  }

  return modes;
}

function displayValue(value) {
  return value === undefined ? "<undefined>" : JSON.stringify(value);
}

export function compareMode(expected, actual) {
  const differences = [];

  for (const field of COMPARED_FIELDS) {
    const expectedValue = expected?.[field];
    const actualValue = actual?.[field];
    const equal =
      field === "groups"
        ? JSON.stringify(expectedValue) === JSON.stringify(actualValue)
        : Object.is(expectedValue, actualValue);

    if (!equal) {
      differences.push(
        `${field}: expected ${displayValue(expectedValue)}, actual ${displayValue(actualValue)}`,
      );
    }
  }

  return differences;
}

function defaultPaths() {
  return {
    packageJsonPath: path.join(
      REPOSITORY_ROOT,
      "org",
      "bob-code",
      "package.json",
    ),
    bundlePath: path.join(
      REPOSITORY_ROOT,
      "org",
      "bob-code",
      "dist",
      "extension.js",
    ),
    projectModesPath: path.join(
      REPOSITORY_ROOT,
      ".bob",
      "custom_modes.yaml",
    ),
    rulesCodePath: path.join(REPOSITORY_ROOT, ".bob", "rules-code"),
  };
}

function resolvePaths(paths = {}) {
  return { ...defaultPaths(), ...paths };
}

function assertRulesCodeEmpty(rulesCodePath) {
  if (!existsSync(rulesCodePath)) return;
  if (!statSync(rulesCodePath).isDirectory() || readdirSync(rulesCodePath).length) {
    throw new Error(
      `${path.join(".bob", "rules-code")} must be absent or empty: ${rulesCodePath}`,
    );
  }
}

function findPromptBuilderBodies(bundleText) {
  const promptBuilders = [];

  scanJavaScriptIdentifiers(bundleText, (identifier, start, end) => {
    if (identifier !== "oju") return;
    const prefix = bundleText.slice(Math.max(0, start - 80), start);
    if (!/(?:^|[^$\w])async\s+function\s*$/u.test(prefix)) return;

    let cursor = end;
    while (/\s/u.test(bundleText[cursor] ?? "")) cursor += 1;
    if (bundleText[cursor] !== "(") return;

    try {
      const parameters = extractBalancedJavaScript(
        bundleText,
        cursor,
        "oju parameter list",
      );
      cursor += parameters.length;
      while (/\s/u.test(bundleText[cursor] ?? "")) cursor += 1;
      if (bundleText[cursor] !== "{") return;
      promptBuilders.push({
        parameters,
        body: extractBalancedJavaScript(
          bundleText,
          cursor,
          "oju function body",
        ),
      });
    } catch {
      // A malformed lookalike is not the pinned Bob 3.26.6 prompt builder.
    }
  });

  return promptBuilders;
}

function skipJavaScriptTrivia(text, start) {
  let cursor = start;

  while (cursor < text.length) {
    if (/\s/u.test(text[cursor])) {
      cursor += 1;
    } else if (text[cursor] === "/" && text[cursor + 1] === "/") {
      cursor = skipLineComment(text, cursor);
    } else if (text[cursor] === "/" && text[cursor + 1] === "*") {
      cursor = skipBlockComment(text, cursor);
    } else {
      break;
    }
  }

  return cursor;
}

function findJavaScriptStatementEnd(text, start) {
  const delimiters = [];
  let mode = "code";
  let canStartRegex = true;

  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];

    if (mode === "template") {
      if (character === "\\") {
        index += 1;
      } else if (character === "`") {
        mode = "code";
        canStartRegex = false;
      } else if (character === "$" && next === "{") {
        delimiters.push({ closer: "}", returnsToTemplate: true });
        mode = "code";
        canStartRegex = true;
        index += 1;
      }
      continue;
    }

    if (/\s/u.test(character)) continue;
    if (character === "'" || character === '"') {
      index = skipQuotedString(text, index, character) - 1;
      canStartRegex = false;
      continue;
    }
    if (character === "`") {
      mode = "template";
      continue;
    }
    if (character === "/" && next === "/") {
      index = skipLineComment(text, index) - 1;
      continue;
    }
    if (character === "/" && next === "*") {
      index = skipBlockComment(text, index) - 1;
      continue;
    }
    if (character === "/" && canStartRegex) {
      const end = skipRegularExpression(text, index);
      if (end !== null) {
        index = end - 1;
        canStartRegex = false;
        continue;
      }
    }
    if (character === "/") {
      canStartRegex = true;
      continue;
    }

    if (/[$A-Za-z_]/u.test(character)) {
      let end = index + 1;
      while (/[$\w]/u.test(text[end] ?? "")) end += 1;
      canStartRegex = REGEX_PREFIX_KEYWORDS.has(text.slice(index, end));
      index = end - 1;
      continue;
    }
    if (/\d/u.test(character)) {
      let end = index + 1;
      while (/[\w.]/u.test(text[end] ?? "")) end += 1;
      index = end - 1;
      canStartRegex = false;
      continue;
    }

    if (character === "[" || character === "{" || character === "(") {
      const closerByOpener = { "(": ")", "[": "]", "{": "}" };
      delimiters.push({
        closer: closerByOpener[character],
        returnsToTemplate: false,
      });
      canStartRegex = true;
      continue;
    }
    if (character === "]" || character === "}" || character === ")") {
      const delimiter = delimiters.pop();
      if (!delimiter || delimiter.closer !== character) {
        return index;
      }
      if (delimiter.returnsToTemplate) mode = "template";
      canStartRegex = false;
      continue;
    }
    if (character === ";" && delimiters.length === 0) return index + 1;

    canStartRegex = !/[)\]}]/u.test(character);
  }

  return text.length;
}

function parseImmediateIfHeader(body, ifStart) {
  let cursor = skipJavaScriptTrivia(body, ifStart + 2);
  if (body[cursor] !== "(") return null;

  const condition = extractBalancedJavaScript(
    body,
    cursor,
    "if condition",
  );
  cursor = skipJavaScriptTrivia(body, cursor + condition.length);

  return { condition, statementStart: cursor };
}

function parseImmediateReturnIf(body, ifStart) {
  const header = parseImmediateIfHeader(body, ifStart);
  if (header === null) return null;
  const { condition, statementStart } = header;
  let cursor = statementStart;
  if (
    body.slice(cursor, cursor + 6) !== "return" ||
    isIdentifierCharacter(body[cursor + 6])
  ) {
    return null;
  }

  const returnStart = cursor;
  cursor += 6;
  while (/[ \t\f\v]/u.test(body[cursor] ?? "")) cursor += 1;
  let hasPinnedCodeReturnShape = body[cursor] === "`";
  if (hasPinnedCodeReturnShape) {
    cursor += 1;
    while (/\s/u.test(body[cursor] ?? "")) cursor += 1;
    hasPinnedCodeReturnShape = body.startsWith(
      CANONICAL_CODE_PROMPT_PREFIX,
      cursor,
    );
    cursor += CANONICAL_CODE_PROMPT_PREFIX.length;
    hasPinnedCodeReturnShape =
      hasPinnedCodeReturnShape &&
      body[cursor] === "`" &&
      body[cursor + 1] === ";";
  }

  return {
    ifStart,
    returnStart,
    isCodeCondition:
      condition.replace(/\s/gu, "") === '(r==="code")',
    hasPinnedCodeReturnShape,
  };
}

function assertOptimizedCodeBranch(bundleText) {
  const promptBuilders = findPromptBuilderBodies(bundleText);
  if (promptBuilders.length > 1) {
    throw new Error(
      `Ambiguous executable async function oju(...) prompt builder: found ${promptBuilders.length} candidates`,
    );
  }
  if (promptBuilders.length === 0) {
    throw new Error(
      "The optimized Code prompt branch with an immediate cost-effective prompt call was not found",
    );
  }

  const [{ parameters, body }] = promptBuilders;
  if (parameters.replace(/\s/gu, "") !== PINNED_OJU_PARAMETERS) {
    throw new Error(
      "The executable async function oju parameter list does not match the pinned Bob Code 3.26.6 prompt-builder signature",
    );
  }

  const topLevelIfStarts = [];
  const topLevelReturnStarts = [];
  const topLevelThrowStarts = [];

  scanJavaScriptIdentifiers(body, (identifier, start, _end, _previous, braceDepth) => {
    if (braceDepth !== 1) return;
    if (identifier === "if") topLevelIfStarts.push(start);
    if (identifier === "return") topLevelReturnStarts.push(start);
    if (identifier === "throw") topLevelThrowStarts.push(start);
  });

  const topLevelIfStatements = topLevelIfStarts
    .map((start) => parseImmediateReturnIf(body, start))
    .filter((statement) => statement !== null);
  const controlledReturnStarts = new Set(
    topLevelIfStatements.map((statement) => statement.returnStart),
  );
  const firstUnconditionalReturn = topLevelReturnStarts.find(
    (start) => !controlledReturnStarts.has(start),
  );
  const controlledThrowStarts = new Set(
    topLevelIfStarts
      .map((start) => parseImmediateIfHeader(body, start)?.statementStart)
      .filter(
        (start) =>
          start !== undefined &&
          body.slice(start, start + 5) === "throw" &&
          !isIdentifierCharacter(body[start + 5]),
      ),
  );
  const firstUnconditionalThrow = topLevelThrowStarts.find(
    (start) => !controlledThrowStarts.has(start),
  );
  const firstUnconditionalExit = Math.min(
    firstUnconditionalReturn ?? Number.POSITIVE_INFINITY,
    firstUnconditionalThrow ?? Number.POSITIVE_INFINITY,
  );
  const firstCodeReturn = topLevelIfStatements.find(
    (statement) => statement.isCodeCondition,
  );
  const hasOptimizedCodeReturn =
    firstCodeReturn?.hasPinnedCodeReturnShape === true &&
    firstCodeReturn.ifStart < firstUnconditionalExit;

  if (!hasOptimizedCodeReturn) {
    throw new Error(
      "The optimized Code prompt branch with an immediate cost-effective prompt call was not found",
    );
  }
}

export function verifyBaseline(paths) {
  const resolvedPaths = resolvePaths(paths);
  const packageJson = JSON.parse(
    readFileSync(resolvedPaths.packageJsonPath, "utf8"),
  );

  if (packageJson.version !== APPROVED_VERSION) {
    throw new Error(
      `Bob Code version mismatch: expected ${APPROVED_VERSION}, actual ${displayValue(packageJson.version).replaceAll('"', "")}`,
    );
  }

  const bundleText = readFileSync(resolvedPaths.bundlePath, "utf8");
  const defaultModes = extractDefaultModes(bundleText);
  const builtInCodeModes = defaultModes.filter(
    (mode) =>
      mode !== null && typeof mode === "object" && mode.slug === "code",
  );
  if (builtInCodeModes.length !== 1) {
    throw new Error(
      `Expected exactly one built-in mode with slug "code" in DEFAULT_MODES; found ${builtInCodeModes.length}`,
    );
  }
  const [expected] = builtInCodeModes;

  const projectModes = parseProjectModesYaml(
    readFileSync(resolvedPaths.projectModesPath, "utf8"),
  );
  const actual = projectModes.find((mode) => mode.slug === "code");
  if (!actual) {
    throw new Error("Project code mode was not found in customModes");
  }

  const differences = compareMode(expected, actual);
  if (differences.length > 0) {
    throw new Error(
      `Project code mode differs from the Bob Code ${APPROVED_VERSION} baseline:\n- ${differences.join("\n- ")}`,
    );
  }

  assertRulesCodeEmpty(resolvedPaths.rulesCodePath);
  assertOptimizedCodeBranch(bundleText);

  return {
    version: APPROVED_VERSION,
    modeSlug: "code",
    comparedFields: [...COMPARED_FIELDS],
    optimizedCodeBranch: true,
    rulesCodeEmpty: true,
    paths: resolvedPaths,
  };
}

function runCli() {
  try {
    const result = verifyBaseline();
    console.log(`PASS: Bob Code version ${result.version}`);
    console.log("PASS: project code mode matches the built-in baseline");
    console.log("PASS: .bob/rules-code is absent or empty");
    console.log("PASS: optimized Code prompt branch is present");
  } catch (error) {
    console.error(`FAIL: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(SCRIPT_PATH)
) {
  runCli();
}
