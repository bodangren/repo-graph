# Design Definition

## Scope

This project is **CLI-first backend tooling**. There is no visual UI design system.

## Interface Design

- All interaction happens through command-line scripts and SQL queries.
- Output is machine-readable (JSON, SQLite, TSV) for piping and automation.
- Any downstream dashboard (e.g., React Flow visualization) consumes the JSON output; styling is the responsibility of the dashboard consumer, not this project.

## Deliberate Constraints

- No CSS, no component library, no color palette.
- No user-facing graphical interface within this repository.
- Design effort is directed at schema design, query ergonomics, and CLI DX.
