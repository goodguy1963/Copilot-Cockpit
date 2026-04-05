=============================================================================
                    SCHEDULEMANAGER.TS DEFORK ANALYSIS
=============================================================================

CURRENT FORK STATUS (from latest-report.json):
- Path: src/scheduleManager.ts
- Total Meaningful Lines: 2,393
- Forked (Matched) Meaningful Lines: 742 (31%)
- Retention Percentage: 31%
- Source: 726 lines from upstream src/scheduleManager.ts + 16 from src/extension.ts
- Total Blocks: 73 forked structural blocks

=============================================================================
(1) EXACT OVERLAP BLOCK RANGES FOR SCHEDULEMANAGER.TS:
=============================================================================

TOP 5 LARGEST BLOCKS RESPONSIBLE FOR OVERLAP:

1. Block "Safety: Jitter & Disclaimer" (77 raw, 42 meaningful - 54%)
   Local:    Lines 539-615   (applyJitter, checkMinimumInterval, isDisclaimerAccepted, setDisclaimerAccepted)
   Upstream: Lines 375-416   

2. Block "Task Storage Metadata" (48 raw, 35 meaningful - 72%)
   Local:    Lines 201-248   (loadMetaFromFile, loadMetaFromGlobalState, saveMetaToFile, saveMetaToGlobalState)
   Upstream: Lines 153-187   

3. Block "Task Persistence & Sync" (51 raw, 33 meaningful - 64%)
   Local:    Lines 1379-1429 (saveTasksInternal with file/globalState fallback & sync)
   Upstream: Lines 627-659   

4. Block "Scheduler Core Loop" (50 raw, 33 meaningful - 66%)
   Local:    Lines 3204-3253 (startScheduler, runSchedulerTick, stopScheduler)
   Upstream: Lines 1008-1040 

5. Block "Daily Execution Limits" (47 raw, 30 meaningful - 63%)
   Local:    Lines 298-344   (loadDailyExecCount, incrementDailyExecCountInMemory)
   Upstream: Lines 225-254   

COMPLETE LIST OF ALL 73 BLOCKS (sorted by impact):
' | Write-Host

@'
import json

jsonPath = r"f:\HBG Webserver\extensions\source-scheduler.worktrees\copilot-worktree-2026-04-05T13-19-57\analysis_tools\output\latest-report.json"
with open(jsonPath) as f:
    data = json.load(f)

files = [f for f in data.get("fileResults",[]) if "scheduleManager" in f.get("path","")]
if files:
    file_result = files[0]
    blocks = file_result.get("blocks", [])
    sched_blocks = [(b, i+1) for i, b in enumerate([b for b in blocks if b.get("sourcePath") == "src/scheduleManager.ts"])]
    
    sorted_blocks = sorted(sched_blocks, key=lambda x: x[0].get("matchedMeaningfulLines", 0), reverse=True)
    
    for b, idx in sorted_blocks:
        raw_size = b["localRange"]["end"] - b["localRange"]["start"] + 1
        meaningful = b.get("matchedMeaningfulLines", 0)
        print(f"{idx:2d}. Lines {b['localRange']['start']:4d}-{b['localRange']['end']:4d} ({raw_size:3d} raw, {meaningful:2d} meaningful)")
