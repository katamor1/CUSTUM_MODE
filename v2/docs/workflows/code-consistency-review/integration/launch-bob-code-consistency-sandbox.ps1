param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path,
  [string]$SandboxRoot = (Join-Path $env:TEMP ("bob-workflow-integration-{0}" -f (Get-Date -Format "yyyyMMdd-HHmmss"))),
  [ValidateSet("simple-timeout-bugfix", "ai-verification-matrix")]
  [string]$Sample = "simple-timeout-bugfix",
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

function Copy-DirectoryContents {
  param([string]$Source, [string]$Destination)
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force
  }
}

function Initialize-SimpleTimeoutWorkspace {
  param([string]$RepoRoot, [string]$WorkspaceDir)
  $SampleSourceDir = Resolve-RequiredPath (Join-Path $RepoRoot "docs\workflows\code-consistency-review\examples\simple-timeout-bugfix") "simple-timeout-bugfix sample"
  $SampleTargetDir = Join-Path $WorkspaceDir "docs\workflows\code-consistency-review\examples\simple-timeout-bugfix"
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $SampleTargetDir) | Out-Null
  Copy-Item -LiteralPath $SampleSourceDir -Destination $SampleTargetDir -Recurse -Force
  Copy-Item -LiteralPath (Join-Path $SampleSourceDir "review-input.yaml") -Destination (Join-Path $WorkspaceDir "review-input.yaml") -Force
}

function Initialize-AiVerificationMatrixWorkspace {
  param([string]$RepoRoot, [string]$WorkspaceDir)
  $SampleRoot = Resolve-RequiredPath (Join-Path $RepoRoot "docs\workflows\code-consistency-review\examples\ai-verification-matrix") "ai-verification-matrix sample"
  $WorkspaceCommonDir = Resolve-RequiredPath (Join-Path $SampleRoot "fixtures\workspace-common") "ai-verification-matrix workspace-common fixture"
  $BaselineDir = Resolve-RequiredPath (Join-Path $SampleRoot "fixtures\baseline") "ai-verification-matrix baseline fixture"
  $HeadDir = Resolve-RequiredPath (Join-Path $SampleRoot "fixtures\head") "ai-verification-matrix head fixture"
  $GitCommand = Resolve-CommandPath "git"

  Copy-DirectoryContents $WorkspaceCommonDir $WorkspaceDir
  Copy-DirectoryContents $BaselineDir $WorkspaceDir
  Invoke-CheckedCommand (Resolve-CommandPath "git") @("init", "-b", "main") $WorkspaceDir
  Invoke-CheckedCommand $GitCommand @("config", "user.email", "bob-fixture@example.local") $WorkspaceDir
  Invoke-CheckedCommand $GitCommand @("config", "user.name", "Bob Fixture") $WorkspaceDir
  Invoke-CheckedCommand $GitCommand @("add", ".") $WorkspaceDir
  Invoke-CheckedCommand $GitCommand @("commit", "-m", "baseline") $WorkspaceDir
  Invoke-CheckedCommand $GitCommand @("switch", "-c", "feature/ai-verification-matrix") $WorkspaceDir
  Copy-DirectoryContents $HeadDir $WorkspaceDir
  Invoke-CheckedCommand $GitCommand @("add", ".") $WorkspaceDir
  Invoke-CheckedCommand $GitCommand @("commit", "-m", "ai verification matrix head") $WorkspaceDir
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

New-Item -ItemType Directory -Force -Path $UserDataDir, $ExtensionsDir, $WorkspaceDir, $WorkflowDir | Out-Null
if ($Sample -eq "ai-verification-matrix") {
  Initialize-AiVerificationMatrixWorkspace $RepoRoot $WorkspaceDir
} else {
  Initialize-SimpleTimeoutWorkspace $RepoRoot $WorkspaceDir
}
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
Write-Host "Sample: $Sample"
Write-Host "Bob extensionDevelopmentPath: $BobExtensionPath"
Write-Host "Installed extensions:"
& $CodeCommand --user-data-dir $UserDataDir --extensions-dir $ExtensionsDir --list-extensions --show-versions

if ($NoLaunch) {
  Write-Host "Launch command:"
  Write-Host "$CodeCommand $($launchArgs -join ' ')"
  return
}

Start-Process -FilePath $CodeCommand -ArgumentList $launchArgs
