param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path,
  [string]$SandboxRoot = (Join-Path $env:TEMP ("bob-workflow-integration-{0}" -f (Get-Date -Format "yyyyMMdd-HHmmss"))),
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

function Install-Vsix {
  param([string]$VsixPath)
  & $CodeCommand --user-data-dir $UserDataDir --extensions-dir $ExtensionsDir --install-extension $VsixPath --force
  if ($LASTEXITCODE -ne 0) {
    throw "VSIX install failed: $VsixPath"
  }
}

$RepoRoot = Resolve-RequiredPath $RepoRoot "Repository root"
$BobExtensionPath = Resolve-RequiredPath (Join-Path $RepoRoot "bob2\bob-code") "Expanded IBM Bob extension"
$WorkflowRegisterVsix = Resolve-RequiredPath (Join-Path $RepoRoot "extensions\workflow-register\workflow-register-0.1.0.vsix") "workflow-register VSIX"
$BazaarReviewVsix = Resolve-RequiredPath (Join-Path $RepoRoot "extensions\bob-bazaar-review\bob-bazaar-review-0.3.0.vsix") "bob-bazaar-review VSIX"
$CodeConsistencyVsix = Resolve-RequiredPath (Join-Path $RepoRoot "extensions\bob-code-consistency-review\bob-code-consistency-review-0.1.0.vsix") "bob-code-consistency-review VSIX"

$UserDataDir = Join-Path $SandboxRoot "user-data"
$ExtensionsDir = Join-Path $SandboxRoot "extensions"
$WorkspaceDir = Join-Path $SandboxRoot "workspace"
$WorkflowDir = Join-Path $WorkspaceDir ".bob\workflows\code-consistency-review"
$SampleSourceDir = Join-Path $RepoRoot "docs\workflows\code-consistency-review\examples\simple-timeout-bugfix"
$SampleTargetDir = Join-Path $WorkspaceDir "docs\workflows\code-consistency-review\examples\simple-timeout-bugfix"

New-Item -ItemType Directory -Force -Path $UserDataDir, $ExtensionsDir, $WorkspaceDir, $WorkflowDir, (Split-Path -Parent $SampleTargetDir) | Out-Null
Copy-Item -LiteralPath $SampleSourceDir -Destination $SampleTargetDir -Recurse -Force
Copy-Item -LiteralPath (Join-Path $SampleSourceDir "review-input.yaml") -Destination (Join-Path $WorkspaceDir "review-input.yaml") -Force
Copy-Item -LiteralPath (Join-Path $RepoRoot ".bob\workflows\code-consistency-review\WORKFLOW.md") -Destination (Join-Path $WorkflowDir "WORKFLOW.md") -Force

Install-Vsix $WorkflowRegisterVsix
Install-Vsix $BazaarReviewVsix
Install-Vsix $CodeConsistencyVsix

$launchArgs = @(
  "--user-data-dir", $UserDataDir,
  "--extensions-dir", $ExtensionsDir,
  "--extensionDevelopmentPath", $BobExtensionPath,
  $WorkspaceDir
)

Write-Host "Sandbox: $SandboxRoot"
Write-Host "Workspace: $WorkspaceDir"
Write-Host "Bob extensionDevelopmentPath: $BobExtensionPath"
Write-Host "Installed extensions:"
& $CodeCommand --user-data-dir $UserDataDir --extensions-dir $ExtensionsDir --list-extensions --show-versions

if ($NoLaunch) {
  Write-Host "Launch command:"
  Write-Host "$CodeCommand $($launchArgs -join ' ')"
  return
}

Start-Process -FilePath $CodeCommand -ArgumentList $launchArgs
