import json
jsonPath = r"f:\HBG Webserver\extensions\source-scheduler.worktrees\copilot-worktree-2026-04-05T13-19-57\analysis_tools\output\latest-report.json"
with open(jsonPath) as f:
    data = json.load(f)

files = [f for f in data.get("fileResults",[]) if "scheduleManager" in f.get("path","")]
if files:
    file_result = files[0]
    blocks = file_result.get("blocks", [])
    sched_blocks = [b for b in blocks if b.get("sourcePath") == "src/scheduleManager.ts"]
    
    print("=== ALL 73 BLOCKS FROM SRC/SCHEDULEMANAGER.TS ===")
    print(f"Total: {len(sched_blocks)} blocks")
    print()
    
    for i, b in enumerate(sched_blocks):
        raw_size = b["localRange"]["end"] - b["localRange"]["start"] + 1
        print(f"{i+1}. Lines {b['localRange']['start']:4d}-{b['localRange']['end']:4d} (raw: {raw_size:3d}, meaningful: {b.get('matchedMeaningfulLines', 0):2d})")
