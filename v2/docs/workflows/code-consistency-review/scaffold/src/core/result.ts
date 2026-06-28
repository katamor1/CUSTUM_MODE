export type ValidationReport = {
  errors: string[];
  warnings: string[];
};

export type ReviewInput = {
  schema_version: 1;
  review: {
    id: string;
    title: string;
    change_type: string;
    purpose: string;
    base: string;
    head: string;
    ticket_ids?: string[];
    author_note?: string;
    out_of_scope?: string[];
  };
  artifacts: Record<string, unknown>;
  review_focus: string[];
  analysis_options?: Record<string, unknown>;
  bob_options?: Record<string, unknown>;
};

export type DiffSummary = {
  base: string;
  head: string;
  files: Array<{
    path: string;
    status: "added" | "modified" | "deleted" | "renamed" | "unknown";
    additions?: number;
    deletions?: number;
    language?: string;
  }>;
  unifiedDiff?: string;
  warnings: string[];
};

export type DocumentExtractionResult = {
  documents: Array<{
    document_id: string;
    path: string;
    type: string;
    version?: string;
  }>;
  excerptsMarkdown: string;
  evidence: EvidenceRef[];
  warnings: string[];
};

export type CodeAnalysisResult = {
  changedSymbols: Array<{
    id: string;
    name: string;
    kind: "function" | "type" | "define" | "global" | "unknown";
    file: string;
    confidence: "high" | "medium" | "low";
  }>;
  summaryMarkdown: string;
  warnings: string[];
};

export type TraceabilityResult = {
  markdown: string;
  warnings: string[];
};

export type EvidenceRef = {
  evidence_id: string;
  type: string;
  ref: string;
};
