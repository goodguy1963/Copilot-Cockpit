import json

jsonPath = r"f:\HBG Webserver\extensions\source-scheduler.worktrees\copilot-worktree-2026-04-05T13-19-57\analysis_tools\output\latest-report.json"
with open(jsonPath) as f:
    data = json.load(f)

files = [f for f in data.get("fileResults",[]) if "scheduleManager" in f.get("path","")]
if files:
    file_result = files[0]
    blocks = file_result.get("blocks", [])
    
    # Focus on top 5 blocks
    top_blocks = [
        539, 201, 1379, 3204, 298
    ]
    
    print("=== TOP 5 OVERLAP BLOCKS ANALYSIS ===\n")
    for local_start in top_blocks:
        for b in blocks:
            if b["localRange"]["start"] == local_start and b.get("sourcePath") == "src/scheduleManager.ts":
                raw_size = b["localRange"]["end"] - b["localRange"]["start"] + 1
                meaningful = b.get("matchedMeaningfulLines", 0)
                print(f"Block: Lines {b['localRange']['start']}-{b['localRange']['end']}")
                print(f"  Raw size: {raw_size} lines | Meaningful: {meaningful} lines | Match %: {int(meaningful*100/(raw_size or 1))}%")
                print(f"  Upstream: Lines {b['upstreamRange']['start']}-{b['upstreamRange']['end']}")
                print()
