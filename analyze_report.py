import json
jsonPath = r'f:\HBG Webserver\extensions\source-scheduler.worktrees\copilot-worktree-2026-04-05T13-19-57\analysis_tools\output\latest-report.json'
with open(jsonPath) as f:
    data = json.load(f)

files = [f for f in data.get('fileResults',[]) if 'scheduleManager' in f.get('path','')]
if not files:
    print("No scheduleManager found")
else:
    file_result = files[0]
    print(f"=== SUMMARY ===")
    print(f"Path: {file_result['path']}")
    print(f"Matched Meaningful Lines: {file_result['matchedMeaningfulLines']}")
    print(f"Total Meaningful Lines: {file_result['totalMeaningfulLines']}")
    print(f"Retention Percent: {file_result['retentionPercent']}")
    print()
    
    blocks = file_result.get('blocks', [])
    sched_blocks = [b for b in blocks if b.get('sourcePath') == 'src/scheduleManager.ts']
    print(f"Total blocks from src/scheduleManager.ts: {len(sched_blocks)}")
    print()
    
    sorted_blocks = sorted(sched_blocks, key=lambda x: x.get('matchedMeaningfulLines', 0), reverse=True)
    print("=== TOP 10 LARGEST BLOCKS ===")
    for i, b in enumerate(sorted_blocks[:10]):
        raw_size = b['localRange']['end'] - b['localRange']['start'] + 1
        print(f"{i+1}. Lines {b['localRange']['start']}-{b['localRange']['end']} (raw: {raw_size}, meaningful: {b.get('matchedMeaningfulLines', 0)})")
