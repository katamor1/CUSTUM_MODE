import { describe, expect, it } from "vitest";
import { parseHtmlReport, parseHtmlReportToRows } from "../../src/core/htmlReport";

describe("parseHtmlReportToRows", () => {
  it("extracts visible table cells from WinMerge-like HTML", () => {
    const rows = parseHtmlReportToRows(`
      <html>
        <body>
          <table>
            <tr><th>Line</th><th>Left</th><th>Right</th></tr>
            <tr><td>1</td><td>old value</td><td>new value</td></tr>
          </table>
        </body>
      </html>
    `);

    expect(rows).toEqual([
      ["Line", "Left", "Right"],
      ["1", "old value", "new value"]
    ]);
  });

  it("falls back to preformatted text when no table exists", () => {
    const rows = parseHtmlReportToRows("<pre>left\nright</pre>");

    expect(rows).toEqual([["left"], ["right"]]);
  });

  it("keeps table-like structure and CSS colors from WinMerge-like report cells", () => {
    const report = parseHtmlReport(`
      <html>
        <head>
          <style>
            .line { background-color: #eeeeee; text-align: right; }
            .changed { background-color: #ffdddd; color: #9c0006; font-weight: bold; }
          </style>
        </head>
        <body>
          <table>
            <tr><th class="line">Line</th><th>Left</th><th>Right</th></tr>
            <tr><td class="line">12</td><td class="changed">old</td><td style="background-color:#ddffdd;color:#006100">new</td></tr>
          </table>
        </body>
      </html>
    `);

    expect(report.rows[1].cells[0]).toMatchObject({ text: "12", backgroundColor: "EEEEEE", horizontalAlignment: "right" });
    expect(report.rows[1].cells[1]).toMatchObject({ text: "old", backgroundColor: "FFDDDD", fontColor: "9C0006", bold: true });
    expect(report.rows[1].cells[2]).toMatchObject({ text: "new", backgroundColor: "DDFFDD", fontColor: "006100" });
  });

  it("keeps colspan information so WinMerge header rows align with data rows", () => {
    const report = parseHtmlReport(`
      <table>
        <tr>
          <th colspan="2">left-file</th>
          <th colspan="2">right-file</th>
        </tr>
        <tr>
          <td>1</td><td>left line</td>
          <td>1</td><td>right line</td>
        </tr>
      </table>
    `);

    expect(report.rows[0].cells.map((cell) => ({ text: cell.text, colspan: cell.colspan }))).toEqual([
      { text: "left-file", colspan: 2 },
      { text: "right-file", colspan: 2 }
    ]);
    expect(parseHtmlReportToRows(`
      <table>
        <tr><th colspan="2">left-file</th><th colspan="2">right-file</th></tr>
        <tr><td>1</td><td>left line</td><td>1</td><td>right line</td></tr>
      </table>
    `)).toEqual([
      ["left-file", "", "right-file", ""],
      ["1", "left line", "1", "right line"]
    ]);
  });

  it("keeps inline syntax and inline-diff text styles from nested spans", () => {
    const report = parseHtmlReport(`
      <html>
        <head>
          <style>
            .code { color: #1f2937; }
            .kw { color: #0000ff; font-weight: bold; }
            .str { color: #a31515; }
            .inlineDiff { color: #9c0006; font-weight: bold; background-color: #ffeb9c; }
          </style>
        </head>
        <body>
          <table>
            <tr>
              <td class="code"><span class="kw">if</span> (name == <span class="str">"old"</span><span class="inlineDiff">Value</span>)</td>
            </tr>
          </table>
        </body>
      </html>
    `);

    expect(report.rows[0].cells[0].text).toBe('if (name == "old"Value)');
    expect(report.rows[0].cells[0].richText).toEqual([
      { text: "if", fontColor: "0000FF", bold: true },
      { text: " (name == ", fontColor: "1F2937" },
      { text: '"old"', fontColor: "A31515" },
      { text: "Value", backgroundColor: "FFEB9C", fontColor: "9C0006", bold: true },
      { text: ")", fontColor: "1F2937" }
    ]);
  });

  it("parses large WinMerge reports without building a full DOM for every row", () => {
    const rowCount = 2500;
    const codeRow = [
      '<tr>',
      '<td class="ln">128</td>',
      '<td class="sf3b2"><code><span class="sf9b2">static</span>&nbsp;const&nbsp;int&nbsp;value&nbsp;=&nbsp;<span class="sf7b2">53</span>;</code></td>',
      '<td class="ln">128</td>',
      '<td class="sf3b2"><code><span class="sf9b2">static</span>&nbsp;const&nbsp;int&nbsp;value&nbsp;=&nbsp;<span class="sf11b2">54</span>;</code></td>'
    ].join("");
    const html = [
      "<html><head>",
      "<title>WinMerge File Compare Report</title>",
      "<style>",
      ".title { background-color: blue; color: white; text-align: center; }",
      ".ln { background-color: #f0f0f0; text-align: right; }",
      ".sf3b2 { background-color: #ffffff; color: #1f2937; }",
      ".sf7b2 { background-color: #ffff00; color: #9c0006; font-weight: bold; }",
      ".sf9b2 { color: #0000ff; font-weight: bold; }",
      ".sf11b2 { background-color: #ffd966; color: #006100; font-weight: bold; }",
      "</style></head><body><table>",
      '<tr><th colspan="2" class="title">C:\\left\\src\\sample.c</th><th colspan="2" class="title">C:\\right\\src\\sample.c</th>',
      codeRow.repeat(rowCount),
      "</table></body></html>"
    ].join("");

    const startedAt = performance.now();
    const report = parseHtmlReport(html);
    const elapsedMs = performance.now() - startedAt;

    expect(report.rows).toHaveLength(rowCount + 1);
    expect(report.rows[0].cells).toEqual([
      expect.objectContaining({ text: "C:\\left\\src\\sample.c", colspan: 2, backgroundColor: "0000FF", fontColor: "FFFFFF", bold: true }),
      expect.objectContaining({ text: "C:\\right\\src\\sample.c", colspan: 2, backgroundColor: "0000FF", fontColor: "FFFFFF", bold: true })
    ]);
    expect(report.rows[1].cells[0]).toMatchObject({ text: "128", backgroundColor: "F0F0F0", horizontalAlignment: "right" });
    expect(report.rows[1].cells[1].text).toBe("static const int value = 53;");
    expect(report.rows[1].cells[1].richText).toEqual([
      { text: "static", backgroundColor: "FFFFFF", fontColor: "0000FF", bold: true },
      { text: " const int value = ", backgroundColor: "FFFFFF", fontColor: "1F2937" },
      { text: "53", backgroundColor: "FFFF00", fontColor: "9C0006", bold: true },
      { text: ";", backgroundColor: "FFFFFF", fontColor: "1F2937" }
    ]);
    expect(report.rows[report.rows.length - 1].cells[3].richText).toEqual([
      { text: "static", backgroundColor: "FFFFFF", fontColor: "0000FF", bold: true },
      { text: " const int value = ", backgroundColor: "FFFFFF", fontColor: "1F2937" },
      { text: "54", backgroundColor: "FFD966", fontColor: "006100", bold: true },
      { text: ";", backgroundColor: "FFFFFF", fontColor: "1F2937" }
    ]);
    expect(elapsedMs).toBeLessThan(1500);
  });
});
