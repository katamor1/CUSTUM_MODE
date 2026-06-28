import { join } from "node:path";
import YAML from "yaml";
import { readTextFile, writeTextFile } from "../core/file-system.js";

export async function generateHumanTriage(input: {
  packageDir: string;
  bobOutputPath: string;
  outDir: string;
}): Promise<void> {
  const raw = await readTextFile(input.bobOutputPath);
  const bobOutput = YAML.parse(raw) as {
    review_summary?: { review_id?: string };
    findings?: Array<Record<string, unknown>>;
    questions?: Array<Record<string, unknown>>;
  };

  const reviewId = bobOutput.review_summary?.review_id ?? "unknown";
  const findings = bobOutput.findings ?? [];
  const questions = bobOutput.questions ?? [];

  const triageYaml = YAML.stringify({
    schema_version: 1,
    review_id: reviewId,
    triaged_by: "",
    triaged_at: "",
    items: [
      ...findings.map((finding) => ({
        source_id: finding.id,
        source_type: "finding",
        decision: "",
        final_severity: finding.severity ?? "",
        owner: "",
        reason: "",
        review_comment: finding.summary ?? "",
        question: "",
        follow_up: { required: false, action: "", due: "" },
      })),
      ...questions.map((question) => ({
        source_id: question.id,
        source_type: "question",
        decision: "",
        final_severity: "",
        owner: question.suggested_owner ?? "",
        reason: "",
        review_comment: "",
        question: question.summary ?? "",
        follow_up: { required: false, action: question.suggested_action ?? "", due: "" },
      })),
    ],
  });

  await writeTextFile(join(input.outDir, "triage-result.yaml"), triageYaml);
  await writeTextFile(join(input.outDir, "accepted-findings.md"), buildFindingMarkdown("採用するプレレビュー指摘", findings));
  await writeTextFile(join(input.outDir, "questions-to-author.md"), buildFindingMarkdown("作成者への確認事項", questions));
  await writeTextFile(join(input.outDir, "rejected-findings.md"), "# 棄却したプレレビュー指摘\n\nMVP scaffold: fill after triage.\n");
  await writeTextFile(join(input.outDir, "follow-up-actions.md"), "# 後続対応\n\nMVP scaffold: fill after triage.\n");
}

function buildFindingMarkdown(title: string, items: Array<Record<string, unknown>>): string {
  const lines = [`# ${title}`, ""];
  for (const item of items) {
    lines.push(`## ${String(item.id ?? "unknown")}`);
    lines.push("");
    lines.push(String(item.summary ?? ""));
    lines.push("");
  }
  return lines.join("\n");
}
