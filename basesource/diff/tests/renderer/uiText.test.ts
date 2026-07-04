import { describe, expect, it } from "vitest";
import { statusLabel, UI_TEXT } from "../../src/renderer/src/uiText";

describe("UI_TEXT", () => {
  it("uses Japanese labels and names left/right as before/after", () => {
    expect(UI_TEXT.fields.beforeFolder).toBe("変更前フォルダ");
    expect(UI_TEXT.fields.afterFolder).toBe("変更後フォルダ");
    expect(UI_TEXT.fields.beforeRevision).toBe("変更前リビジョン");
    expect(UI_TEXT.fields.afterRevision).toBe("変更後リビジョン");
    expect(UI_TEXT.fields.outputChangeList).toBe("出力Word変更一覧");
    expect(UI_TEXT.fields.outputPathTestWorkbook).toBe("出力パステストExcel");
    expect(UI_TEXT.actions.choosePathTestWorkbook).toBe("パステストExcelの保存先を選択");
    expect(UI_TEXT.appDescription).toContain("パステストExcel");
    expect(UI_TEXT.actions.run).toBe("実行");
    expect(UI_TEXT.actions.stop).toBe("中止");
    expect(UI_TEXT.actions.browse).toBe("参照");
    expect(UI_TEXT.actions.openSettings).toBe("パラメータ設定を開く");
    expect(UI_TEXT.actions.save).toBe("保存");
    expect(UI_TEXT.actions.cancel).toBe("キャンセル");
    expect(UI_TEXT.settings.title).toBe("パラメータ設定");
    expect(UI_TEXT.settings.groups.cFiles).toBe("C系ファイル");
    expect(UI_TEXT.settings.groups.otherTextFiles).toBe("その他のテキストファイル");
    expect(UI_TEXT.settings.contextRows).toBe("表示・保持行数");
    expect(UI_TEXT.settings.hideRetainedRows).toBe("手動修正用の保持行を非表示にする");
    expect(UI_TEXT.settings.invalidContextRows).toBe("0以上の整数を入力してください。");
    expect(UI_TEXT.hints.cancelled).toBe("中止しました");
  });

  it("uses Japanese status labels", () => {
    expect(statusLabel("idle")).toBe("待機中");
    expect(statusLabel("running")).toBe("実行中");
    expect(statusLabel("cancelling")).toBe("中止中");
    expect(statusLabel("completed")).toBe("完了");
    expect(statusLabel("cancelled")).toBe("中止しました");
    expect(statusLabel("failed")).toBe("失敗");
  });
});
