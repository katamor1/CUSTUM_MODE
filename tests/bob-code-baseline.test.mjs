import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  compareMode,
  extractDefaultModes,
  parseProjectModesYaml,
  verifyBaseline,
} from "../scripts/bob-code-baseline.mjs";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(TEST_DIR, "..");
const SCRIPT_PATH = path.join(
  REPOSITORY_ROOT,
  "scripts",
  "bob-code-baseline.mjs",
);
const ACTUAL_PACKAGE_JSON_PATH = path.join(
  REPOSITORY_ROOT,
  "org",
  "bob-code",
  "package.json",
);
const ACTUAL_BUNDLE_PATH = path.join(
  REPOSITORY_ROOT,
  "org",
  "bob-code",
  "dist",
  "extension.js",
);
const CANONICAL_CODE_PROMPT_PREFIX =
  '${Por({cwd:e,supportsComputerUse:n,settings:b,isSubtask:F},H)}\n${X}';
const PINNED_OJU_PARAMETERS =
  "(t,e,n,r,o,s,a,l,c,p,d,m,u,I,A,h,b,E,F,Z)";

const CODE_MODE = Object.freeze({
  slug: "code",
  name: "💻 Code",
  roleDefinition:
    "You are Bob, a highly skilled software engineer with extensive knowledge in many programming languages, frameworks, design patterns, and best practices.",
  whenToUse:
    "Use this mode when you need to write, modify, or refactor code. Ideal for implementing features, fixing bugs, creating new files, or making code improvements across any programming language or framework. Does not support MCP or Browser tools.",
  description: "Write and modify code",
  groups: ["read", "edit", "command"],
});

