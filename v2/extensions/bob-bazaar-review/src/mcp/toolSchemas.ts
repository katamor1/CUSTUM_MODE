import { objectSchema, optionalStringProp, stringProp } from "./toolCommon"

export const BAZAAR_ROOT_INPUT_SCHEMA = objectSchema({
  cwd: stringProp("Working directory inside the Bazaar repository")
}, ["cwd"])

export const BAZAAR_REVNO_INPUT_SCHEMA = objectSchema({
  cwd: stringProp("Bazaar repository root or child directory")
}, ["cwd"])

export const BAZAAR_LOG_INPUT_SCHEMA = objectSchema({
  cwd: stringProp("Bazaar repository root"),
  revision: optionalStringProp("Optional Bazaar revision")
}, ["cwd"])

export const BAZAAR_DIFF_REVISION_INPUT_SCHEMA = objectSchema({
  cwd: stringProp("Bazaar repository root"),
  revision: stringProp("Bazaar revision to review")
}, ["cwd", "revision"])

export const BAZAAR_DIFF_RANGE_INPUT_SCHEMA = objectSchema({
  cwd: stringProp("Bazaar repository root"),
  baseRevision: stringProp("Base Bazaar revision"),
  targetRevision: stringProp("Target Bazaar revision")
}, ["cwd", "baseRevision", "targetRevision"])

export const BAZAAR_DIFF_WORKING_TREE_INPUT_SCHEMA = objectSchema({
  cwd: stringProp("Bazaar repository root"),
  baseRevision: optionalStringProp("Optional base Bazaar revision")
}, ["cwd"])

export const BAZAAR_CAT_REVISION_INPUT_SCHEMA = objectSchema({
  cwd: stringProp("Bazaar repository root"),
  revision: stringProp("Bazaar revision"),
  path: stringProp("Repository-relative file path")
}, ["cwd", "revision", "path"])

export const BAZAAR_STATUS_INPUT_SCHEMA = objectSchema({
  cwd: stringProp("Bazaar repository root")
}, ["cwd"])

export const PROJECT_RULES_INIT_INPUT_SCHEMA = objectSchema({
  cwd: stringProp("Workspace root")
}, ["cwd"])

export const PROJECT_RULES_OPTIONAL_PATH_INPUT_SCHEMA = objectSchema({
  cwd: stringProp("Workspace root"),
  path: optionalStringProp("Optional checklist path, workspace-relative or absolute")
}, ["cwd"])

export const PROJECT_RULES_SCHEMA_PATH_INPUT_SCHEMA = objectSchema({
  cwd: stringProp("Workspace root"),
  path: optionalStringProp("Optional schema path, workspace-relative or absolute")
}, ["cwd"])

export const PROJECT_RULES_REVIEW_JSON_INPUT_SCHEMA = objectSchema({
  json: stringProp("Review result JSON text")
}, ["json"])

export const PROJECT_RULES_LATEST_RESULT_INPUT_SCHEMA = objectSchema({
  cwd: stringProp("Workspace root")
}, ["cwd"])

export const PROJECT_RULES_STORED_RESULT_INPUT_SCHEMA = objectSchema({
  cwd: stringProp("Workspace root"),
  reviewId: stringProp("Review id or result file basename")
}, ["cwd", "reviewId"])
