import * as cheerio from "cheerio";
import { isTag, isText, type ChildNode, type Element } from "domhandler";

export type HtmlReportRows = string[][];

export interface HtmlReportCell {
  text: string;
  colspan?: number;
  richText?: HtmlReportTextRun[];
  backgroundColor?: string;
  fontColor?: string;
  bold?: boolean;
  italic?: boolean;
  horizontalAlignment?: "left" | "center" | "right";
}

export interface HtmlReportTextRun {
  text: string;
  backgroundColor?: string;
  fontColor?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export interface HtmlReportRow {
  cells: HtmlReportCell[];
}

export interface HtmlReport {
  rows: HtmlReportRow[];
}

type CssDeclarations = Record<string, string>;
type HtmlAttributes = Record<string, string>;

interface CssRule {
  selector: string;
  declarations: CssDeclarations;
}

export function parseHtmlReport(html: string, signal?: AbortSignal): HtmlReport {
  signal?.throwIfAborted();
  const winMergeReport = parseWinMergeHtmlReport(html, signal);
  if (winMergeReport) {
    return winMergeReport;
  }

  const $ = cheerio.load(html);
  const rules = parseCssRules($("style").map((_, style) => $(style).text()).get().join("\n"));
  const rows: HtmlReportRow[] = [];

  $("tr").each((_, row) => {
    signal?.throwIfAborted();
    const rowStyle = resolveElementStyle($, row, rules);
    const cells = $(row)
      .find("th,td")
      .map((__, cell) => {
        const isHeader = cell.tagName.toLowerCase() === "th";
        const cellStyle = { ...rowStyle, ...resolveElementStyle($, cell, rules) };
        const inheritedCellStyle = isHeader ? { ...cellStyle, "font-weight": "bold" } : cellStyle;
        const colspan = parseSpan($(cell).attr("colspan"));
        const textRuns = normalizeTextRuns(extractTextRuns($, Array.from(cell.children), rules, inheritedCellStyle));
        const text = textRuns.map((run) => run.text).join("");
        return makeCell(text, inheritedCellStyle, isHeader, colspan, textRuns);
      })
      .get();

    if (cells.some((cell) => cell.text.length > 0)) {
      rows.push({ cells });
    }
  });

  if (rows.length > 0) {
    return { rows };
  }

  const preText = $("pre").text();
  if (preText.trim().length > 0) {
    return {
      rows: preText.split(/\r?\n/).filter((line) => line.length > 0).map((line) => ({ cells: [{ text: line }] }))
    };
  }

  const bodyText = normalizeCellText($("body").text() || $.root().text());
  return { rows: bodyText.length > 0 ? [{ cells: [{ text: bodyText }] }] : [] };
}

export function parseHtmlReportToRows(html: string, signal?: AbortSignal): HtmlReportRows {
  return parseHtmlReport(html, signal).rows.map((row) => {
    signal?.throwIfAborted();
    const cells: string[] = [];
    for (const cell of row.cells) {
      const colspan = cell.colspan ?? 1;
      cells.push(cell.text);
      for (let offset = 1; offset < colspan; offset += 1) {
        cells.push("");
      }
    }
    return cells;
  });
}

function normalizeCellText(value: string): string {
  return trimAsciiWhitespace(value.replace(/\r?\n/g, "\n")).replace(/\u00a0/g, " ");
}

function parseCssRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]+)\}/g)) {
    const declarations = parseDeclarations(match[2]);
    for (const selector of match[1].split(",")) {
      const trimmedSelector = selector.trim();
      if (trimmedSelector.length > 0) {
        rules.push({ selector: trimmedSelector, declarations });
      }
    }
  }

  return rules;
}

