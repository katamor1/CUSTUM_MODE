param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path,
  [string]$SandboxRoot = (Join-Path $env:TEMP ("bob-bazaar-review-integration-{0}" -f (Get-Date -Format "yyyyMMdd-HHmmss"))),
  [string]$CodeCommand = "code",
  [string]$BzrCommand = "bzr",
  [switch]$NoLaunch,
  [switch]$SkipExtensionInstall
)

$ErrorActionPreference = "Stop"

function Resolve-RequiredPath {
  param([string]$Path, [string]$Description)
  $resolved = Resolve-Path -LiteralPath $Path -ErrorAction SilentlyContinue
  if (-not $resolved) {
    throw "$Description not found: $Path"
  }
  return $resolved.Path
}

function Resolve-CommandPath {
  param([string]$CommandName)
  $command = Get-Command $CommandName -ErrorAction SilentlyContinue
  if (-not $command) {
    throw "Required command not found on PATH: $CommandName"
  }
  return $command.Source
}

function Invoke-CheckedCommand {
  param([string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory)
  Push-Location -LiteralPath $WorkingDirectory
  try {
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "Command failed in ${WorkingDirectory}: $FilePath $($Arguments -join ' ')"
    }
  } finally {
    Pop-Location
  }
}

function Invoke-Bazaar {
  param([string[]]$Arguments, [string]$WorkingDirectory)
  $Arguments = @("--no-aliases") + $Arguments
  Invoke-CheckedCommand $BzrPath $Arguments $WorkingDirectory
}

function Install-Vsix {
  param([string]$VsixPath)
  & $CodeCommand --user-data-dir $UserDataDir --extensions-dir $ExtensionsDir --install-extension $VsixPath --force
  if ($LASTEXITCODE -ne 0) {
    throw "VSIX install failed: $VsixPath"
  }
}

function Copy-DirectoryContents {
  param([string]$Source, [string]$Destination)
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force
  }
}

function Write-Utf8File {
  param([string]$Path, [string]$Content)
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function Write-Base64Bytes {
  param([string]$Path, [string]$ContentBase64)
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
  [System.IO.File]::WriteAllBytes($Path, [System.Convert]::FromBase64String($ContentBase64))
}

function Initialize-BobWorkspace {
  param([string]$WorkspaceDir)
  $targetBobDir = Join-Path $WorkspaceDir ".bob"
  Copy-DirectoryContents $BobTemplateRoot $targetBobDir

  $mcpServerPath = Join-Path $RepoRoot "extensions\bob-bazaar-review\out\mcp\server.js"
  $mcpJson = [ordered]@{
    mcpServers = [ordered]@{
      bazaar = [ordered]@{
        command = $NodeCommand
        args = @($mcpServerPath)
        env = [ordered]@{ BZR_PATH = $BzrPath }
        disabled = $false
      }
    }
  }
  $mcpJson | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $targetBobDir "mcp.json") -Encoding UTF8

  Write-Utf8File (Join-Path $WorkspaceDir "EXPECTED_BAZAAR_REVIEW_FINDINGS.md") @'
# Expected Bazaar Review Findings

This fixture verifies a workspace where the `.bob` parent and `.bzr` parent are separate.
The Bob workspace is `bob-managed`; the Bazaar repository is `bazaar-source`.

Review target:

- revisionMode: `revisionRange`
- baseRevision: `1`
- targetRevision: `2`

Expected review outcomes:

| rule | expected | evidence |
| --- | --- | --- |
| RT-001 | fail | `printf` and `SleepForIo` are added inside `RT_CONTROL` in `src/rt_control.c` |
| RT-002 | fail | `malloc` / `free` are added inside `RT_CONTROL` in `src/rt_control.c` |
| IF-001 | fail | `PlcSharedFrame` type, order, and size change in `src/if/plc_shared.h` |
| IF-002 | fail | `shared_owner` and `PLC_READ_SHARED_OVERRIDE` make shared-memory ownership ambiguous |
| GV-001 | fail | `extern` / `static` global state is updated without visible exclusion |
| ERR-001 | fail | `read_sensor_with_timeout` return value is ignored and timeout/error behavior is unclear |
| BOUND-001 | fail | `sprintf` and fixed `message[16]` buffers lack bounds handling |
| DOC-001 | unknown or fail | Design, IF ledger, message ledger, and basic design remain at the old contract |
| UT-001 | fail | Branches and error paths change without test-spec updates |

Additional checks:

- `docs/messages-shiftjis.txt` is written as Shift-JIS / CP932 bytes.
- Use only `bzr --no-aliases <command>` for manual Bazaar investigation.
'@

  Write-Utf8File (Join-Path $WorkspaceDir "review-inputs.json") @"
{
  "revisionMode": "revisionRange",
  "baseRevision": "1",
  "targetRevision": "2",
  "bazaarRoot": "$($BazaarRepoDir.Replace("\", "\\"))",
  "workflowRoot": "$($WorkspaceDir.Replace("\", "\\"))"
}
"@
}

