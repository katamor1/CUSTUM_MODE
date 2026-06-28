#!/usr/bin/env python3
"""
複数dspから参照されるヘッダを共有ヘッダ候補として抽出する。
まず候補抽出であり、正式な共有メモリIF判定ではない。
"""

from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from pathlib import Path


def read_text(path: Path) -> str:
    for enc in ("cp932", "shift_jis", "utf-8", "latin-1"):
        try:
            return path.read_text(encoding=enc, errors="strict")
        except UnicodeDecodeError:
            continue
    return path.read_text(encoding="cp932", errors="ignore")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("root")
    parser.add_argument("--out", default="out/shared_header_candidates.json")
    parser.add_argument("--min-modules", type=int, default=2)
    args = parser.parse_args()

    root = Path(args.root).resolve()
    out = Path(args.out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)

    header_to_sources = defaultdict(set)
    include_re = re.compile(r"^\s*#\s*include\s+[<\"]([^>\"]+)[>\"]", re.MULTILINE)

    for src in list(root.rglob("*.c")) + list(root.rglob("*.h")) + list(root.rglob("*.cpp")):
        text = read_text(src)
        rel = str(src.relative_to(root))
        for inc in include_re.findall(text):
            header_to_sources[inc].add(rel)

    candidates = []
    for header, sources in sorted(header_to_sources.items()):
        if len(sources) >= args.min_modules:
            candidates.append({
                "header": header,
                "reference_count": len(sources),
                "sources_sample": sorted(sources)[:50],
                "confidence": "C"
            })

    out.write_text(json.dumps({"candidates": candidates}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {out}")
    print(f"candidates={len(candidates)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