function parseWinMergeHtmlReport(html: string, signal?: AbortSignal): HtmlReport | undefined {
  if (!/<title>\s*WinMerge File Compare Report\s*<\/title>/i.test(html)) {
    return undefined;
  }

  const rules = parseCssRules(extractStyleText(html));
  const rows: HtmlReportRow[] = [];
  const styleCache = new Map<string, CssDeclarations>();
  const rowCellCache = new Map<string, HtmlReportCell[]>();
  const rowPattern = /<tr\b([^>]*)>/gi;

  let index = 0;
  let rowMatch = rowPattern.exec(html);
  while (rowMatch) {
    if (index % 100 === 0) {
      signal?.throwIfAborted();
    }
    const nextRowMatch = rowPattern.exec(html);
    const rowHtml = html.slice(rowMatch.index + rowMatch[0].length, nextRowMatch?.index ?? html.length);
    const rowAttributes = parseAttributes(rowMatch[1]);
    const rowStyle = resolveFastElementStyle("tr", rowAttributes, rules, styleCache);
    const cacheKey = `${rowMatch[1]}\0${rowHtml}`;
    const cachedCells = rowCellCache.get(cacheKey);
    const cells = cachedCells
      ? cloneCells(cachedCells)
      : parseWinMergeRowCells(rowHtml, rowStyle, rules, styleCache);
    if (!cachedCells) {
      rowCellCache.set(cacheKey, cells);
    }

    if (cells.some((cell) => cell.text.length > 0)) {
      rows.push({ cells });
    }
    rowMatch = nextRowMatch;
    index += 1;
  }

  return rows.length > 0 ? { rows } : undefined;
}

function cloneCells(cells: HtmlReportCell[]): HtmlReportCell[] {
  return cells.map((cell) => ({
    ...cell,
    richText: cell.richText?.map((run) => ({ ...run }))
  }));
}

function extractStyleText(html: string): string {
  return Array.from(html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi), (match) => match[1]).join("\n");
}

function parseWinMergeRowCells(
  rowHtml: string,
  rowStyle: CssDeclarations,
  rules: CssRule[],
  styleCache: Map<string, CssDeclarations>
): HtmlReportCell[] {
  const cells: HtmlReportCell[] = [];
  const cellPattern = /<(td|th)\b([^>]*)>/gi;

  let cellMatch = cellPattern.exec(rowHtml);
  while (cellMatch) {
    const tagName = cellMatch[1].toLowerCase();
    const isHeader = tagName === "th";
    const attributes = parseAttributes(cellMatch[2]);
    const cellStyle = {
      ...rowStyle,
      ...resolveFastElementStyle(tagName, attributes, rules, styleCache)
    };
    const inheritedCellStyle = isHeader ? { ...cellStyle, "font-weight": "bold" } : cellStyle;
    const bodyStart = cellMatch.index + cellMatch[0].length;
    const nextCellMatch = cellPattern.exec(rowHtml);
    const bodyEnd = nextCellMatch?.index ?? rowHtml.length;
    const body = stripTrailingCellHtml(rowHtml.slice(bodyStart, bodyEnd), tagName);
    const colspan = parseSpan(attributes.colspan);
    const textRuns = normalizeTextRuns(extractFastTextRuns(body, rules, inheritedCellStyle, styleCache));
    const text = textRuns.map((run) => run.text).join("");

    cells.push(makeCell(text, inheritedCellStyle, isHeader, colspan, textRuns));
    cellMatch = nextCellMatch;
  }

  return cells;
}

function stripTrailingCellHtml(value: string, tagName: string): string {
  const closingTag = new RegExp(`</${tagName}\\s*>`, "i").exec(value);
  return closingTag ? value.slice(0, closingTag.index) : value;
}

function extractFastTextRuns(
  html: string,
  rules: CssRule[],
  inheritedStyle: CssDeclarations,
  styleCache: Map<string, CssDeclarations>
): HtmlReportTextRun[] {
  const runs: HtmlReportTextRun[] = [];
  const styleStack: CssDeclarations[] = [inheritedStyle];

  for (const tokenMatch of html.matchAll(/<[^>]+>|[^<]+/g)) {
    const token = tokenMatch[0];
    const currentStyle = styleStack[styleStack.length - 1];
    if (!token.startsWith("<")) {
      appendTextRun(runs, decodeHtmlEntities(token).replace(/\r?\n/g, "\n"), currentStyle);
      continue;
    }

    const tag = parseTagToken(token);
    if (!tag) {
      continue;
    }

    if (tag.closing) {
      if (styleStack.length > 1) {
        styleStack.pop();
      }
      continue;
    }

    if (tag.name === "br") {
      appendRun(runs, { ...styleToTextRun(currentStyle), text: "\n" });
      continue;
    }

    const elementStyle = applyTagStyle(tag.name, {
      ...currentStyle,
      ...resolveFastElementStyle(tag.name, tag.attributes, rules, styleCache)
    });

    if (!tag.selfClosing && !isVoidElement(tag.name)) {
      styleStack.push(elementStyle);
    }
  }

  return runs;
}