function Initialize-BazaarReviewRepository {
  param([string]$BazaarRepoDir)
  New-Item -ItemType Directory -Force -Path $BazaarRepoDir | Out-Null

  Write-Utf8File (Join-Path $BazaarRepoDir "README.md") @"
# Bazaar Review Fixture

This repository is intentionally separate from the Bob-managed `.bob` workspace.
Use revision range `1..2` for the Bob Bazaar review sandbox.
"@

  Write-Utf8File (Join-Path $BazaarRepoDir "src\if\plc_shared.h") @"
#ifndef PLC_SHARED_H
#define PLC_SHARED_H

#include <stdint.h>

typedef struct PlcSharedFrame {
    uint16_t version;
    int32_t sensor_value;
    int32_t motion_command;
    int32_t status_code;
} PlcSharedFrame;

#endif
"@

  Write-Utf8File (Join-Path $BazaarRepoDir "src\rt_control.c") @"
#include "if/plc_shared.h"

static int global_cycle_budget_ms = 10;

int RT_CONTROL(PlcSharedFrame *shared, int sensor_value)
{
    if (shared == 0) {
        return -1;
    }
    shared->sensor_value = sensor_value;
    shared->motion_command = sensor_value > 100 ? 1 : 0;
    shared->status_code = 0;
    return global_cycle_budget_ms;
}
"@

  Write-Utf8File (Join-Path $BazaarRepoDir "src\diagnostics.c") @"
#include <stdio.h>

int format_status(char *message, unsigned int message_size, int status)
{
    if (message == 0 || message_size == 0) {
        return -1;
    }
    return snprintf(message, message_size, "status=%d", status);
}
"@

  Write-Utf8File (Join-Path $BazaarRepoDir "docs\basic-design.md") @"
# Basic Design

- The PLC shared frame layout is version, sensor value, motion command, status code.
- RT_CONTROL does not perform file I/O, console I/O, dynamic allocation, or wait processing.
- Error handling returns a negative value and does not update shared state on invalid input.
"@

  Write-Utf8File (Join-Path $BazaarRepoDir "docs\test-spec.md") @"
# Test Spec

- Verify normal sensor values update motion command.
- Verify null shared frame returns an error.
"@

  Invoke-Bazaar @("init") $BazaarRepoDir
  Invoke-Bazaar @("whoami", "Bob Bazaar Fixture <bob-bazaar-fixture@example.local>", "--branch") $BazaarRepoDir
  Invoke-Bazaar @("add", ".") $BazaarRepoDir
  Invoke-Bazaar @("commit", "-m", "baseline: deterministic control behavior") $BazaarRepoDir

  Write-Utf8File (Join-Path $BazaarRepoDir "src\if\plc_shared.h") @"
#ifndef PLC_SHARED_H
#define PLC_SHARED_H

#include <stdint.h>

#define PLC_READ_SHARED_OVERRIDE 2

typedef struct PlcSharedFrame {
    uint8_t version;
    int32_t motion_command;
    char message[16];
    int32_t sensor_value;
    int32_t status_code;
    int32_t shared_owner;
} PlcSharedFrame;

#endif
"@

  Write-Utf8File (Join-Path $BazaarRepoDir "src\rt_control.c") @"
#include "if/plc_shared.h"
#include <stdio.h>
#include <stdlib.h>

extern int global_error_count;
static int global_last_sensor;

int read_sensor_with_timeout(int timeout_ms);
void SleepForIo(int milliseconds);

int RT_CONTROL(PlcSharedFrame *shared, int sensor_value)
{
    char message[16];
    sprintf(message, "sensor=%d", sensor_value);
    printf("RT_CONTROL %s\n", message);
    SleepForIo(5);

    int *scratch = (int *)malloc(sizeof(int));
    if (scratch) {
        *scratch = sensor_value;
    }

    read_sensor_with_timeout(0);
    shared->motion_command = PLC_READ_SHARED_OVERRIDE;
    shared->shared_owner = 2;
    shared->sensor_value = sensor_value;
    shared->status_code = sensor_value < 0 ? -1 : 0;
    shared->message[0] = message[0];

    global_last_sensor = sensor_value;
    if (sensor_value < 0) {
        global_error_count++;
        return shared->status_code;
    }

    free(scratch);
    return 0;
}
"@

  Write-Utf8File (Join-Path $BazaarRepoDir "src\diagnostics.c") @"
#include <stdio.h>
#include <string.h>

int format_status(char *message, unsigned int message_size, int status)
{
    char local[8];
    sprintf(local, "status=%d", status);
    strcpy(message, local);
    return 0;
}
"@

  Write-Base64Bytes (Join-Path $BazaarRepoDir "docs\messages-shiftjis.txt") "g4GDYoNagVuDV5HkkqA6DQqOZJdslc+NWI6egs0gbWVzc2FnZSBJRIFBlVyOppW2jL6BQYjZj+2OnoLMlZyLjI7oj4eC8I1YkFaCt4LpgrGCxoFCDQqCsYLMg3SDQINDg4uCzSBTaGlmdC1KSVMgjJ+P2JdwgsWCt4FCDQo="

  Invoke-Bazaar @("add", ".") $BazaarRepoDir
  Invoke-Bazaar @("commit", "-m", "introduce review matrix regressions") $BazaarRepoDir
  $script:TargetRevision = (Invoke-Bazaar @("revno") $BazaarRepoDir | Select-Object -Last 1).Trim()
}

