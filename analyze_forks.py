import json
from collections import defaultdict

jsonPath = r"f:\HBG Webserver\extensions\source-scheduler.worktrees\copilot-worktree-2026-04-05T13-19-57\analysis_tools\output\latest-report.json"
with open(jsonPath) as f:
    data = json.load(f)

# Analyze what's forked by file
files = data.get("fileResults",[])
print("=== FORK OVERVIEW BY FILE ===\n")
for file_result in files:
    if file_result.get("category") == "runtime" and file_result.get("matchedMeaningfulLines", 0) > 0:
        path = file_result.get("path", "?")
        matched = file_result.get("matchedMeaningfulLines", 0)
        total = file_result.get("totalMeaningfulLines", 0)
        pct = int(matched * 100 / (total or 1))
        if pct > 10:  # Only show significant forks
            print(f"{path}")
            print(f"  Forked lines: {matched}/{total} ({pct}%)")
            sources = file_result.get("sources", [])
            for source in sources:
                print(f"    - From: {source.get('sourcePath', '?')} ({source.get('matchedLines', 0)} lines)")
            print()
