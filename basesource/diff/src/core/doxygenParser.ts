import type { CComment, CSourceRange } from "./cProjectModels";

export type DoxygenParameterDirection = "in" | "out" | "in,out";

export interface DoxygenParameter {
  name: string;
  direction?: DoxygenParameterDirection;
  description: string;
}

export interface DoxygenReturnValue {
  value: string;
  description: string;
}

export interface DoxygenDocumentation {
  brief?: string;
  details?: string;
  parameters: DoxygenParameter[];
  unmatchedParameters: DoxygenParameter[];
  returnDescription?: string;
  returnValues: DoxygenReturnValue[];
  notes: string[];
  warnings: string[];
  unparsedTags: string[];
}

export interface DoxygenParseOptions {
  parameterNames?: string[];
}

export interface DoxygenAssociation {
  leadingComments: CComment[];
  documentation?: DoxygenDocumentation;
  trailingComment?: CComment;
  trailingDescription?: string;
}

interface ParsedBlock {
  tag?: string;
  direction?: string;
  lines: string[];
}

export function associateDoxygenComments(
  source: string,
  comments: CComment[],
  targetRange: CSourceRange,
  options: DoxygenParseOptions = {}
): DoxygenAssociation {
  const ordered = [...comments].sort((left, right) => left.range.startIndex - right.range.startIndex);
  const leadingComments = findLeadingComments(source, ordered, targetRange.startIndex);
  const trailingComment = ordered.find((comment) => (
    comment.range.startIndex >= targetRange.endIndex
    && comment.range.startPosition.row === targetRange.endPosition.row
    && isTrailingMarker(comment.text)
    && source.slice(targetRange.endIndex, comment.range.startIndex).trim().length === 0
  ));
  const trailingDescription = trailingComment
    ? normalizeFreeText(cleanCommentText(trailingComment.text))
    : undefined;

  return {
    leadingComments,
    ...(leadingComments.length > 0
      ? { documentation: parseDoxygenCommentGroup(leadingComments, options) }
      : {}),
    ...(trailingComment ? { trailingComment } : {}),
    ...(trailingDescription ? { trailingDescription } : {})
  };
}

export function parseDoxygenCommentGroup(
  comments: CComment[],
  options: DoxygenParseOptions = {}
): DoxygenDocumentation {
  const cleanedComments = comments
    .map((comment) => cleanCommentText(comment.text))
    .filter((text) => !isSeparatorOnly(text));
  const blocks = parseBlocks(cleanedComments.join("\n\n"));
  const brief: string[] = [];
  const freeDetails: string[] = [];
  const taggedDetails: string[] = [];
  const parameters: DoxygenParameter[] = [];
  const returnValues: DoxygenReturnValue[] = [];
  const returnDescriptions: string[] = [];
  const notes: string[] = [];
  const warnings: string[] = [];
  const unparsedTags: string[] = [];

  for (const block of blocks) {
    const text = normalizeTagText(block.lines);
    if (!block.tag) {
      const freeText = normalizeFreeText(block.lines.join("\n"));
      if (freeText) {
        freeDetails.push(freeText);
      }
      continue;
    }

    switch (block.tag) {
      case "brief":
        if (text) brief.push(text);
        break;
      case "details":
        if (text) taggedDetails.push(text);
        break;
      case "param": {
        const [name = "", ...descriptionParts] = text.split(/\s+/);
        if (!name) {
          unparsedTags.push("@param");
          break;
        }
        const direction = normalizeDirection(block.direction);
        parameters.push({
          name,
          ...(direction ? { direction } : {}),
          description: descriptionParts.join(" ")
        });
        break;
      }
      case "return":
        if (text) returnDescriptions.push(text);
        break;
      case "retval": {
        const [value = "", ...descriptionParts] = text.split(/\s+/);
        if (!value) {
          unparsedTags.push("@retval");
          break;
        }
        returnValues.push({ value, description: descriptionParts.join(" ") });
        break;
      }
      case "note":
        if (text) notes.push(text);
        break;
      case "warning":
        if (text) warnings.push(text);
        break;
      default:
        unparsedTags.push(`@${block.tag}${text ? ` ${text}` : ""}`);
        break;
    }
  }

  const expectedParameters = options.parameterNames
    ? new Set(options.parameterNames)
    : undefined;
  const unmatchedParameters = expectedParameters
    ? parameters.filter((parameter) => !expectedParameters.has(parameter.name))
    : [];
  const details = [...freeDetails, ...taggedDetails].filter(Boolean).join("\n");

  return {
    ...(brief.length > 0 ? { brief: brief.join("\n") } : {}),
    ...(details ? { details } : {}),
    parameters,
    unmatchedParameters,
    ...(returnDescriptions.length > 0
      ? { returnDescription: returnDescriptions.join("\n") }
      : {}),
    returnValues,
    notes,
    warnings,
    unparsedTags
  };
}