function Write-SandboxReadme {
  param([string]$SandboxRoot)
  Write-Utf8File (Join-Path $SandboxRoot "README-bob-bazaar-review-sandbox.md") @"
# Bob Bazaar Review Integration Sandbox

## Roots

- Bob workspace: $BobWorkspaceDir
- Bazaar repository: $BazaarRepoDir
- VS Code workspace: $WorkspaceFile

## Review Target

- mode: revision range
- base revision: 1
- target revision: $TargetRevision

## Manual Verification

1. Open the generated VS Code workspace.
2. Confirm the Bazaar Review GUI shows separate roots: Bazaar: $BazaarRepoDir / Bob: $BobWorkspaceDir.
3. Start bazaar-project-rule-review.
4. Select revision range 1 to $TargetRevision.
5. Generate the packet with project rules enabled.
6. Ask Bob to complete the checklist and compare the result with $BobWorkspaceDir\EXPECTED_BAZAAR_REVIEW_FINDINGS.md.

Use only bzr --no-aliases <command> for manual Bazaar investigation.
"@
}

function Write-CodeWorkspaceFile {
  $workspace = [ordered]@{
    folders = @(
      [ordered]@{ "name" = "bob-managed"; "path" = $BobWorkspaceDir },
      [ordered]@{ "name" = "bazaar-source"; "path" = $BazaarRepoDir }
    )
    settings = [ordered]@{
      "bobBazaar.bzrPath" = $BzrPath
      "bobBazaar.textEncoding" = "auto"
    }
  }
  $workspace | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $WorkspaceFile -Encoding UTF8
}

