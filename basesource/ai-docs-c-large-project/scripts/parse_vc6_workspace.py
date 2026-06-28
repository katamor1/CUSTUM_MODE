#!/usr/bin/env python3
"""
VC6 dsw/dsp の概要を抽出するための軽量スクリプト。

目的:
- .dsw / .dsp 一覧
- Project名
- 出力DLL/EXE候補
- include path候補
- preprocessor define候補
- ソースファイル一覧

注意:
- VC6プロジェクトは表記ゆれが多いため、まず候補抽出として扱う。
- 結果は人間レビュー前提。
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

TEXT_EXTS = {".dsw", ".dsp", ".c", ".h", ".cpp", ".hpp", ".rc", ".def"}


def read_text(path: Path) -> str:
    for enc in ("cp932", "shift_jis", "utf-8", "latin-1"):
        try:
            return path.read_text(encoding=enc, errors="strict")
        except UnicodeDecodeError:
            continue
    return path.read_text(encoding="cp932", errors="ignore")


def extract_dsp_info(dsp: Path, root: Path) -> dict[str, Any]:
    text = read_text(dsp)
    project_name = dsp.stem

    outputs = sorted(set(re.findall(r"/out:\\?\"?([^\"\s]+)", text, flags=re.IGNORECASE)))
    outputs += sorted(set(re.findall(r"# ADD LINK32 .*?/dll.*?/out:\\?\"?([^\"\s]+)", text, flags=re.IGNORECASE)))
    outputs = sorted(set(outputs))

    defines = sorted(set(re.findall(r"/D\s+\"?([^\"\s]+)", text)))
    include_paths = sorted(set(re.findall(r"/I\s+\"([^\"]+)\"|/I\s+([^\s]+)", text)))
    include_paths = sorted({a or b for a, b in include_paths})

    sources = []
    for m in re.finditer(r"SOURCE=(.+)", text):
        src = m.group(1).strip()
        sources.append(src)

    dependencies = sorted(set(re.findall(r"Project_Dep_Name\s+\"([^\"]+)\"", text)))

    return {
        "module_id": project_name,
        "dsw": "",
        "dsp": str(dsp.relative_to(root)),
        "project_name": project_name,
        "outputs": outputs,
        "defines": defines,
        "include_paths": include_paths,
        "source_files": sources,
        "dependencies": dependencies,
        "evidence": [str(dsp.relative_to(root))],
        "confidence": "C"
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", help="プロジェクトルート")
    parser.add_argument("--out", default="out/module_manifest.json")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    out = Path(args.out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)

    dsws = sorted(root.rglob("*.dsw"))
    dsps = sorted(root.rglob("*.dsp"))

    manifests = [extract_dsp_info(dsp, root) for dsp in dsps]

    # dswに含まれるdsp名を軽くひも付ける
    dsw_texts = [(dsw, read_text(dsw)) for dsw in dsws]
    for manifest in manifests:
        dsp_name = Path(manifest["dsp"]).name
        for dsw, text in dsw_texts:
            if dsp_name.lower() in text.lower():
                manifest["dsw"] = str(dsw.relative_to(root))
                break

    result = {
        "root": str(root),
        "dsw_count": len(dsws),
        "dsp_count": len(dsps),
        "modules": manifests,
        "notes": [
            "This is candidate data extracted from VC6 project files.",
            "Human review is required before treating it as authoritative."
        ]
    }

    out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {out}")
    print(f"dsw={len(dsws)} dsp={len(dsps)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
