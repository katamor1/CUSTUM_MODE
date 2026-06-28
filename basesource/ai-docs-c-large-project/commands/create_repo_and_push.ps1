param(
  [string]$RepoName = "ai-docs-c-large-project",
  [string]$Owner = "katamor1",
  [string]$Visibility = "private"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw "GitHub CLI 'gh' が見つかりません。https://cli.github.com/ からインストールしてください。"
}

if (-not (Test-Path .git)) {
  git init
}

git add .
git commit -m "Initial AI documentation management scaffold"

gh repo create "$Owner/$RepoName" --$Visibility --source . --remote origin --push

Write-Host "Created and pushed: https://github.com/$Owner/$RepoName"
