# Claude Code instructions for Mizyun

Mizyun's engineering rules live in `AGENTS.md` and apply to Claude Code in full:

@AGENTS.md

## Claude Code specifics

- Project skills live in `.agents/skills/` and are exposed to Claude Code through the `.claude/skills` symlink. `qwen-task-dispatch` is retired while the local Qwen worker is paused.
- Delegate with the Agent tool following `.agents/rules/model-routing.md` (Sonnet by default, Opus for sensitive or ambiguous work, `Explore` for read-only discovery).
- Track work in GitHub Issues with `gh issue` as `AGENTS.md` describes.
