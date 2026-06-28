#!/usr/bin/env python3
"""
モジュール単位AIパケットの雛形を作成する。
"""

from __future__ import annotations

import argparse
from pathlib import Path

TEMPLATE_PROMPT = """# AI Packet: {module_id}

このパケットを使って対象モジュールのModule Cardを作成してください。

## ルール

- 根拠のない断言をしない。
- 推定は推定として明記する。
- 共有メモリ、初期化順序、バックアップ・復元は人間レビュー必須。
- 信頼度A/B/C/Dを付ける。
"""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("module_id")
    parser.add_argument("--base", default="docs_ai/80_ai_packets/module_packets")
    args = parser.parse_args()

    base = Path(args.base)
    packet = base / f"ai_packet_module_{args.module_id}"
    packet.mkdir(parents=True, exist_ok=True)

    files = {
        "prompt.md": TEMPLATE_PROMPT.format(module_id=args.module_id),
        "module_manifest.json": "{}\n",
        "related_dsp_summary.md": "# related_dsp_summary\n\nTBD\n",
        "exported_functions.json": "[]\n",
        "included_shared_headers.json": "[]\n",
        "global_read_write_summary.json": "{}\n",
        "source_files_list.txt": "",
        "selected_source_snippets.md": "# selected_source_snippets\n\nTBD\n",
        "known_risks.md": "# known_risks\n\nTBD\n"
    }

    for name, content in files.items():
        path = packet / name
        if not path.exists():
            path.write_text(content, encoding="utf-8")

    print(packet)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