function parseTagToken(token: string): { name: string; attributes: HtmlAttributes; closing: boolean; selfClosing: boolean } | undefined {
  const match = token.match(/^<\s*(\/)?\s*([A-Za-z][\w:-]*)([\s\S]*?)>$/);
  if (!match) {
    return undefined;
  }

  const rawAttributes = match[3] ?? "";
  return {
    name: match[2].toLowerCase(),
    attributes: parseAttributes(rawAttributes.replace(/\/\s*$/, "")),
    closing: Boolean(match[1]),
    selfClosing: /\/\s*>$/.test(token)
  };
}

function isVoidElement(tagName: string): boolean {
  return tagName === "br" || tagName === "img" || tagName === "hr" || tagName === "input" || tagName === "meta" || tagName === "link";
}

function parseAttributes(source: string): HtmlAttributes {
  const attributes: HtmlAttributes = {};
  for (const match of source.matchAll(/([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    attributes[match[1].toLowerCase()] = decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }

  return attributes;
}

function resolveFastElementStyle(
  tagName: string,
  attributes: HtmlAttributes,
  rules: CssRule[],
  styleCache: Map<string, CssDeclarations>
): CssDeclarations {
  const cacheKey = `${tagName}|${attributes.id ?? ""}|${attributes.class ?? ""}|${attributes.style ?? ""}`;
  const cached = styleCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const declarations: CssDeclarations = {};
  const classNames = new Set((attributes.class ?? "").split(/\s+/).filter(Boolean));
  for (const rule of rules) {
    if (matchesFastSimpleSelector(tagName, attributes.id, classNames, rule.selector)) {
      Object.assign(declarations, rule.declarations);
    }
  }

  Object.assign(declarations, parseDeclarations(attributes.style ?? ""));
  styleCache.set(cacheKey, declarations);
  return declarations;
}

function matchesFastSimpleSelector(
  tagName: string,
  id: string | undefined,
  classNames: Set<string>,
  selector: string
): boolean {
  if (selector.includes(" ") || selector.includes(">")) {
    return false;
  }

  if (selector.startsWith(".")) {
    return classNames.has(selector.slice(1));
  }

  if (selector.startsWith("#")) {
    return id === selector.slice(1);
  }

  if (selector.includes(".")) {
    const [tag, className] = selector.split(".", 2);
    return tagName === tag.toLowerCase() && classNames.has(className);
  }

  return tagName === selector.toLowerCase();
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[A-Za-z][\w]+);/g, (entity, name: string) => {
    const normalizedName = name.toLowerCase();
    if (normalizedName.startsWith("#x")) {
      return decodeCodePoint(Number.parseInt(normalizedName.slice(2), 16), entity);
    }

    if (normalizedName.startsWith("#")) {
      return decodeCodePoint(Number.parseInt(normalizedName.slice(1), 10), entity);
    }

    return HTML_ENTITIES[normalizedName] ?? entity;
  });
}

function decodeCodePoint(codePoint: number, fallback: string): string {
  if (!Number.isFinite(codePoint)) {
    return fallback;
  }

  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return fallback;
  }
}

function resolveElementStyle($: cheerio.CheerioAPI, element: Element, rules: CssRule[]): CssDeclarations {
  const declarations: CssDeclarations = {};
  for (const rule of rules) {
    if (matchesSimpleSelector($, element, rule.selector)) {
      Object.assign(declarations, rule.declarations);
    }
  }

  Object.assign(declarations, parseDeclarations($(element).attr("style") ?? ""));
  return declarations;
}

function matchesSimpleSelector($: cheerio.CheerioAPI, element: Element, selector: string): boolean {
  if (selector.includes(" ") || selector.includes(">")) {
    return false;
  }

  const tagName = element.tagName.toLowerCase();
  const id = $(element).attr("id");
  const classNames = new Set(($(element).attr("class") ?? "").split(/\s+/).filter(Boolean));

  if (selector.startsWith(".")) {
    return classNames.has(selector.slice(1));
  }

  if (selector.startsWith("#")) {
    return id === selector.slice(1);
  }

  if (selector.includes(".")) {
    const [tag, className] = selector.split(".", 2);
    return tagName === tag.toLowerCase() && classNames.has(className);
  }

  return tagName === selector.toLowerCase();
}

