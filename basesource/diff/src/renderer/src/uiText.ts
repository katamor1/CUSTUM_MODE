export type UiRunState =
  | "idle"
  | "running"
  | "cancelling"
  | "completed"
  | "cancelled"
  | "failed";

export const UI_TEXT = {
  appTitle: "差分レポート作成",
  appDescription: "WinMerge差分Excel、パステストExcel、変更ファイル一覧Wordを作成します。",
  modes: {
    folders: "フォルダ",
    bazaar: "Bazaar"
  },
  fields: {
    beforeFolder: "変更前フォルダ",
    afterFolder: "変更後フォルダ",
    bazaarRepository: "Bazaarリポジトリ",
    beforeRevision: "変更前リビジョン",
    afterRevision: "変更後リビジョン",
    bazaarExecutable: "bzr/brz 実行ファイル",
    winMergeExecutable: "WinMergeU.exe",
    outputWorkbook: "出力Excelブック",
    outputPathTestWorkbook: "出力パステストExcel",
    outputChangeList: "出力Word変更一覧"
  },
  actions: {
    run: "実行",
    stop: "中止",
    browse: "参照",
    saveAs: "保存先",
    openSettings: "パラメータ設定を開く",
    close: "閉じる",
    save: "保存",
    cancel: "キャンセル",
    chooseWinMerge: "WinMergeU.exeを選択",
    chooseBazaar: "bzr.exeまたはbrz.exeを選択",
    choosePathTestWorkbook: "パステストExcelの保存先を選択",
    chooseFolder: "フォルダを参照",
    runReport: "レポート生成を実行"
  },
  settings: {
    title: "パラメータ設定",
    groups: {
      cFiles: "C系ファイル",
      otherTextFiles: "その他のテキストファイル",
      externalTools: "外部ツール"
    },
    contextRows: "表示・保持行数",
    hideRetainedRows: "手動修正用の保持行を非表示にする",
    invalidContextRows: "0以上の整数を入力してください。"
  },
  hints: {
    dropFolder: "フォルダをここにドロップ",
    ready: "待機中",
    cancelled: "中止しました",
    emptyLog: "まだログはありません。"
  },
  log: {
    started: "処理を開始しました",
    cancelling: "中止を要求しました",
    cancelled: "処理を中止しました",
    done: (files: number, outputPath: string) => `完了: ${files}件 -> ${outputPath}`,
    error: (message: string) => `エラー: ${message}`
  }
} as const;

export function statusLabel(state: UiRunState): string {
  switch (state) {
    case "running":
      return "実行中";
    case "cancelling":
      return "中止中";
    case "completed":
      return "完了";
    case "cancelled":
      return "中止しました";
    case "failed":
      return "失敗";
    default:
      return "待機中";
  }
}
