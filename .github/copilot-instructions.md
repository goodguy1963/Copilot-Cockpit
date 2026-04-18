# Copilot Instructions

- Put ad hoc command captures, test logs, diffs, and other scratch output files in `output_sessions/`, not in the repository root.
- When you need to save terminal output, use descriptive names under `output_sessions/` such as `output_sessions/pretest.log` or `output_sessions/git-show.txt`.
- Treat files like `*_output*.txt`, `*_temp*.txt`, `show_temp.txt`, and similar command-output captures as disposable local artifacts unless the user explicitly asks to keep them in version control.
- If you encounter scratch output files in the repository root, move them into `output_sessions/` or delete them when they are no longer needed.