function parseDeclarations(style: string): CssDeclarations {
  const declarations: CssDeclarations = {};
  for (const declaration of style.split(";")) {
    const separator = declaration.indexOf(":");
    if (separator === -1) {
      continue;
    }

    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).trim();
    if (property.length > 0 && value.length > 0) {
      declarations[property] = value;
    }
  }

  return declarations;
}

function makeCell(
  text: string,
  style: CssDeclarations,
  isHeader: boolean,
  colspan?: number,
  richText?: HtmlReportTextRun[]
): HtmlReportCell {
  const cell: HtmlReportCell = {
    text,
    colspan,
    backgroundColor: normalizeColor(style["background-color"] ?? style.background),
    fontColor: normalizeColor(style.color),
    bold: isHeader || isBold(style["font-weight"]),
    italic: style["font-style"]?.toLowerCase() === "italic",
    horizontalAlignment: normalizeHorizontalAlignment(style["text-align"])
  };

  if (richText && shouldKeepRichText(richText, cell)) {
    cell.richText = richText;
  }

  return cell;
}

function extractTextRuns(
  $: cheerio.CheerioAPI,
  nodes: ChildNode[],
  rules: CssRule[],
  inheritedStyle: CssDeclarations
): HtmlReportTextRun[] {
  const runs: HtmlReportTextRun[] = [];

  for (const node of nodes) {
    if (isText(node)) {
      appendTextRun(runs, node.data.replace(/\r?\n/g, "\n"), inheritedStyle);
      continue;
    }

    if (!isTag(node)) {
      continue;
    }

    const tagName = node.tagName.toLowerCase();
    if (tagName === "br") {
      appendRun(runs, { ...styleToTextRun(inheritedStyle), text: "\n" });
      continue;
    }

    const elementStyle = applyTagStyle(tagName, { ...inheritedStyle, ...resolveElementStyle($, node, rules) });
    for (const childRun of extractTextRuns($, Array.from(node.children), rules, elementStyle)) {
      appendRun(runs, childRun);
    }
  }

  return runs;
}

function applyTagStyle(tagName: string, style: CssDeclarations): CssDeclarations {
  if (tagName === "b" || tagName === "strong") {
    style["font-weight"] = "bold";
  }

  if (tagName === "i" || tagName === "em") {
    style["font-style"] = "italic";
  }

  if (tagName === "u") {
    style["text-decoration"] = "underline";
  }

  return style;
}

function appendTextRun(runs: HtmlReportTextRun[], text: string, style: CssDeclarations): void {
  if (text.length === 0) {
    return;
  }

  appendRun(runs, { ...styleToTextRun(style), text });
}

function appendRun(runs: HtmlReportTextRun[], run: HtmlReportTextRun): void {
  if (run.text.length === 0) {
    return;
  }

  const previous = runs.at(-1);
  if (previous && sameRunStyle(previous, run)) {
    previous.text += run.text;
    return;
  }

  runs.push(run);
}

function styleToTextRun(style: CssDeclarations): Omit<HtmlReportTextRun, "text"> {
  const run: Omit<HtmlReportTextRun, "text"> = {};
  const backgroundColor = normalizeColor(style["background-color"] ?? style.background);
  const fontColor = normalizeColor(style.color);
  const bold = isBold(style["font-weight"]);
  const italic = style["font-style"]?.toLowerCase() === "italic";
  const underline = isUnderline(style["text-decoration"] ?? style["text-decoration-line"]);

  if (backgroundColor) {
    run.backgroundColor = backgroundColor;
  }

  if (fontColor) {
    run.fontColor = fontColor;
  }

  if (bold) {
    run.bold = true;
  }

  if (italic) {
    run.italic = true;
  }

  if (underline) {
    run.underline = true;
  }

  return run;
}

function normalizeTextRuns(runs: HtmlReportTextRun[]): HtmlReportTextRun[] {
  const trimmedRuns = trimAsciiWhitespaceFromRuns(runs);
  const normalizedRuns = trimmedRuns
    .map((run) => ({ ...run, text: run.text.replace(/\u00a0/g, " ") }))
    .filter((run) => run.text.length > 0);

  return coalesceRuns(normalizedRuns);
}

