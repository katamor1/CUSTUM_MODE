py -m venv .venv-release
.\.venv-release\Scripts\python.exe -m pip install --upgrade pip
.\.venv-release\Scripts\python.exe -m pip install setuptools wheel
.\.venv-release\Scripts\python.exe -m pip install -e .
.\.venv-release\Scripts\python.exe -m pip install pyinstaller
.\.venv-release\Scripts\python.exe -m PyInstaller --noconfirm --clean --onefile --console --name unit-test-runner --paths src scripts\pyinstaller_entry.py
New-Item -ItemType Directory -Force vscode\extension\bin\win32-x64 | Out-Null
Copy-Item -Force dist\unit-test-runner.exe vscode\extension\bin\win32-x64\unit-test-runner.exe
Push-Location vscode\extension
npm ci
npm.cmd test
npm.cmd exec --package @vscode/vsce -- vsce package --out ..\..\dist\unit-test-runner-vscode-0.1.0.vsix
Pop-Location
