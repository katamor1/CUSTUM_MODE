# Slash command policy

This project contains portable reproductions of Bob built-in slash commands under `.bob/commands/`.

- Use `/init` to create or refresh `AGENTS.md` and mode-specific rule files.
- Use `/review [branch]` to review code changes.
- Use `/create-pr` to create a pull request. This command is a static reproduction of a dynamic built-in command, so it must discover repository, branch, and remote information at runtime.
- Do not create or modify pull requests without explicit user confirmation.
- Treat generated PR descriptions and review findings as drafts until the user confirms them.
