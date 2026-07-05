param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path,
  [string]$SandboxRoot = (Join-Path $env:TEMP ("process-workflow-integration-{0}" -f (Get-Date -Format "yyyyMMdd-HHmmss"))),
  [string]$CodeCommand = "code",
  [switch]$NoLaunch
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

function Copy-DirectoryContents {
  param([string]$Source, [string]$Destination)
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force
  }
}

function Install-Vsix {
  param([string]$VsixPath)
  & $CodeCommand --user-data-dir $UserDataDir --extensions-dir $ExtensionsDir --install-extension $VsixPath --force
  if ($LASTEXITCODE -ne 0) {
    throw "VSIX install failed: $VsixPath"
  }
}

$RepoRoot = Resolve-RequiredPath $RepoRoot "Repository root"
$SampleRoot = Resolve-RequiredPath (Join-Path $RepoRoot "docs\workflows\process-workflows\examples\mini-process-sandbox") "mini process sandbox"
$ProcessCatalogDir = Resolve-RequiredPath (Join-Path $RepoRoot ".bob\process") ".bob\process"
$ProcessWorkflowPattern = "process-*"

$UserDataDir = Join-Path $SandboxRoot "user-data"
$ExtensionsDir = Join-Path $SandboxRoot "extensions"
$WorkspaceDir = Join-Path $SandboxRoot "workspace"
$WorkflowRoot = Join-Path $WorkspaceDir ".bob\workflows"

New-Item -ItemType Directory -Force -Path $UserDataDir, $ExtensionsDir, $WorkspaceDir, $WorkflowRoot | Out-Null
Copy-DirectoryContents $SampleRoot $WorkspaceDir
Copy-Item -LiteralPath $ProcessCatalogDir -Destination (Join-Path $WorkspaceDir ".bob\process") -Recurse -Force

Get-ChildItem -LiteralPath (Join-Path $RepoRoot ".bob\workflows") -Directory -Filter $ProcessWorkflowPattern | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $WorkflowRoot -Recurse -Force
}

$WorkflowCount = (Get-ChildItem -LiteralPath $WorkflowRoot -Directory -Filter $ProcessWorkflowPattern).Count
if ($WorkflowCount -lt 14) {
  throw "Expected at least 14 process workflows, found $WorkflowCount"
}

$launchArgs = @(
  "--user-data-dir", $UserDataDir,
  "--extensions-dir", $ExtensionsDir,
  $WorkspaceDir
)

Write-Host "Sandbox: $SandboxRoot"
Write-Host "Workspace: $WorkspaceDir"
Write-Host "Process workflows: $WorkflowCount"
Write-Host "Process input: $(Join-Path $WorkspaceDir 'process-input.yaml')"

if ($NoLaunch) {
  Write-Host "Launch command:"
  Write-Host "$CodeCommand $($launchArgs -join ' ')"
  return
}

$BobExtensionPath = Resolve-RequiredPath (Join-Path $RepoRoot "bob2\bob-code") "Expanded IBM Bob extension"
$WorkflowRegisterVsix = Resolve-RequiredPath (Join-Path $RepoRoot "extensions\workflow-register\workflow-register-0.1.0.vsix") "workflow-register VSIX"
$CodeConsistencyVsix = Resolve-RequiredPath (Join-Path $RepoRoot "extensions\bob-code-consistency-review\bob-code-consistency-review-0.1.0.vsix") "bob-code-consistency-review VSIX"
$BazaarReviewVsix = Resolve-RequiredPath (Join-Path $RepoRoot "extensions\bob-bazaar-review\bob-bazaar-review-0.3.0.vsix") "bob-bazaar-review VSIX"

Install-Vsix $WorkflowRegisterVsix
Install-Vsix $CodeConsistencyVsix
Install-Vsix $BazaarReviewVsix

$launchArgs = @(
  "--user-data-dir", $UserDataDir,
  "--extensions-dir", $ExtensionsDir,
  "--extensionDevelopmentPath", $BobExtensionPath,
  $WorkspaceDir
)

Start-Process -FilePath $CodeCommand -ArgumentList $launchArgs
