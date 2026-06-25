import { ProjectChecklist } from "./types"

export const DEFAULT_CHECKLIST: ProjectChecklist = {
  version: "1.0.0",
  project: "legacy-control",
  rules: [
    {
      id: "RT-001",
      category: "realtime",
      title: "RTスレッド内でI/Oを行っていない",
      description: "RT_INPUT, RT_CONTROL, RT_OUTPUTではファイルI/O、標準出力、ログ出力、待ち処理を行わない。",
      severity_on_fail: "error",
      applies_when: [
        "changed_file_matches:src/rt_*.c",
        "diff_contains:RT_CONTROL",
        "diff_contains:RT_INPUT",
        "diff_contains:RT_OUTPUT"
      ],
      evidence_required: true,
      review_hint: "I/O関数、ログ関数、sleep/wait、mutex待ち、動的確保を重点確認する。"
    },
    {
      id: "IF-001",
      category: "external-interface",
      title: "外部I/F構造体のサイズ・並び順を壊していない",
      description: "PLC/モーション/センサIFに関わる構造体は互換性を維持する。",
      severity_on_fail: "error",
      applies_when: [
        "changed_file_matches:src/if/**",
        "diff_contains:struct"
      ],
      evidence_required: true,
      review_hint: "構造体メンバの追加、削除、型変更、順序変更、padding影響を確認する。"
    },
    {
      id: "GV-001",
      category: "global-state",
      title: "グローバル変数更新の順序・排他が維持されている",
      description: "共有状態を更新する場合、既存の排他・更新順序・初期化順序を壊さない。",
      severity_on_fail: "warning",
      applies_when: ["diff_contains:extern", "diff_contains:global", "diff_contains:static"],
      evidence_required: true,
      review_hint: "割込み、RT/TSスレッド、共有メモリ、状態遷移に関わる更新順序を確認する。"
    },
    {
      id: "ERR-001",
      category: "error-handling",
      title: "エラー処理・タイムアウト・リトライが不足していない",
      description: "外部I/O、通信、センサ、モーション、ファイル操作では失敗時の扱いを明示する。",
      severity_on_fail: "warning",
      applies_when: ["diff_contains:return", "diff_contains:error", "diff_contains:timeout"],
      evidence_required: true,
      review_hint: "戻り値無視、異常時ログ不足、復旧不能状態、無限待ちを確認する。"
    },
    {
      id: "UT-001",
      category: "test",
      title: "単体テストまたは機能テスト観点が追加・更新されている",
      description: "仕様変更や分岐追加がある場合、対応するテスト観点を更新する。",
      severity_on_fail: "warning",
      applies_when: ["diff_contains:if", "diff_contains:switch", "diff_contains:return"],
      evidence_required: false,
      review_hint: "境界値、異常系、既存互換、デグレード観点のテスト不足を確認する。"
    }
  ]
}

export const REVIEW_RESULT_SCHEMA = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://example.local/bob-bazaar-review/review-result.schema.json",
  "title": "Project Rule Review Result",
  "type": "object",
  "required": ["review_id", "vcs", "checklist_results", "findings", "summary"],
  "additionalProperties": false,
  "properties": {
    "review_id": { "type": "string", "minLength": 1 },
    "vcs": {
      "type": "object",
      "required": ["type"],
      "additionalProperties": true,
      "properties": {
        "type": { "type": "string" },
        "repository": { "type": "string" },
        "revision_mode": { "type": "string" },
        "revision": { "type": "string" },
        "base_revision": { "type": "string" },
        "target_revision": { "type": "string" }
      }
    },
    "checklist_results": {
      "type": "array",
      "items": { "$ref": "#/$defs/checklistResult" }
    },
    "findings": {
      "type": "array",
      "items": { "$ref": "#/$defs/finding" }
    },
    "summary": {
      "type": "object",
      "required": ["pass", "fail", "unknown", "not_applicable", "blocked"],
      "additionalProperties": false,
      "properties": {
        "pass": { "type": "integer", "minimum": 0 },
        "fail": { "type": "integer", "minimum": 0 },
        "unknown": { "type": "integer", "minimum": 0 },
        "not_applicable": { "type": "integer", "minimum": 0 },
        "blocked": { "type": "integer", "minimum": 0 }
      }
    }
  },
  "$defs": {
    "evidence": {
      "type": "object",
      "required": ["summary"],
      "additionalProperties": false,
      "properties": {
        "file": { "type": "string" },
        "start_line": { "type": "integer", "minimum": 1 },
        "end_line": { "type": "integer", "minimum": 1 },
        "summary": { "type": "string", "minLength": 1 }
      }
    },
    "checklistResult": {
      "type": "object",
      "required": ["rule_id", "title", "status", "severity", "confidence", "evidence", "reason"],
      "additionalProperties": false,
      "properties": {
        "rule_id": { "type": "string", "minLength": 1 },
        "title": { "type": "string", "minLength": 1 },
        "status": { "enum": ["pass", "fail", "unknown", "not_applicable", "blocked"] },
        "severity": { "enum": ["error", "warning", "info"] },
        "confidence": { "enum": ["high", "medium", "low"] },
        "evidence": { "type": "array", "items": { "$ref": "#/$defs/evidence" } },
        "reason": { "type": "string", "minLength": 1 },
        "suggested_action": { "type": "string" }
      }
    },
    "finding": {
      "type": "object",
      "required": ["id", "rule_id", "severity", "title", "description"],
      "additionalProperties": false,
      "properties": {
        "id": { "type": "string", "minLength": 1 },
        "rule_id": { "type": "string", "minLength": 1 },
        "severity": { "enum": ["error", "warning", "info"] },
        "file": { "type": "string" },
        "start_line": { "type": "integer", "minimum": 1 },
        "end_line": { "type": "integer", "minimum": 1 },
        "title": { "type": "string", "minLength": 1 },
        "description": { "type": "string", "minLength": 1 },
        "suggested_fix": { "type": "string" }
      }
    }
  }
} as const
