import type { DocumentExtractionResult, EvidenceRef, ReviewInput } from "../core/result.js";

export async function extractDocuments(reviewInput: ReviewInput): Promise<DocumentExtractionResult> {
  const evidence: EvidenceRef[] = [];
  const documents: DocumentExtractionResult["documents"] = [];
  const warnings: string[] = [];
  const excerpts: string[] = [];

  let evidenceIndex = 1;

  for (const [artifactType, value] of Object.entries(reviewInput.artifacts)) {
    if (!Array.isArray(value)) {
      warnings.push(`artifact ${artifactType} is not an array; skipped`);
      continue;
    }

    for (const item of value as Array<{ path?: string; version?: string; sections?: string[]; cases?: string[]; rows?: string[] }>) {
      if (!item.path) {
        warnings.push(`artifact ${artifactType} has no path; skipped`);
        continue;
      }

      const documentId = `DOC-${artifactType.toUpperCase()}-${String(documents.length + 1).padStart(4, "0")}`;
      documents.push({ document_id: documentId, path: item.path, type: artifactType, version: item.version });

      const selectors = [...(item.sections ?? []), ...(item.cases ?? []), ...(item.rows ?? [])];
      for (const selector of selectors.length > 0 ? selectors : [item.path]) {
        const evidenceId = `${artifactType.toUpperCase()}-${String(evidenceIndex++).padStart(4, "0")}`;
        evidence.push({ evidence_id: evidenceId, type: artifactType, ref: selector });
        excerpts.push(`## ${evidenceId}\n\n- document: ${item.path}\n- version: ${item.version ?? "unknown"}\n- selector: ${selector}\n- type: ${artifactType}\n\nTODO: Extract document text here.\n`);
      }
    }
  }

  return {
    documents,
    excerptsMarkdown: excerpts.join("\n"),
    evidence,
    warnings,
  };
}
