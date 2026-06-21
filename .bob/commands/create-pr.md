---
description: "プルリクエストを作成"
---

<!--
Static reproduction note:
The built-in `create-pr` command is generated dynamically by Bob at runtime from the VS Code/Git state. This portable .bob command preserves the extracted workflow but replaces runtime-injected repository, branch, and remote values with explicit discovery steps.
-->

Create a pull request by following the below steps in order:

1. Switch to `<mode_slug>advanced</mode_slug>` mode using the `switch_mode` tool.

2. Verify that the current VS Code workspace contains a Git repository. If no Git repository is available, inform the user that pull request creation is not possible yet and ask them to open or initialize a Git repository.

3. Determine the repository root to use as the working directory. If multiple Git repositories are detected in the workspace, ask the user which repository to create the PR in. Once selected, use that repository path as the `<cwd>` parameter in all subsequent PR-related tool calls.

4. Determine the base branch. Prefer likely default branches such as `main`, `master`, `develop`, `dev`, or the repository default branch. If multiple likely branches exist, ask the user which branch they want to push into. Present at most three likely branch options.

5. Determine the remote repository. If exactly one remote exists, use it. If multiple remotes exist, ask the user which remote to use. Present at most three likely remote options.

6. Determine the current head branch. If needed, run `git rev-parse --abbrev-ref HEAD` in the repository root.

7. Use the `generate_description_from_diff` tool to generate a pull request description. Use the selected repository root as the `cwd` parameter.

8. Generate a meaningful pull request title from the diff and intent of the change.

9. Ask the user whether they want to edit the PR description in an editor tab before creating the pull request. Present exactly these options:
   - `No, create the PR now`
   - `Yes, let me edit it`
   - `Cancel creating the PR`

10. If the user chooses `No, create the PR now`, proceed directly to creating the pull request with the generated description.

11. If the user wants to edit the PR description, use the `create_temporary_file` tool with action `create_editor` to create a temporary file for editing. After creating the editor tab, ask the user to tell you when they are done editing. When they say they are done, use `create_temporary_file` with action `get_content` to retrieve the edited content.

12. If the user cancels, acknowledge the decision and end the task without creating a pull request.

13. Use the `create_pull_request` tool to create the pull request. Use the selected repository root as the `cwd` parameter.

14. Use the `attempt_completion` tool to end the task and show the pull request URL on its own line. Do not append a period at the end of the URL.

15. After creating the pull request, use the `create_temporary_file` tool with action `cleanup` to clean up the temporary file.
