#!/usr/bin/env python3
"""JSONファイルの構文チェックを行う軽量CI用スクリプト。"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def main() -> int:
    ok = True
    for path in Path('.').rglob('*.json'):
        try:
            json.loads(path.read_text(encoding='utf-8'))
        except Exception as exc:
            ok = False
            print(f"JSON ERROR: {path}: {exc}")
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