$RepoRoot = Resolve-RequiredPath $RepoRoot "Repository root"
$BobExtensionPath = Resolve-RequiredPath (Join-Path $RepoRoot "bob2\bob-code") "Expanded IBM Bob extension"
$BobTemplateRoot = Resolve-RequiredPath (Join-Path $RepoRoot "extensions\bob-bazaar-review\templates\.bob") "bob-bazaar-review .bob template"
$McpTemplatePath = Resolve-RequiredPath (Join-Path $BobTemplateRoot "mcp.json.template") "mcp.json.template"
$WorkflowRegisterVsix = Resolve-RequiredPath (Join-Path $RepoRoot "extensions\workflow-register\workflow-register-0.1.0.vsix") "workflow-register VSIX"
$BazaarReviewVsix = Resolve-RequiredPath (Join-Path $RepoRoot "extensions\bob-bazaar-review\bob-bazaar-review-0.3.0.vsix") "bob-bazaar-review VSIX"
$NodeCommand = Resolve-CommandPath "node"
$BzrPath = Resolve-CommandPath $BzrCommand

if (Test-Path -LiteralPath $SandboxRoot) {
  throw "SandboxRoot already exists. Choose a new -SandboxRoot: $SandboxRoot"
}

$UserDataDir = Join-Path $SandboxRoot "user-data"
$ExtensionsDir = Join-Path $SandboxRoot "extensions"
$BobWorkspaceDir = Join-Path $SandboxRoot "bob-managed"
$BazaarRepoDir = Join-Path $SandboxRoot "bazaar-source"
$WorkspaceFile = Join-Path $SandboxRoot "bob-bazaar-review.code-workspace"

New-Item -ItemType Directory -Force -Path $UserDataDir, $ExtensionsDir, $BobWorkspaceDir, $BazaarRepoDir | Out-Null
if ((Resolve-Path -LiteralPath $BobWorkspaceDir).Path -eq (Resolve-Path -LiteralPath $BazaarRepoDir).Path) {
  throw "Bob workspace and Bazaar repository must be separate roots."
}

Initialize-BobWorkspace $BobWorkspaceDir
Initialize-BazaarReviewRepository $BazaarRepoDir
Write-CodeWorkspaceFile
Write-SandboxReadme $SandboxRoot

if (-not $SkipExtensionInstall) {
  Install-Vsix $WorkflowRegisterVsix
  Install-Vsix $BazaarReviewVsix
}

$launchArgs = @(
  "--user-data-dir", $UserDataDir,
  "--extensions-dir", $ExtensionsDir,
  "--extensionDevelopmentPath", $BobExtensionPath,
  $WorkspaceFile
)

Write-Host "Sandbox: $SandboxRoot"
Write-Host "Bob workspace: $BobWorkspaceDir"
Write-Host "Bazaar repository: $BazaarRepoDir"
Write-Host "VS Code workspace: $WorkspaceFile"
Write-Host "Review range: 1..$TargetRevision"
Write-Host "Expected findings: $(Join-Path $BobWorkspaceDir "EXPECTED_BAZAAR_REVIEW_FINDINGS.md")"
Write-Host "Sandbox README: $(Join-Path $SandboxRoot "README-bob-bazaar-review-sandbox.md")"

if (-not $SkipExtensionInstall) {
  Write-Host "Installed extensions:"
  & $CodeCommand --user-data-dir $UserDataDir --extensions-dir $ExtensionsDir --list-extensions --show-versions
}

if ($NoLaunch) {
  Write-Host "Launch command:"
  Write-Host "$CodeCommand $($launchArgs -join ' ')"
  return
}

Start-Process -FilePath $CodeCommand -ArgumentList $launchArgs