function yamlForModes(modes) {
  const lines = ["customModes:"];

  for (const mode of modes) {
    lines.push(`  - slug: ${mode.slug}`);
    for (const field of [
      "name",
      "roleDefinition",
      "whenToUse",
      "description",
      "customInstructions",
    ]) {
      if (Object.hasOwn(mode, field)) {
        lines.push(`    ${field}: ${JSON.stringify(mode[field])}`);
      }
    }
    lines.push("    groups:");
    for (const group of mode.groups) {
      lines.push(`      - ${group}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function bundleForModes(modes, { optimizedBranch = true } = {}) {
  const codeBranch = optimizedBranch
    ? `if(r==="code")return\`${CANONICAL_CODE_PROMPT_PREFIX}\`;`
    : 'if(r==="code")return`${legacyPrompt()}\\n${X}`;';
  const promptBuilder = [
    `async function oju${PINNED_OJU_PARAMETERS}{`,
    'if(!t)throw new Error("Extension context is required");',
    'let v="role",X="system prompt";',
    codeBranch,
    "return`${v}\\n${X}`;",
    "}",
  ].join("");
  return `var Mxe=${JSON.stringify(modes)};${promptBuilder}`;
}

function createFixture(t, options = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "bob-code-baseline-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));

  const packageJsonPath = path.join(root, "org", "bob-code", "package.json");
  const bundlePath = path.join(
    root,
    "org",
    "bob-code",
    "dist",
    "extension.js",
  );
  const projectModesPath = path.join(root, ".bob", "custom_modes.yaml");
  const rulesCodePath = path.join(root, ".bob", "rules-code");

  mkdirSync(path.dirname(packageJsonPath), { recursive: true });
  mkdirSync(path.dirname(bundlePath), { recursive: true });
  mkdirSync(path.dirname(projectModesPath), { recursive: true });

  writeFileSync(
    packageJsonPath,
    JSON.stringify({ version: options.version ?? "3.26.6" }),
  );
  writeFileSync(
    bundlePath,
    bundleForModes([CODE_MODE], {
      optimizedBranch: options.optimizedBranch ?? true,
    }),
  );
  writeFileSync(
    projectModesPath,
    yamlForModes([options.projectMode ?? CODE_MODE]),
  );

  return {
    packageJsonPath,
    bundlePath,
    projectModesPath,
    rulesCodePath,
  };
}

test("extractDefaultModes scans strings, escapes, and template literals", () => {
  const bundle = [
    'const decoy="Mxe=[not an assignment]";',
    "Mxe=[{",
    'slug:"code",',
    'name:"Code \\\"] mode",',
    'roleDefinition:"role",',
    'whenToUse:"when",',
    'description:"description",',
    "customInstructions:`line ] static\ncontent and \\`tick\\``,",
    'groups:["read","edit"]',
    "}];",
    "const after=true;",
  ].join("");

  const modes = extractDefaultModes(bundle);

  assert.equal(modes.length, 1);
  assert.equal(modes[0].name, 'Code "] mode');
  assert.equal(
    modes[0].customInstructions,
    "line ] static\ncontent and `tick`",
  );
  assert.deepEqual(modes[0].groups, ["read", "edit"]);
});

test("extractDefaultModes rejects template interpolation", () => {
  const bundle = [
    "Mxe=[{",
    'slug:"code",',
    'name:"Code",',
    'roleDefinition:"role",',
    'whenToUse:"when",',
    'description:"description",',
    'customInstructions:`line ${"interpolated"}`,',
    'groups:["read"]',
    "}];",
  ].join("");

  assert.throws(
    () => extractDefaultModes(bundle),
    /template interpolation.*not supported/i,
  );
});

test("extractDefaultModes rejects executable expressions without invoking host callbacks", () => {
  let callbackCalls = 0;
  globalThis.__bobCodeBaselineMaliciousCallback = () => {
    callbackCalls += 1;
  };
  const bundle = [
    "Mxe=[(()=>{",
    "globalThis.__bobCodeBaselineMaliciousCallback?.();",
    `return ${JSON.stringify(CODE_MODE)};`,
    "})()];",
  ].join("");
  let rejection;

  try {
    extractDefaultModes(bundle);
  } catch (error) {
    rejection = error;
  } finally {
    delete globalThis.__bobCodeBaselineMaliciousCallback;
  }

  assert.equal(callbackCalls, 0);
  assert.match(
    rejection instanceof Error ? rejection.message : "",
    /literal-only DEFAULT_MODES/i,
  );
});

test("extractDefaultModes ignores assignments outside JavaScript code context", () => {
  const decoy =
    "[{slug:'code',name:'Decoy Code',roleDefinition:'role',whenToUse:'when',description:'description',groups:['read']}]";
  const actual = JSON.stringify([{ ...CODE_MODE, name: "Actual Code" }]);
  const bundles = [
    `const text="Mxe=${decoy}";Mxe=${actual};`,
    `const text=\`Mxe=${decoy}\`;Mxe=${actual};`,
    `// Mxe=${decoy}\nMxe=${actual};`,
    `/* Mxe=${decoy} */Mxe=${actual};`,
  ];

  assert.deepEqual(
    bundles.map((bundle) => extractDefaultModes(bundle)[0].name),
    ["Actual Code", "Actual Code", "Actual Code", "Actual Code"],
  );
});

test("extractDefaultModes ignores a property assignment before the real assignment", () => {
  const propertyDecoy = JSON.stringify([
    { ...CODE_MODE, name: "Property Decoy Code" },
  ]);
  const actual = JSON.stringify([{ ...CODE_MODE, name: "Actual Code" }]);
  const bundle = `const holder={};holder.Mxe=${propertyDecoy};Mxe=${actual};`;

  assert.equal(extractDefaultModes(bundle)[0].name, "Actual Code");
});

test("extractDefaultModes rejects multiple standalone code-mode assignments as ambiguous", () => {
  const functionLocalDecoy = JSON.stringify([
    { ...CODE_MODE, name: "Function-local Decoy Code" },
  ]);
  const actual = JSON.stringify([{ ...CODE_MODE, name: "Actual Code" }]);
  const bundle = [
    `function initializeDecoy(){Mxe=${functionLocalDecoy};}`,
    `Mxe=${actual};`,
  ].join("");

  assert.throws(
    () => extractDefaultModes(bundle),
    /ambiguous DEFAULT_MODES assignment.*2.*standalone Mxe/i,
  );
});

test("extractDefaultModes rejects a valid assignment followed by a non-code assignment", () => {
  const actual = JSON.stringify([{ ...CODE_MODE, name: "Actual Code" }]);
  const bundle = `Mxe=${actual};Mxe=[{slug:"review"}];`;

  assert.throws(
    () => extractDefaultModes(bundle),
    /ambiguous DEFAULT_MODES assignment.*2.*standalone Mxe/i,
  );
});

test("extractDefaultModes rejects a valid assignment followed by a malformed assignment", () => {
  const actual = JSON.stringify([{ ...CODE_MODE, name: "Actual Code" }]);
  const bundle = `Mxe=${actual};Mxe=[{slug:"review"`;

  assert.throws(
    () => extractDefaultModes(bundle),
    /ambiguous DEFAULT_MODES assignment.*2.*standalone Mxe/i,
  );
});

test("parseProjectModesYaml parses the constrained project format", () => {
  const yaml = [
    "customModes:",
    "  - slug: code",
    '    name: "💻 Code"',
    '    roleDefinition: "role\\nline two"',
    '    whenToUse: "when"',
    '    description: "description"',
    "    groups:",
    "      - read",
    "      - edit",
    "      - command",
    "  - slug: review",
    '    name: "Review"',
    '    roleDefinition: "review role"',
    '    whenToUse: "review when"',
    '    description: "review description"',
    '    customInstructions: "be exact"',
    "    groups:",
    '      - "read"',
    "",
  ].join("\n");

  assert.deepEqual(parseProjectModesYaml(yaml), [
    {
      slug: "code",
      name: "💻 Code",
      roleDefinition: "role\nline two",
      whenToUse: "when",
      description: "description",
      groups: ["read", "edit", "command"],
    },
    {
      slug: "review",
      name: "Review",
      roleDefinition: "review role",
      whenToUse: "review when",
      description: "review description",
      customInstructions: "be exact",
      groups: ["read"],
    },
  ]);
});

test("parseProjectModesYaml rejects duplicate mode slugs", () => {
  const yaml = yamlForModes([
    CODE_MODE,
    { ...CODE_MODE, name: "Duplicate Code" },
  ]);

  assert.throws(
    () => parseProjectModesYaml(yaml),
    /Duplicate mode slug "code".*line \d+/,
  );
});

test("compareMode reports no differences for an exact mode copy", () => {
  assert.deepEqual(
    compareMode(CODE_MODE, { ...CODE_MODE, customInstructions: undefined }),
    [],
  );
});

test("compareMode reports readable prompt and ordered-group differences", () => {
  const differences = compareMode(CODE_MODE, {
    ...CODE_MODE,
    roleDefinition: "changed role",
    customInstructions: "",
    groups: ["edit", "read", "command"],
  });

  assert.equal(differences.length, 3);
  assert.match(differences.join("\n"), /roleDefinition/);
  assert.match(differences.join("\n"), /customInstructions/);
  assert.match(differences.join("\n"), /groups/);
  assert.match(differences.join("\n"), /expected/);
  assert.match(differences.join("\n"), /actual/);
});

test("verifyBaseline returns structured success for the approved baseline", (t) => {
  const paths = createFixture(t);

  assert.deepEqual(verifyBaseline(paths), {
    version: "3.26.6",
    modeSlug: "code",
    comparedFields: [
      "slug",
      "name",
      "roleDefinition",
      "whenToUse",
      "description",
      "customInstructions",
      "groups",
    ],
    optimizedCodeBranch: true,
    rulesCodeEmpty: true,
    paths,
  });
});

test("verifyBaseline rejects a missing built-in code mode with an exact count", (t) => {
  const paths = createFixture(t);
  writeFileSync(
    paths.bundlePath,
    bundleForModes([{ ...CODE_MODE, slug: "review", name: "Review" }]),
  );

  assert.throws(
    () => verifyBaseline(paths),
    /exactly one built-in mode with slug "code".*found 0/i,
  );
});

test("verifyBaseline rejects conflicting duplicate built-in code modes", (t) => {
  const paths = createFixture(t);
  writeFileSync(
    paths.bundlePath,
    bundleForModes([
      CODE_MODE,
      { ...CODE_MODE, name: "Conflicting Built-in Code" },
    ]),
  );

  assert.throws(
    () => verifyBaseline(paths),
    /exactly one built-in mode with slug "code".*found 2/i,
  );
});

test("verifyBaseline rejects a Bob Code version mismatch", (t) => {
  const paths = createFixture(t, { version: "3.26.7" });

  assert.throws(
    () => verifyBaseline(paths),
    /Bob Code version mismatch: expected 3\.26\.6, actual 3\.26\.7/,
  );
});

test("verifyBaseline rejects non-empty .bob/rules-code", (t) => {
  const paths = createFixture(t);
  mkdirSync(paths.rulesCodePath, { recursive: true });
  writeFileSync(path.join(paths.rulesCodePath, "extra.md"), "extra prompt");

  assert.throws(
    () => verifyBaseline(paths),
    /\.bob[\\/]rules-code must be absent or empty/,
  );
});

test("verifyBaseline rejects a missing optimized Code prompt branch", (t) => {
  const paths = createFixture(t, { optimizedBranch: false });

  assert.throws(
    () => verifyBaseline(paths),
    /optimized Code prompt branch.*not found/i,
  );
});

test("verifyBaseline accepts the pinned oju signature without a Uoe anchor", (t) => {
  const paths = createFixture(t);

  assert.equal(verifyBaseline(paths).optimizedCodeBranch, true);
});

test("verifyBaseline rejects a wrong oju parameter list despite canonical code and Uoe", (t) => {
  const paths = createFixture(t);
  writeFileSync(
    paths.bundlePath,
    [
      `var Mxe=${JSON.stringify([CODE_MODE])};`,
      "async function oju(t,e,n,r){",
      "let X=await Uoe();",
      `if(r==="code")return\`${CANONICAL_CODE_PROMPT_PREFIX}\`;`,
      "return legacyPrompt();",
      "}",
    ].join(""),
  );

  assert.throws(
    () => verifyBaseline(paths),
    /oju.*parameter list.*3\.26\.6/i,
  );
});

test("verifyBaseline rejects fake and real executable oju candidates as ambiguous", (t) => {
  const paths = createFixture(t);
  const fakePromptBuilder = [
    `async function oju${PINNED_OJU_PARAMETERS}{`,
    "let X=await Uoe();",
    `if(r==="code")return\`${CANONICAL_CODE_PROMPT_PREFIX}\`;`,
    "return legacyPrompt();",
    "}",
  ].join("");
  writeFileSync(
    paths.bundlePath,
    `${fakePromptBuilder}${bundleForModes([CODE_MODE])}`,
  );

  assert.throws(
    () => verifyBaseline(paths),
    /ambiguous.*oju.*2.*candidates/i,
  );
});

test("verifyBaseline rejects altered canonical Por arguments", (t) => {
  const paths = createFixture(t);
  writeFileSync(
    paths.bundlePath,
    [
      `var Mxe=${JSON.stringify([CODE_MODE])};`,
      `async function oju${PINNED_OJU_PARAMETERS}{`,
      "let X=await Uoe();",
      'if(r==="code")return`${Por({cwd:e,supportsComputerUse:false,settings:b,isSubtask:F},H)}\n${X}`;',
      "return legacyPrompt();",
      "}",
    ].join(""),
  );

  assert.throws(
    () => verifyBaseline(paths),
    /optimized Code prompt branch.*not found/i,
  );
});

test("verifyBaseline rejects altered canonical template content", (t) => {
  const paths = createFixture(t);
  writeFileSync(
    paths.bundlePath,
    [
      `var Mxe=${JSON.stringify([CODE_MODE])};`,
      `async function oju${PINNED_OJU_PARAMETERS}{`,
      "let X=await Uoe();",
      'if(r==="code")return`${Por({cwd:e,supportsComputerUse:n,settings:b,isSubtask:F},H)}\n${legacyPrompt()}`;',
      "return legacyPrompt();",
      "}",
    ].join(""),
  );

  assert.throws(
    () => verifyBaseline(paths),
    /optimized Code prompt branch.*not found/i,
  );
});

test("verifyBaseline requires the first direct Code return to be canonical", (t) => {
  const paths = createFixture(t);
  writeFileSync(
    paths.bundlePath,
    [
      `var Mxe=${JSON.stringify([CODE_MODE])};`,
      `async function oju${PINNED_OJU_PARAMETERS}{`,
      "let X=await Uoe();",
      'if(r==="code")return`${legacyPrompt()}\\n${X}`;',
      `if(r==="code")return\`${CANONICAL_CODE_PROMPT_PREFIX}\`;`,
      "return legacyPrompt();",
      "}",
    ].join(""),
  );

  assert.throws(
    () => verifyBaseline(paths),
    /optimized Code prompt branch.*not found/i,
  );
});

test("verifyBaseline rejects extra template content after canonical X", (t) => {
  const paths = createFixture(t);
  writeFileSync(
    paths.bundlePath,
    [
      `var Mxe=${JSON.stringify([CODE_MODE])};`,
      `async function oju${PINNED_OJU_PARAMETERS}{`,
      "let X=await Uoe();",
      `if(r==="code")return\`${CANONICAL_CODE_PROMPT_PREFIX}extra\`;`,
      "return legacyPrompt();",
      "}",
    ].join(""),
  );

  assert.throws(
    () => verifyBaseline(paths),
    /optimized Code prompt branch.*not found/i,
  );
});

test("verifyBaseline rejects deferred canonical template content", (t) => {
  const paths = createFixture(t);
  writeFileSync(
    paths.bundlePath,
    [
      `var Mxe=${JSON.stringify([CODE_MODE])};`,
      `async function oju${PINNED_OJU_PARAMETERS}{`,
      "let X=await Uoe();",
      'if(r==="code")return`${Por({cwd:e,supportsComputerUse:n,settings:b,isSubtask:F},H)}\n${()=>X}`;',
      "return legacyPrompt();",
      "}",
    ].join(""),
  );

  assert.throws(
    () => verifyBaseline(paths),
    /optimized Code prompt branch.*not found/i,
  );
});

test("verifyBaseline rejects an unrelated Por call after a legacy code return", (t) => {
  const paths = createFixture(t);
  writeFileSync(
    paths.bundlePath,
    [
      bundleForModes([CODE_MODE], { optimizedBranch: false }),
      'function prompt(){if(r==="code")return legacyPrompt();Por({cwd:e});}',
    ].join(""),
  );

  assert.throws(
    () => verifyBaseline(paths),
    /optimized Code prompt branch.*not found/i,
  );
});

test("verifyBaseline ignores valid optimized branches outside the prompt builder", (t) => {
  const paths = createFixture(t, { optimizedBranch: false });
  writeFileSync(
    paths.bundlePath,
    [
      bundleForModes([CODE_MODE], { optimizedBranch: false }),
      'function decoy(){if(r==="code")return Por({cwd:e});}',
    ].join(""),
  );

  assert.throws(
    () => verifyBaseline(paths),
    /optimized Code prompt branch.*not found/i,
  );
});

test("verifyBaseline ignores optimized Code branches inside comments", (t) => {
  const paths = createFixture(t);
  const defaultModes = `var Mxe=${JSON.stringify([CODE_MODE])};`;
  const fakeBranch = 'if(r==="code")return Por({cwd:e});';

  for (const comment of [`// ${fakeBranch}`, `/* ${fakeBranch} */`]) {
    writeFileSync(paths.bundlePath, `${defaultModes}${comment}`);

    assert.throws(
      () => verifyBaseline(paths),
      /optimized Code prompt branch.*not found/i,
    );
  }
});

test("verifyBaseline rejects a conditional Por return in the Code branch", (t) => {
  const paths = createFixture(t);
  writeFileSync(
    paths.bundlePath,
    [
      `var Mxe=${JSON.stringify([CODE_MODE])};`,
      `async function oju${PINNED_OJU_PARAMETERS}{`,
      "let X=await Uoe();",
      'if(r==="code")return false?Por({cwd:e}):legacyPrompt();',
      "return legacyPrompt();",
      "}",
    ].join(""),
  );

  assert.throws(
    () => verifyBaseline(paths),
    /optimized Code prompt branch.*not found/i,
  );
});

test("verifyBaseline rejects a deferred Por return in the Code branch", (t) => {
  const paths = createFixture(t);
  writeFileSync(
    paths.bundlePath,
    [
      `var Mxe=${JSON.stringify([CODE_MODE])};`,
      `async function oju${PINNED_OJU_PARAMETERS}{`,
      "let X=await Uoe();",
      'if(r==="code")return()=>Por({cwd:e});',
      "return legacyPrompt();",
      "}",
    ].join(""),
  );

  assert.throws(
    () => verifyBaseline(paths),
    /optimized Code prompt branch.*not found/i,
  );
});

test("verifyBaseline rejects an optimized Code branch after a top-level throw", (t) => {
  const paths = createFixture(t);
  writeFileSync(
    paths.bundlePath,
    [
      `var Mxe=${JSON.stringify([CODE_MODE])};`,
      `async function oju${PINNED_OJU_PARAMETERS}{`,
      "let X=await Uoe();",
      'throw new Error("stop");',
      'if(r==="code")return`${Por({cwd:e})}\\n${X}`;',
      "}",
    ].join(""),
  );

  assert.throws(
    () => verifyBaseline(paths),
    /optimized Code prompt branch.*not found/i,
  );
});

test("verifyBaseline rejects a nested optimized Code branch in oju", (t) => {
  const paths = createFixture(t);
  writeFileSync(
    paths.bundlePath,
    [
      `var Mxe=${JSON.stringify([CODE_MODE])};`,
      `async function oju${PINNED_OJU_PARAMETERS}{`,
      "let X=await Uoe();",
      'if(true){if(r==="code")return Por({cwd:e});}',
      "return legacyPrompt();",
      "}",
    ].join(""),
  );

  assert.throws(
    () => verifyBaseline(paths),
    /optimized Code prompt branch.*not found/i,
  );
});

test("verifyBaseline rejects an optimized Code branch after an unconditional return", (t) => {
  const paths = createFixture(t);
  writeFileSync(
    paths.bundlePath,
    [
      `var Mxe=${JSON.stringify([CODE_MODE])};`,
      `async function oju${PINNED_OJU_PARAMETERS}{`,
      "let X=await Uoe();",
      "return legacyPrompt();",
      'if(r==="code")return Por({cwd:e});',
      "}",
    ].join(""),
  );

  assert.throws(
    () => verifyBaseline(paths),
    /optimized Code prompt branch.*not found/i,
  );
});

test("CLI prints every PASS line and exits 0 for an isolated matching baseline", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "bob-code-baseline-cli-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const fixtureScriptPath = path.join(
    root,
    "scripts",
    "bob-code-baseline.mjs",
  );
  const fixturePackageJsonPath = path.join(
    root,
    "org",
    "bob-code",
    "package.json",
  );
  const fixtureBundlePath = path.join(
    root,
    "org",
    "bob-code",
    "dist",
    "extension.js",
  );
  const fixtureProjectModesPath = path.join(
    root,
    ".bob",
    "custom_modes.yaml",
  );
  mkdirSync(path.dirname(fixtureScriptPath), { recursive: true });
  mkdirSync(path.dirname(fixturePackageJsonPath), { recursive: true });
  mkdirSync(path.dirname(fixtureBundlePath), { recursive: true });
  mkdirSync(path.dirname(fixtureProjectModesPath), { recursive: true });
  copyFileSync(SCRIPT_PATH, fixtureScriptPath);
  writeFileSync(
    fixturePackageJsonPath,
    JSON.stringify({ version: "3.26.6" }),
  );
  writeFileSync(fixtureBundlePath, bundleForModes([CODE_MODE]));
  writeFileSync(fixtureProjectModesPath, yamlForModes([CODE_MODE]));

  const result = spawnSync(process.execPath, [fixtureScriptPath], {
    cwd: root,
    encoding: "utf8",
  });
  const output = `${result.stdout}${result.stderr}`;

  assert.equal(result.status, 0, output);
  assert.match(output, /PASS: Bob Code version 3\.26\.6/);
  assert.match(
    output,
    /PASS: project code mode matches the built-in baseline/,
  );
  assert.match(output, /PASS: \.bob\/rules-code is absent or empty/);
  assert.match(output, /PASS: optimized Code prompt branch is present/);
});

test("CLI prints FAIL and exits 1 when isolated project YAML is missing", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "bob-code-baseline-cli-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const fixtureScriptPath = path.join(
    root,
    "scripts",
    "bob-code-baseline.mjs",
  );
  mkdirSync(path.dirname(fixtureScriptPath), { recursive: true });
  copyFileSync(SCRIPT_PATH, fixtureScriptPath);
  const fixturePackageJsonPath = path.join(
    root,
    "org",
    "bob-code",
    "package.json",
  );
  const fixtureBundlePath = path.join(
    root,
    "org",
    "bob-code",
    "dist",
    "extension.js",
  );
  mkdirSync(path.dirname(fixturePackageJsonPath), { recursive: true });
  mkdirSync(path.dirname(fixtureBundlePath), { recursive: true });
  writeFileSync(
    fixturePackageJsonPath,
    JSON.stringify({ version: "3.26.6" }),
  );
  writeFileSync(fixtureBundlePath, bundleForModes([CODE_MODE]));

  const result = spawnSync(process.execPath, [fixtureScriptPath], {
    cwd: root,
    encoding: "utf8",
  });

  assert.equal(result.status, 1);
  assert.match(`${result.stdout}${result.stderr}`, /FAIL: .*custom_modes\.yaml/);
});

test("actual Bob distribution passes with only temporary project YAML", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "bob-code-actual-baseline-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const projectModesPath = path.join(root, "custom_modes.yaml");
  const rulesCodePath = path.join(root, "rules-code");
  writeFileSync(projectModesPath, yamlForModes([CODE_MODE]));
  const paths = {
    packageJsonPath: ACTUAL_PACKAGE_JSON_PATH,
    bundlePath: ACTUAL_BUNDLE_PATH,
    projectModesPath,
    rulesCodePath,
  };

  const result = verifyBaseline(paths);

  assert.equal(result.version, "3.26.6");
  assert.equal(result.modeSlug, "code");
  assert.equal(result.optimizedCodeBranch, true);
  assert.equal(result.rulesCodeEmpty, true);
  assert.deepEqual(result.paths, paths);
});

test("actual repository matches the approved Bob Code baseline", () => {
  const result = verifyBaseline();

  assert.equal(result.version, "3.26.6");
  assert.equal(result.modeSlug, "code");
  assert.equal(result.optimizedCodeBranch, true);
  assert.equal(result.rulesCodeEmpty, true);
});