export function cleanCommentText(commentText: string): string {
  let text = commentText.trim();
  if (text.startsWith("//")) {
    return text
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*\/\/(?:\/|!)(?:<)?\s?/, "").replace(/^\s*\/\/\s?/, ""))
      .join("\n")
      .trim();
  }

  text = text
    .replace(/^\/\*(?:\*|!)(?:<)?/, "")
    .replace(/^\/\*/, "")
    .replace(/\*\/$/, "");
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\*\s?/, ""))
    .join("\n")
    .trim();
}

function findLeadingComments(source: string, comments: CComment[], targetStartIndex: number): CComment[] {
  const leading: CComment[] = [];
  let cursor = targetStartIndex;
  for (let index = comments.length - 1; index >= 0; index -= 1) {
    const comment = comments[index];
    if (comment.range.endIndex > cursor) {
      continue;
    }
    if (isTrailingMarker(comment.text) || hasCodeBeforeCommentOnLine(source, comment)) {
      break;
    }
    if (source.slice(comment.range.endIndex, cursor).trim().length > 0) {
      break;
    }
    leading.unshift(comment);
    cursor = comment.range.startIndex;
  }
  return leading;
}

function hasCodeBeforeCommentOnLine(source: string, comment: CComment): boolean {
  const lineStart = source.lastIndexOf("\n", Math.max(0, comment.range.startIndex - 1)) + 1;
  const prefix = source.slice(lineStart, comment.range.startIndex);
  const withoutBlockComments = prefix.replace(/\/\*[\s\S]*?\*\//g, "");
  return withoutBlockComments.trim().length > 0;
}

function isTrailingMarker(text: string): boolean {
  return /^\s*(?:\/\/\/<|\/\/!<|\/\*\*<)/.test(text);
}

function isSeparatorOnly(text: string): boolean {
  return text.trim().length === 0 || !/[\p{L}\p{N}_]/u.test(text);
}

function parseBlocks(text: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  let current: ParsedBlock | undefined;
  for (const line of text.split(/\r?\n/)) {
    const tagMatch = line.trim().match(/^@([A-Za-z_]\w*)(?:\s*\[([^\]]+)\])?\s*(.*)$/);
    if (tagMatch) {
      current = {
        tag: tagMatch[1].toLowerCase(),
        direction: tagMatch[2],
        lines: tagMatch[3] ? [tagMatch[3]] : []
      };
      blocks.push(current);
      continue;
    }
    if (!current) {
      current = { lines: [] };
      blocks.push(current);
    }
    current.lines.push(line);
  }
  return blocks;
}

function normalizeTagText(lines: string[]): string {
  return lines.map((line) => line.trim()).filter(Boolean).join(" ");
}

function normalizeFreeText(text: string): string {
  return text
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join(" "))
    .filter(Boolean)
    .join("\n");
}

function normalizeDirection(direction?: string): DoxygenParameterDirection | undefined {
  if (!direction) {
    return undefined;
  }
  const normalized = direction.replace(/\s+/g, "").toLowerCase();
  if (normalized === "in" || normalized === "out" || normalized === "in,out") {
    return normalized;
  }
  return undefined;
}