function trimAsciiWhitespaceFromRuns(runs: HtmlReportTextRun[]): HtmlReportTextRun[] {
  let remainingLeading = leadingAsciiWhitespaceLength(runs.map((run) => run.text).join(""));
  let remainingTrailing = trailingAsciiWhitespaceLength(runs.map((run) => run.text).join(""));
  const trimmed = runs.map((run) => ({ ...run }));

  for (const run of trimmed) {
    if (remainingLeading <= 0) {
      break;
    }

    const removeCount = Math.min(remainingLeading, run.text.length);
    run.text = run.text.slice(removeCount);
    remainingLeading -= removeCount;
  }

  for (let index = trimmed.length - 1; index >= 0; index -= 1) {
    if (remainingTrailing <= 0) {
      break;
    }

    const run = trimmed[index];
    const removeCount = Math.min(remainingTrailing, run.text.length);
    run.text = run.text.slice(0, run.text.length - removeCount);
    remainingTrailing -= removeCount;
  }

  return trimmed.filter((run) => run.text.length > 0);
}

function leadingAsciiWhitespaceLength(value: string): number {
  return value.match(/^[ \t\r\n]*/)?.[0].length ?? 0;
}

function trailingAsciiWhitespaceLength(value: string): number {
  return value.match(/[ \t\r\n]*$/)?.[0].length ?? 0;
}

function trimAsciiWhitespace(value: string): string {
  return value.replace(/^[ \t\r\n]+/, "").replace(/[ \t\r\n]+$/, "");
}

function coalesceRuns(runs: HtmlReportTextRun[]): HtmlReportTextRun[] {
  const coalesced: HtmlReportTextRun[] = [];
  for (const run of runs) {
    appendRun(coalesced, run);
  }

  return coalesced;
}

function shouldKeepRichText(runs: HtmlReportTextRun[], cell: HtmlReportCell): boolean {
  if (runs.length === 0) {
    return false;
  }

  if (runs.length > 1) {
    return true;
  }

  return !sameRunStyle(runs[0], cellStyleAsRun(cell));
}

function cellStyleAsRun(cell: HtmlReportCell): HtmlReportTextRun {
  return {
    text: "",
    backgroundColor: cell.backgroundColor,
    fontColor: cell.fontColor,
    bold: cell.bold || undefined,
    italic: cell.italic || undefined
  };
}

function sameRunStyle(left: HtmlReportTextRun, right: HtmlReportTextRun): boolean {
  return left.backgroundColor === right.backgroundColor
    && left.fontColor === right.fontColor
    && left.bold === right.bold
    && left.italic === right.italic
    && left.underline === right.underline;
}

function parseSpan(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const span = Number.parseInt(value, 10);
  return Number.isFinite(span) && span > 1 ? span : undefined;
}

function normalizeColor(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim().toLowerCase();
  if (trimmed === "transparent" || trimmed === "inherit") {
    return undefined;
  }

  const hex = trimmed.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const valuePart = hex[1];
    return valuePart.length === 3
      ? valuePart.split("").map((char) => `${char}${char}`).join("").toUpperCase()
      : valuePart.toUpperCase();
  }

  const rgb = trimmed.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/);
  if (rgb) {
    return [rgb[1], rgb[2], rgb[3]].map((part) => clampColor(Number(part)).toString(16).padStart(2, "0")).join("").toUpperCase();
  }

  return NAMED_COLORS[trimmed];
}

function clampColor(value: number): number {
  return Math.min(255, Math.max(0, value));
}

function isBold(value: string | undefined): boolean | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "bold" || Number(normalized) >= 600;
}

function isUnderline(value: string | undefined): boolean {
  return value?.toLowerCase().split(/\s+/).includes("underline") ?? false;
}

function normalizeHorizontalAlignment(value: string | undefined): HtmlReportCell["horizontalAlignment"] {
  if (value === "left" || value === "center" || value === "right") {
    return value;
  }

  return undefined;
}

const NAMED_COLORS: Record<string, string> = {
  black: "000000",
  blue: "0000FF",
  gray: "808080",
  grey: "808080",
  green: "008000",
  red: "FF0000",
  white: "FFFFFF",
  yellow: "FFFF00"
};

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: "\u00a0",
  quot: "\""
};
