# Product Guidelines

## Voice & Tone

- **Technical & terse.** Assume the reader is a developer. Use precise, dense language.
- Avoid filler words ("simply", "just", "very"). State facts directly.
- No emojis or marketing language in code, comments, or CLI output.
- Error messages are diagnostic, not apologetic. Say what failed, why, and how to fix it.

## Error Handling

- **Fail fast with verbose diagnostics.** Halt immediately on unrecoverable errors.
- Every error must include: what failed, the input that caused it, and the next step.
- Use exit codes consistently: `0` for success, `1` for generic error, `2` for misuse, `3` for internal error.
- Validate inputs at boundaries (file paths, JSON schema, SQL parameters) and reject bad data early.

## Documentation

- **Inline comments + README per module.** Every script and module has a top-of-file comment block explaining purpose, inputs, outputs, and usage.
- Each directory containing runnable code must have a `README.md` with: purpose, usage examples, and exit codes.
- Avoid external documentation sites. Keep docs in-repo and versioned with code.
- Comments explain *why*, not *what*. Code must be self-explanatory at the statement level.

## UX Principles

- **CLI-first.** All tools are designed for terminal use and shell piping.
- Output should be machine-readable where possible (JSON, TSV, or newline-delimited).
- Progress indicators only for long-running operations (>2s). Otherwise stay silent.
- No interactive prompts in scripts. Accept all configuration via flags or environment variables.

## Brand

- Internal tooling. No public branding requirements.
- Naming is functional and descriptive, not clever. Prefer `build-graph-db` over `graphinator`.
