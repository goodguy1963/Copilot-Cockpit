## Plan: Deterministic Cockpit State Model

Replace the current mixed workflow model in the plugin with one deterministic, flag-driven routing model so downstream automation no longer has to infer behavior from a brittle combination of statuses, labels, and comment labels. The target design makes one explicit workflow flag the canonical source of truth for every active card: `new`, `needs-bot-review`, `needs-user-review`, `ready`, `ON-SCHEDULE-LIST`, or `FINAL-USER-CHECK`. `rejected` stops being a routing flag and remains only an archive outcome and explicit archive action.

The key simplification for this round is: `ready` should no longer mean three different things at once. Instead, `ready` means the Todo is execution-ready and is eligible for explicit draft creation into the task list. After that, the execution mode lives on the linked task, not on the card: the task may remain a draft, start immediately, or be scheduled for later. The card only moves from `ready` to `ON-SCHEDULE-LIST` when that linked task is enabled or otherwise leaves draft mode and becomes an active execution artifact.

The implementation should follow a finite-state-machine style migration rather than a large one-shot refactor. External guidance on state-model migrations consistently points to five controls that matter here: one canonical state field, deterministic normalization rules for legacy records, additive API compatibility during rollout, idempotent transition functions, and a staged cutover with observability plus rollback. This plan sharpens the plugin work around those controls.

**Target state model**
- Canonical active workflow state lives in one explicit workflow flag on each non-archived card.
- Labels remain user categorization only and must never drive routing.
- Comment bodies may provide execution details such as `Cron: ...`, but comments and comment labels must not define routing state.
- `status` becomes structural lifecycle metadata only. It may remain for persistence compatibility and archive semantics, but it must stop being the source of truth for active workflow routing.
- Archived cards must rely on `archived` plus `archiveOutcome`, not an active workflow flag, to communicate terminal state.
- `ready` means the card is approved for explicit draft creation into the task list.
- The linked task becomes the canonical execution artifact for run-now, schedule-later, or draft-only handling.
- `ON-SCHEDULE-LIST` means the linked task has left pure draft mode and is now scheduled, enabled for execution, or already running.

**Proposed transition table**
- `new` -> `needs-bot-review`: research or intake produced a planning item that still needs system synthesis.
- `new` -> `needs-user-review`: the system can already explain options, but the user must clarify or choose.
- `new` -> `ready`: the next action is concrete enough that the user can explicitly create the linked Todo Task Draft.
- `needs-bot-review` -> `needs-user-review`: the plugin or dispatcher produced a plan or clarification request and is now waiting on the user.
- `needs-bot-review` -> `ready`: remove this as the default path; planning should usually return to `needs-user-review`, not skip user review.
- `needs-user-review` -> `ready`: the user gave the final direction needed to allow explicit draft creation or refresh.
- `ready` -> `ON-SCHEDULE-LIST`: the linked Todo Task Draft is no longer just a draft; it is now running immediately or is scheduled for later execution.
- `ON-SCHEDULE-LIST` -> `FINAL-USER-CHECK`: execution finished and the user must accept, redirect, or reopen the work.
- `FINAL-USER-CHECK` -> archive completed: the user accepts and the card is finalized successfully.
- `FINAL-USER-CHECK` -> `needs-user-review`: the user wants to review or refine the next step manually.
- `FINAL-USER-CHECK` -> `needs-bot-review`: the user wants a fresh planning pass.
- `FINAL-USER-CHECK` -> `ready`: only when the latest comment is a user comment and the user wants to return directly to task preparation.
- Any active state -> archive rejected: the user explicitly rejects the item or the item is archived as rejected through `cockpit_reject_todo`.

**State invariants**
- Exactly one workflow flag from the canonical active set may exist on a non-archived card at a time.
- `scheduled-task` remains a label, not a flag.
- `ready` does not by itself require a linked `taskId`; draft creation happens only on explicit user action.
- `taskId` with `ready` means the linked artifact is still a Todo Task Draft and has not yet been enabled.
- `taskId` with `ON-SCHEDULE-LIST` means the linked artifact is no longer just a draft; it is scheduled, enabled, or running.
- `taskId` without either `ready` or `ON-SCHEDULE-LIST` should be treated as stale-link drift and repaired.
- `FINAL-USER-CHECK` is a live flag, but `final-user-check` remains invalid as a section name.
- Routing code must read workflow flags only. Labels, comment labels, and `status` may be preserved for compatibility but must not decide routing.

**Detailed action semantics by workflow flag**

This section defines the exact operational behavior the plugin and any downstream dispatcher should follow when a card has a given canonical workflow flag. The goal is to remove guesswork. For each flag, the plan names: who usually sets it, what the system is allowed to do automatically, what must not happen, and what the expected next state is.

`new`
- Usual setter: research intake, manual card creation, seeded future work, or user-created idea cards.
- Meaning: the item exists, but there is not yet enough approved structure to schedule or execute work.
- Required system behavior:
	- do not create a scheduler task automatically
	- do not treat labels or comments as implicit approval
	- allow comments, labels, section moves, and normal editing without changing execution state
	- allow explicit transition into `needs-bot-review`, `needs-user-review`, or `ready` when a deterministic rule or user action supports it
- Allowed automatic transitions:
	- `new` -> `needs-bot-review` when the plugin or dispatcher decides planning help is required
	- `new` -> `needs-user-review` when the plugin already has options or a clarification request ready for the user
	- `new` -> `ready` only when the execution path is already concrete enough
- Forbidden behavior:
	- no linked `taskId`
	- no scheduler creation
	- no automatic `ON-SCHEDULE-LIST`

`needs-bot-review`
- Usual setter: user, planning intake, or a rule that says the system must synthesize a plan before the user can approve execution.
- Meaning: the system must think, plan, clarify scope, or propose implementation options before execution can proceed.
- Required system behavior:
	- inspect the latest actionable user comment and the card description
	- produce planning output only, not execution
	- treat this as a planning-session flow, not as a scheduler-task creation flow
	- when a planning session finishes, the source Todo must be updated deterministically before the session is considered complete
	- write back one detailed planning comment to the Todo so the result is searchable and recoverable from the card history
	- that planning comment should be structured enough to be reused later, for example covering scope, assumptions, proposed steps, open questions, and recommended next flag
	- add at most one planning or clarification comment per deterministic pass unless the user asks for more
	- if the input is vague, write one clarification comment and move the card to `needs-user-review`
	- if the input is sufficiently concrete, write a compact planning or options comment and move to `needs-user-review` by default
- Allowed automatic transitions:
	- `needs-bot-review` -> `needs-bot-review` is allowed only for explicit chained planning work; it must still append or refresh a real planning comment rather than ending silently
	- `needs-bot-review` -> `needs-user-review` after the system has written the planning/clarification result and is now waiting for the user
	- `needs-bot-review` -> `ready` should not be the default; only allow it if a future explicit product override is introduced
- Forbidden behavior:
	- no scheduler task creation
	- no `taskId` assignment
	- no implicit approval from labels or comment labels
	- no silent completion of a planning session without a written Todo comment

`needs-user-review`
- Usual setter: the system after planning, the user when they want to pause and decide later, or closeout flows when human input is required before continuing.
- Meaning: the next blocking action belongs to the user. The system should wait for explicit instruction.
- Required system behavior:
	- preserve the card as active and editable
	- allow the user to comment, relabel, reprioritize, or change section without scheduling work
	- treat the next actionable user comment or explicit UI action as the source for the next transition
	- if the user clarifies enough, move to `ready`
	- if the user broadens or resets the scope, the card may move back to `new`
- Allowed automatic transitions:
	- none without new explicit user input, except deterministic normalization or stale-link cleanup that should not change the review meaning
- Forbidden behavior:
	- no scheduler creation just because enough comments now exist
	- no automatic jump to `ON-SCHEDULE-LIST`

`ready`
- Usual setter: user approval, normalized legacy `go`, or deterministic planner output that fully resolves execution ambiguity.
- Meaning: the execution path is clear enough that the user may explicitly create or refresh a linked Todo Task Draft.
- Required system behavior:
	- this is the first state where task creation is allowed
	- derive execution intent from the Todo as a whole, with the latest actionable user comment treated as the primary override when it adds newer instructions
	- keep the broader card context available by using the Todo title, description, and recent comment history as supporting context for task generation
	- do not create a draft automatically when the card merely enters `ready`
	- when the user explicitly triggers draft creation, verify whether a linked `taskId` already exists before creating a new task
	- if no valid linked task exists, create the downstream Todo Task Draft using the existing Todo-to-task prompt synthesis path
	- if a valid linked task already exists and is still a draft, reuse it instead of recreating it
	- if the linked task exists but no longer matches the Todo intent, update it deterministically while it is still draft-only
	- when creating or reusing the linked draft, keep the source card as the planning record and auto-fill the linked-task relationship
	- leave the card in `ready` while the linked task remains a draft-only artifact
	- add one compact handoff comment only when a linked draft was explicitly created or materially refreshed
- Allowed automatic transitions:
	- no state change is required merely because the draft was created; the card stays `ready` while the task remains a draft
	- `ready` -> `ON-SCHEDULE-LIST` only after the linked draft is converted into immediate execution or later scheduled execution
- Forbidden behavior:
	- no duplicate task creation if `taskId` already points to a valid matching draft
	- no automatic draft creation on flag change alone
	- no immediate run or scheduling side effect unless the user or dispatcher explicitly chooses an execution mode on the task side

`ON-SCHEDULE-LIST`
- Usual setter: plugin or dispatcher after task draft creation, schedule creation, or successful linked-task verification.
- Meaning: the linked Todo Task Draft has become an active execution artifact. It is now scheduled for later execution, enabled for immediate run, or already running.
- Required system behavior:
	- verify `taskId` first on every operational pass
	- if the linked task exists and still matches intent, keep and reuse it
	- if the linked task is stale or missing, either recreate it deterministically or clear the stale `taskId`, depending on the card state and requested action
	- preserve the source card as the coordination hub while the task exists
	- keep `scheduled-task` as a label if that remains the chosen downstream categorization label
	- when execution finishes successfully, remove or observe removal of the linked one-time task and update the source Todo automatically toward `FINAL-USER-CHECK`
	- when execution fails or the task is deleted unexpectedly, update the source Todo deterministically rather than leaving a stale planning/execution split
- Allowed automatic transitions:
	- `ON-SCHEDULE-LIST` -> `FINAL-USER-CHECK` when execution is complete and the user must review the result
	- `ON-SCHEDULE-LIST` -> `needs-user-review` only for failure, missing-intent, or cleanup cases where final-user-check is not the right semantic state
- Forbidden behavior:
	- no silent stale `taskId`
	- no duplicate schedule comments on repeated verification passes
	- no second task creation while an existing linked task is still valid

`FINAL-USER-CHECK`
- Usual setter: plugin or dispatcher after implementation/execution finished and the result is ready for human acceptance.
- Meaning: the work is done for now, and this flag does nothing except wait for the user to decide what happens next.
- Required system behavior:
	- keep the card active until the user explicitly accepts or redirects it
	- clear stale linked task state before or when entering this flag if the execution artifact is already gone
	- add one compact closeout comment summarizing changes, validation, and remaining follow-up when appropriate
	- allow the user to decide the next step manually; valid exits are archive completed, `needs-user-review`, `needs-bot-review`, or `ready` when the latest comment is a user comment
	- do not allow `new` as a direct exit from `FINAL-USER-CHECK`
- Allowed automatic transitions:
	- none without an explicit user action, except stale-link cleanup and deterministic closeout repair
- Forbidden behavior:
	- no auto-finalization
	- no automatic flag flip out of `FINAL-USER-CHECK`
	- no reopening into execution states without a user action

Archive rejected
- Usual setter: explicit user rejection, delete/reject action, or a deterministic reject/archive path.
- Meaning: the item is terminally archived as rejected. It is not an active routing state.
- Required system behavior:
	- use `archived = true` plus `archiveOutcome = rejected`
	- clear active workflow flag state
	- clear or repair stale linked task state if needed
	- add one rejection/archive comment only if the action path normally records system-event comments
- Forbidden behavior:
	- no live `rejected` workflow flag on active cards
	- no routing based on `rejected` after this migration

**Action ownership and trigger model**
- User-set flags:
	- `new`
	- `needs-user-review`
	- `ready`
	- explicit draft creation while in `ready`
	- rejection/archive actions
- System-set flags:
	- `needs-bot-review`
	- `ON-SCHEDULE-LIST`
	- `FINAL-USER-CHECK`
- Shared transitions:
	- `new` can be set by either side depending on whether the card is newly created or intentionally reset
	- draft creation from `ready` is an explicit user-triggered action, while the later `ready` -> `ON-SCHEDULE-LIST` flip is plugin-managed once the linked task is enabled

**Operational rules for repeated passes**
- Re-running the dispatcher or plugin logic on the same card and flag must be safe.
- If the card is already in the correct state and the linked task is still valid, the pass should be a no-op except for optional observability logs.
- If the card is already in the correct state but the task link is stale, repair only the stale link problem; do not restage the whole workflow.
- Comments added by the system should be deduplicated by intent so repeated passes do not flood the thread.

**What this means for the old flags**
- `go` and `GO` become compatibility inputs only. They should normalize to `ready` immediately.
- `rejected` and `abgelehnt` become compatibility rejection inputs only. They should route to archive rejection behavior, never persist as a live active workflow flag.
- `needs-bot-review`, `needs-user-review`, `ON-SCHEDULE-LIST`, and `FINAL-USER-CHECK` remain live workflow flags.

**Workflow outcome matrix: what actually happens**

This section defines the concrete action taken when the system encounters a card in a given state and enough information is present to move forward. The key distinction is not just state, but outcome type:
- planning only
- archive only
- create or reuse linked Todo Task Draft
- start immediate session from the linked task
- schedule later execution from the linked task

The plan should treat those as explicit workflow lanes instead of leaving them implicit.

**Lane 1: planning only**
- Entry states:
	- `new`
	- `needs-bot-review`
	- `needs-user-review`
- Purpose:
	- clarify, synthesize, scope, or wait for the user
- Allowed artifacts:
	- comments
	- labels
	- section moves
	- one active workflow flag transition
- Required closeout behavior for planning sessions:
	- when a `needs-bot-review` planning run completes, it must write one detailed plan comment back onto the Todo before the flow ends
	- that comment should be the durable record of the planning result so later dispatcher passes and the user can find it directly on the card
	- after writing the planning comment, the card should move to `needs-user-review` by default
- Forbidden artifacts:
	- no scheduler task
	- no `taskId`
	- no immediate execution session
- Exit conditions:
	- move to `ready` only when the work is concrete enough to execute or schedule without more planning ambiguity

**Lane 2: archive only**
- Entry triggers:
	- explicit user rejection
	- delete/reject flow
	- final acceptance after `FINAL-USER-CHECK`
- Outcomes:
	- archive rejected
	- archive completed successfully
- Required actions:
	- set `archived = true`
	- set the correct `archiveOutcome`
	- clear active workflow flag state
	- clear stale linked `taskId` if the linked task no longer exists
	- keep one compact system-event comment if the path normally logs transitions
- Forbidden actions:
	- no live workflow flag after archival
	- no scheduler creation or scheduler recreation during archive-only paths

**Lane 3: create or reuse linked Todo Task Draft**
- Entry trigger:
	- card is `ready`
	- user explicitly chooses to create or refresh the draft task
- Typical examples:
	- user approved the work and wants it prepared in the task list
	- the system needs a concrete execution artifact that can later be run immediately or scheduled
	- the card should appear in Todo Task Drafts as the canonical downstream representation of `ready`
- Required actions:
	- create or reuse a linked task with `oneTime: true`
	- default the task to draft mode by keeping it disabled or otherwise not yet committed to execution
	- use the Todo-derived prompt synthesis path
	- build that draft from the Todo title, description, latest actionable user comment, and relevant recent comment context rather than requiring the chat session to restate the plan manually
	- set or preserve `taskId`
	- keep the card in `ready` while the task is still only a draft
	- add or preserve the `scheduled-task` label if that remains the chosen categorization signal
	- add one compact handoff comment only if a new task was created or materially relinked
- Resulting state:
	- the card remains active under `ready`
	- the downstream task surfaces in Todo Task Drafts in the task list
- Forbidden actions:
	- do not immediately run the task
	- do not create a duplicate task if a valid linked draft already exists

**Lane 4: start immediate session from the linked task**
- Entry trigger:
	- card is `ready`
	- a linked Todo Task Draft already exists or is created first in the same deterministic flow
	- user intent implies run now, start now, or immediate execution by default
- Recommended default policy:
	- `ready` should first materialize the linked draft; after that, immediate execution is the default execution mode if no future schedule is requested and the user did not explicitly ask to leave it as draft-only
- Required actions:
	- verify whether a valid linked draft already exists; if not, create it first
	- convert the linked draft into immediate execution by enabling or launching the task/session path
	- transition the card to `ON-SCHEDULE-LIST` automatically as soon as the linked draft enters active execution handling
	- that state update should be performed by plugin-managed task lifecycle logic, not by the chat session manually deciding to flip the Todo flag
	- record exactly one compact session-start or schedule-start comment
- Resulting state:
	- card moves from `ready` to `ON-SCHEDULE-LIST`
	- task/session link exists and is no longer draft-only
- Forbidden actions:
	- no second immediate launch on repeated passes
	- no remaining `ready` flag once the linked draft has become a live execution artifact

**Lane 5: schedule later execution from the linked task**
- Entry trigger:
	- card is `ready`
	- a linked Todo Task Draft already exists or is created first in the same deterministic flow
	- the user or latest actionable instruction provides a future time, date, or cron intent
- Required actions:
	- verify whether a valid linked draft already exists; if not, create it first
	- determine or validate the future run slot
	- use scheduler conflict rules for execution slots
	- create or update one linked one-time task with the chosen future run schedule
	- set or preserve `taskId`
	- move the card to `ON-SCHEDULE-LIST` automatically when the linked draft is committed into the real scheduled execution window
	- that update should happen deterministically in plugin task lifecycle handling so the chat session does not need to care about the routing-state flip
	- add one compact schedule comment including the resulting scheduler identity or timing when that is useful
- Resulting state:
	- card remains active under `ON-SCHEDULE-LIST`
	- downstream task is scheduled for later execution rather than immediate start
- Forbidden actions:
	- no immediate session start when the user explicitly asked for later execution
	- no duplicate scheduler creation on repeated passes if the linked task already matches intent

**Detailed decision rules for `ready`**

When a card becomes `ready`, no task should be created yet. The next step is explicit:

1. User explicitly creates or refreshes one linked Todo Task Draft.
	 - This is the deterministic entry into the task list.
	 - The resulting task should appear in Todo Task Drafts and auto-fill the Todo's linked-task relationship.

After that, choose exactly one execution mode on the task side:

2. Leave as draft only
	 - Choose this when the work should be prepared but not started yet.
	 - The card stays `ready` while the linked task remains a draft.

3. Start immediate session
	 - Choose this when the user intent means execute now.
	 - The linked draft is converted into a live execution artifact and the card moves to `ON-SCHEDULE-LIST`.

4. Schedule later execution
	 - Choose this when the latest actionable instruction includes a future date, cron, or delayed-start request.
	 - The linked draft is updated with the future schedule and the card moves to `ON-SCHEDULE-LIST`.

`ready` is therefore the approval and draft-preparation state, not an automatic task-creation state.

**How `ON-SCHEDULE-LIST` should be interpreted**
- `ON-SCHEDULE-LIST` means the linked Todo Task Draft has already been committed to execution.
- That artifact may be one of three things:
	- an immediate live execution session that already started
	- a future scheduled one-time task
	- a task that is enabled and waiting to run even if it was originally created as a draft
- The shared semantics are:
	- the card has left draft-only execution preparation mode
	- the system must manage `taskId` lifecycle deterministically
	- entering the execution window must trigger this state change automatically through plugin-managed lifecycle logic rather than relying on the chat session to remember it
	- repeated passes must verify and reuse the artifact instead of recreating it
	- completion or disappearance of that artifact must sync back into the source Todo

**When things should just be archived**
- Archive rejected:
	- explicit reject/delete path
	- user says no, stop, reject, or equivalent
	- legacy `rejected` or `abgelehnt` input normalized into archive rejection behavior
- Archive completed successfully:
	- card is in `FINAL-USER-CHECK`
	- user explicitly accepts the result
- In both archive paths:
	- no new task should be created
	- no execution should be started
	- stale task links should be cleared, not revived unless the user explicitly requests reopening

**When things should go to tasks**
- A card should go to tasks only from `ready`.
- The first task outcome from `ready` is explicit user draft creation:
	- create or reuse one linked Todo Task Draft
- After that draft exists, there are three valid task-side execution modes:
	- keep as draft only
	- immediate execution session
	- scheduled later execution
- The task draft and later execution artifact should be derived from the Todo plus its latest actionable comment, with recent comment history preserved as supporting context.
- `new`, `needs-bot-review`, and `needs-user-review` must never create tasks automatically.
- `FINAL-USER-CHECK` must never create new tasks automatically; it may only lead to acceptance or explicit user-chosen follow-up states.

**When things should start immediately versus later**
- Start immediately:
	- card is `ready`
	- linked Todo Task Draft exists or is created first
	- no explicit future scheduling instruction exists
	- user intent is execution now or the product default after draft creation is immediate launch
	- once the linked draft enters that immediate execution path, the plugin should flip the Todo to `ON-SCHEDULE-LIST` automatically
- Schedule later:
	- card is `ready`
	- linked Todo Task Draft exists or is created first
	- the latest actionable instruction explicitly requests later timing, or a cron/date exists
	- once the linked draft is committed into the scheduled execution window, the plugin should flip the Todo to `ON-SCHEDULE-LIST` automatically
- Create draft only:
	- card is `ready`
	- linked Todo Task Draft exists
	- the intent is to materialize the execution artifact without starting it yet

**Closeout behavior after execution**
- Immediate session or scheduled task finishes:
	- clear or observe clearing of the linked one-time task as appropriate
	- move card from `ON-SCHEDULE-LIST` to `FINAL-USER-CHECK`
	- add one compact closeout summary comment
- Planning session finishes from `needs-bot-review`:
	- do not move to `FINAL-USER-CHECK`
	- do not keep a scheduler `taskId`
	- write one detailed plan comment back to the source Todo
	- move to `needs-user-review` by default
- If the linked one-time task self-deletes after success:
	- the plugin should detect that disappearance through linked-task lifecycle sync or tombstone-aware task reads
	- the source Todo should still be updated deterministically rather than being left in `ON-SCHEDULE-LIST`
- User then decides:
	- accept -> archive completed
	- wants manual follow-up review -> `needs-user-review`
	- wants a fresh planning pass -> `needs-bot-review`
	- wants direct return to task preparation -> `ready`, but only when the latest comment is a user comment

**Recommended product default**
- entering `ready` does not auto-create a task draft
- explicit draft creation while in `ready` = create or reuse linked Todo Task Draft
- after the draft exists, no explicit date/cron/delay request and the user enables the task = start immediately by default
- explicit date/cron/delay request = schedule later
- explicit prepare-but-don't-run intent = keep as task draft only
- `ON-SCHEDULE-LIST` = linked task has left draft-only mode and must now be managed as an active execution artifact
- `needs-bot-review` = run a planning session that must write a detailed searchable plan comment back into the Todo before handing off to the next flag
- `FINAL-USER-CHECK` = pure waiting state for explicit user decision
- valid manual exits from `FINAL-USER-CHECK` = archive completed, `needs-user-review`, `needs-bot-review`, or context-qualified `ready`

**Strict task lifecycle table**

This table defines the deterministic mapping between linked task state and Todo state so chat sessions do not have to manage routing flags themselves.

| Linked task state | How it happens | Required Todo flag | Required Todo update |
| --- | --- | --- | --- |
| No linked task | Card is approved but no draft was created yet | `ready` | No `taskId` required; wait for explicit draft creation |
| Draft-only linked task | User created or refreshed the Todo Task Draft, but it is still disabled | `ready` | Persist `taskId`; keep card in `ready`; update draft content from Todo + latest actionable comment context |
| Enabled one-time task | User enabled the draft for immediate or scheduled execution | `ON-SCHEDULE-LIST` | Flip from `ready` to `ON-SCHEDULE-LIST` automatically; keep `taskId`; add one compact schedule/start comment if needed |
| Scheduled future one-time task | Draft is enabled and has a future schedule | `ON-SCHEDULE-LIST` | Keep `ON-SCHEDULE-LIST`; treat scheduling itself as execution commitment |
| Running task/session | Immediate run started or scheduled run entered execution | `ON-SCHEDULE-LIST` | Keep `ON-SCHEDULE-LIST`; reuse existing `taskId`; no duplicate lifecycle comments |
| Finished successfully | One-time task completed or self-deleted after success | `FINAL-USER-CHECK` | Clear stale `taskId` if needed; add closeout summary comment; wait for user decision |
| Failed execution | Linked execution failed or stopped unexpectedly | `needs-user-review` | Clear or preserve `taskId` based on real task state; add one failure summary comment; do not auto-retry |
| Deleted stale task | Task was removed before completion and no longer exists | `needs-user-review` | Clear stale `taskId`; explain loss of execution artifact in one comment |

**User decisions from `FINAL-USER-CHECK`**

- Accept result:
	- archive completed successfully
- Wants follow-up planning:
	- set `needs-bot-review`
- Wants more execution work:
	- set `needs-user-review`, or set `ready` only when the latest comment is a user comment and the user wants direct return to draft preparation

- Invalid direct exit:
	- do not use `new` directly from `FINAL-USER-CHECK`

`FINAL-USER-CHECK` itself should not encode a default automatic return path.

**Migration strategy**
1. Phase 0: introduce the canonical workflow-flag abstraction without changing external behavior yet. Add helper functions that read and write the canonical active workflow flag while still mirroring legacy semantics where needed.
2. Phase 1: implement shadow normalization on board load. Legacy records continue to behave as they do today, but the plugin computes the canonical workflow flag and logs normalization mismatches for inspection.
3. Phase 2: dual-write compatibility. Mutation paths write both the canonical workflow flag and the legacy representation. Reads for routing still use the legacy path by default, but reconciliation logs compare old and new outcomes.
4. Phase 3: flip routing to canonical flag reads. Legacy status and compatibility aliases remain accepted on input, but they are normalized immediately and no longer drive routing.
5. Phase 4: deprecate legacy routing semantics in docs, prompts, and tests. Keep input normalization for one compatibility window before removing or downgrading it further.

**Feature-flag rollout controls**
- Add a temporary extension setting or internal rollout constant such as `deterministicCockpitStateMode` with states like `off`, `shadow`, `dual-write`, and `canonical-primary`.
- `shadow`: compute canonical flag, keep legacy read/write behavior, log divergences only.
- `dual-write`: write canonical flag plus legacy state together.
- `canonical-primary`: route and display from canonical flag first, with legacy fallback only for repair paths.
- Keep a `legacyFallbackOnError` circuit breaker so routing can fall back to old semantics quickly if canonical reads regress during rollout.

**Deterministic normalization rules**
- Normalize `go` or `GO` to `ready`.
- Normalize legacy `status = ready` to the `ready` workflow flag.
- Normalize `abgelehnt` or `rejected` routing signals into archive rejection behavior, not a live routing flag.
- Normalize cards with a valid linked `taskId` toward `ready` if the linked task is still draft-only, and toward `ON-SCHEDULE-LIST` only if the linked task is enabled, scheduled, or running.
- If a record is contradictory, for example archived but still carrying an active workflow flag, prefer archive truth and clear active workflow state.
- If a record cannot be normalized without guessing, keep the legacy data intact, mark the mismatch in logs, and leave the item on the legacy compatibility path until a deterministic rule is defined.

**Idempotent transition rules**
- Centralize active workflow transitions in helper functions rather than letting each action handler rewrite flags ad hoc.
- Every transition helper should validate the source state, compute the target state deterministically, and return the same result if replayed.
- Side effects such as schedule comments, linked task creation, and closeout comments should happen after the transition decision is made and should be guarded against duplication.
- Where practical, transition helpers should accept an explicit idempotency context so rerunning the same approval or closeout action does not create duplicate comments or duplicate flag swaps.

**Implementation steps**
1. Phase 1: define the canonical plugin workflow state model in `f:\HBG Webserver\extensions\source-scheduler\src\types.ts`, `f:\HBG Webserver\extensions\source-scheduler\src\cockpitBoard.ts`, and `f:\HBG Webserver\extensions\source-scheduler\src\cockpitRouting.ts`. Add a canonical workflow-flag concept and stop treating `status` as the active routing source.
2. Introduce and normalize the target flag set in `src/cockpitBoard.ts`: `new`, `needs-bot-review`, `needs-user-review`, `ready`, `ON-SCHEDULE-LIST`, and `FINAL-USER-CHECK`. Remove `go` and `rejected` from the default system flag seeds as first-class live semantics, but keep compatibility aliases long enough to migrate existing boards.
3. Redefine `CockpitTodoStatus` in `src/types.ts` and the corresponding normalization paths in `src/cockpitBoard.ts` so `status` becomes lifecycle metadata rather than active workflow state. Preserve `completed` and archive-related information for terminal and archive semantics.
4. Add canonical state helpers in `src/cockpitBoard.ts` or a focused helper module. These should expose read, write, normalize, and validate operations for the canonical active workflow flag and should become the only allowed path for workflow-flag mutation.
5. Phase 2: update board mutation behavior in `f:\HBG Webserver\extensions\source-scheduler\src\cockpitBoardManager.ts`. `approveTodoInBoard` should stop writing `status = "ready"` and instead set the `ready` flag. Closeout and restore flows should preserve the new deterministic progression: `ready` means execution is clear and linked to one Todo Task Draft, `ON-SCHEDULE-LIST` means that linked task has moved beyond draft-only mode into active execution handling, and `FINAL-USER-CHECK` means implementation finished and the user must accept or redirect the work.
6. Add a board-load migration layer in `src/cockpitBoard.ts` and any helper normalization used by `src/cockpitBoardManager.ts` so old data is upgraded deterministically. Shadow-mode logging should record how many records normalize from `go`, legacy `status = ready`, legacy scheduled-state combinations, and contradictory terminal states.
7. Phase 3: narrow routing to deterministic flag inputs in `f:\HBG Webserver\extensions\source-scheduler\src\cockpitRouting.ts`. Replace the current signal matching across labels, flags, and actionable comment labels with workflow-flag-first routing only. Keep latest actionable user comments for execution instructions and cron overrides, but stop treating comment labels or card labels as routing sources.
8. Update the MCP contract in `f:\HBG Webserver\extensions\source-scheduler\src\server.ts` so tool descriptions, schemas, and dispatcher-oriented language reflect the new model. `cockpit_list_routing_cards` should describe canonical workflow-flag routing and the new defaults; `cockpit_create_todo`, `cockpit_update_todo`, `cockpit_approve_todo`, `cockpit_closeout_todo`, and `cockpit_reject_todo` should accept legacy compatibility inputs during rollout but normalize them on write.
9. Phase 4: update the task handoff behavior that connects Todo Cockpit to Todo Task Drafts and active linked executions. In `f:\HBG Webserver\extensions\source-scheduler\src\todoCockpitActionHandler.ts` and any linked helpers, align `createTaskFromTodo` and linked-task updates so `ready` allows explicit draft creation from the Todo plus latest actionable comment context, while `ON-SCHEDULE-LIST` represents only cards whose linked task has already left draft mode and entered active execution handling. Preserve the existing idea that linked drafts surface under Todo Task Drafts in the task list, with no date-specific downstream behavior hardcoded into the plugin.
10. Add deterministic lifecycle syncing between task-state changes and Todo routing-state changes in the scheduler/task integration surface, likely centered in `f:\HBG Webserver\extensions\source-scheduler\src\cockpitBoardManager.ts`, `f:\HBG Webserver\extensions\source-scheduler\src\scheduleManager.ts`, and linked refresh paths. Entering an immediate run or a real scheduled execution window should automatically flip the source Todo from `ready` to `ON-SCHEDULE-LIST` without relying on the chat session to manage that transition.
11. Phase 5: update plugin UI copy and configuration surfaces in `f:\HBG Webserver\extensions\source-scheduler\src\schedulerWebview.ts`, `f:\HBG Webserver\extensions\source-scheduler\src\schedulerWebviewStrings.ts`, and `f:\HBG Webserver\extensions\source-scheduler\src\i18n.ts`. Replace `go` terminology with `ready`, remove the default rejected flag preset, reintroduce `FINAL-USER-CHECK` as a visible supported workflow flag, and update `How To Use` help copy so it explains the new deterministic flow correctly.
12. Add a final documentation pass after behavior and tests are done. This pass must do two things together: add one new high-signal overview section to `f:\HBG Webserver\extensions\source-scheduler\README.md` that explains the new Todo-to-draft-to-execution lifecycle, and update existing README workflow sections plus the `How To Use` / "How It Works" guidance in the extension copy so they are aligned with the shipped behavior.
13. Update the semantic contract docs and bundled guidance that downstream repos depend on: `f:\HBG Webserver\extensions\source-scheduler\README.md`, `f:\HBG Webserver\extensions\source-scheduler\TODO_COCKPIT_FEATURES.md`, `f:\HBG Webserver\extensions\source-scheduler\src\i18n.ts`, `f:\HBG Webserver\extensions\source-scheduler\src\schedulerWebviewStrings.ts`, `f:\HBG Webserver\extensions\source-scheduler\.github\skills\cockpit-scheduler-router\SKILL.md`, `f:\HBG Webserver\extensions\source-scheduler\.github\skills\cockpit-todo-agent\SKILL.md`, `f:\HBG Webserver\extensions\source-scheduler\.github\skills\cockpit-scheduler-agent\SKILL.md`, and `f:\HBG Webserver\extensions\source-scheduler\.github\prompts\cockpit-scheduler-router.prompt.md`. Rewrite them around deterministic single-source workflow flags, explicit archive rejection, plugin-owned routing semantics, plugin-managed draft-to-on-schedule lifecycle updates, and the final user-review model.
14. Phase 6: replace and extend tests so the migration is locked down. At minimum, update `f:\HBG Webserver\extensions\source-scheduler\src\test\suite\cockpitBoardManager.test.ts`, `f:\HBG Webserver\extensions\source-scheduler\src\test\suite\todoCockpitActionHandler.test.ts`, `f:\HBG Webserver\extensions\source-scheduler\src\test\suite\scheduleManager.test.ts`, `f:\HBG Webserver\extensions\source-scheduler\src\test\suite\server.test.ts`, `f:\HBG Webserver\extensions\source-scheduler\src\test\suite\schedulerWebviewCockpitBridge.test.ts`, `f:\HBG Webserver\extensions\source-scheduler\src\test\suite\schedulerWebviewTaskHandler.test.ts`, `f:\HBG Webserver\extensions\source-scheduler\src\test\suite\cockpitSemanticsDocs.test.ts`, `f:\HBG Webserver\extensions\source-scheduler\src\test\suite\schedulerWebview.test.ts`, and `f:\HBG Webserver\extensions\source-scheduler\src\test\suite\schedulerWebviewSettingsHandler.test.ts` to cover legacy normalization, canonical transition rules, latest-actionable-comment prompt synthesis, explicit draft creation, automatic draft-to-ON-SCHEDULE-LIST lifecycle updates, UI preset changes, and docs alignment.

**Detailed test strategy**

The migration should not be considered complete until the deterministic workflow is covered at three levels: pure board-state transitions, task-lifecycle synchronization, and public contract surfaces such as MCP, UI copy, and docs.

**Required suite ownership**
- `src/test/suite/cockpitBoardManager.test.ts`
	- normalize legacy `go`, `GO`, legacy `status = ready`, and rejection inputs into the new flag-first model
	- prove `ready` does not require a `taskId` until explicit draft creation happens
	- prove `FINAL-USER-CHECK` has no automatic return path
	- prove valid `FINAL-USER-CHECK` exits are limited to archive completed, `needs-user-review`, `needs-bot-review`, and context-qualified `ready`
	- prove invalid direct `new` exits from `FINAL-USER-CHECK` are rejected or normalized away
	- prove stale linked-task cleanup does not restage the whole workflow
	- prove repeated transition helpers are idempotent and do not duplicate comments or flags
- `src/test/suite/todoCockpitActionHandler.test.ts`
	- cover explicit draft creation from `ready`
	- cover reusing an existing draft instead of duplicating it
	- cover refreshing a draft from Todo title, description, latest actionable user comment, and recent comment context
	- cover keeping the card in `ready` while the linked task remains draft-only
	- cover action-handler behavior when a linked draft is missing, stale, or already active
- `src/test/suite/scheduleManager.test.ts`
	- cover enabling a one-time draft as the event that flips the Todo to `ON-SCHEDULE-LIST`
	- cover a future scheduled enabled task also counting as `ON-SCHEDULE-LIST`
	- cover running-task refreshes that keep the Todo in `ON-SCHEDULE-LIST` without duplicate lifecycle comments
	- cover successful completion and self-delete flows that move the Todo to `FINAL-USER-CHECK`
	- cover failure or deleted-task flows that move the Todo to `needs-user-review`
- `src/test/suite/server.test.ts`
	- cover MCP normalization so tool inputs no longer rely on labels or comment labels as the routing source
	- cover `cockpit_approve_todo`, `cockpit_update_todo`, `cockpit_closeout_todo`, and routing-card semantics under the new flag model
	- cover that `FINAL-USER-CHECK` exits described by MCP responses match the canonical plan
	- cover compatibility input acceptance during rollout without preserving legacy routing semantics as source of truth
- `src/test/suite/schedulerWebviewCockpitBridge.test.ts`
	- cover message/bridge behavior for explicit draft creation, linked-task updates, and closeout actions
	- prove the webview bridge does not silently auto-create tasks when a card merely becomes `ready`
- `src/test/suite/schedulerWebviewTaskHandler.test.ts`
	- cover enabling a linked draft, scheduling it, and reflecting the resulting deterministic Todo-state change
	- cover disabling or editing a draft without incorrectly forcing `ON-SCHEDULE-LIST`
- `src/test/suite/schedulerWebview.test.ts`
	- cover visible workflow messaging for `ready`, `ON-SCHEDULE-LIST`, and `FINAL-USER-CHECK`
	- cover that the UI no longer suggests old status-driven behavior such as automatic `ready` task creation or `rejected` as a live routing flag
- `src/test/suite/schedulerWebviewSettingsHandler.test.ts`
	- cover any rollout or compatibility settings that gate the migration path
	- cover default behavior for explicit draft creation versus lifecycle-managed execution-state flips
- `src/test/suite/cockpitSemanticsDocs.test.ts`
	- lock README, feature docs, `How To Use` copy, skills, and prompt guidance to the same flag-first semantics
	- prove docs no longer describe `new` as a `FINAL-USER-CHECK` exit
	- prove docs no longer describe `ready` as automatic task creation
	- prove docs describe `needs-bot-review` as planning output written back to Todo comments
	- prove the new README overview section and the `How To Use` explanation match the real Todo-to-draft-to-execution lifecycle

**Minimum scenario matrix**
- Scenario 1: create a new Todo, move it through `needs-bot-review`, write a semi-structured planning comment, and land in `needs-user-review`
- Scenario 2: move a card from `needs-user-review` to `ready` and verify no task is auto-created
- Scenario 3: explicitly create a linked Todo Task Draft from `ready` and verify the card stays `ready`
- Scenario 4: add a newer actionable user comment while the task is still draft-only and verify deterministic draft refresh behavior
- Scenario 5: enable the linked draft for immediate execution and verify the card flips to `ON-SCHEDULE-LIST`
- Scenario 6: enable the linked draft with a future schedule and verify the card still flips to `ON-SCHEDULE-LIST`
- Scenario 7: complete or self-delete the one-time task successfully and verify the card moves to `FINAL-USER-CHECK`
- Scenario 8: fail execution and verify the card moves to `needs-user-review`
- Scenario 9: delete the linked task before completion and verify stale `taskId` cleanup plus a deterministic `needs-user-review` outcome
- Scenario 10: from `FINAL-USER-CHECK`, verify allowed manual exits and reject invalid direct `new` exit behavior

**Regression gates before implementation is considered done**
- No suite should rely on labels or comment labels as the active routing source after canonical-primary mode is enabled.
- No suite should permit automatic draft creation merely because a card entered `ready`.
- No suite should permit automatic exit from `FINAL-USER-CHECK` without explicit user action.
- No suite should leave a stale `taskId` after successful closeout, deleted-task repair, or failure handling.
- No suite should allow duplicate lifecycle comments or duplicate linked-task creation on repeated passes.

**Observability and verification**
- Add structured logs in `src/logger.ts` or the existing host logging path for: normalization counts, contradictory legacy records, legacy-vs-canonical routing mismatches, and repeated idempotent transition hits.
- During shadow and dual-write phases, emit reconciliation summaries to the repo-local `.copilot-cockpit-logs` folder so manual validation can compare old and new routing decisions.
- Add a focused validation checklist for the installed extension: create a card in each active workflow state, verify that entering `ready` does not auto-create a draft, explicitly create or refresh a linked Todo Task Draft from Todo plus latest-actionable-comment context, enable that task, verify that enabling flips the card to `ON-SCHEDULE-LIST` automatically, close out an `ON-SCHEDULE-LIST` card into `FINAL-USER-CHECK`, and reject/archive a card without introducing a live `rejected` flag.
- Add targeted runnable checks during implementation, not only at the end:
	- run the touched suite after each substantive behavior change when feasible
	- rerun `cockpitBoardManager.test.ts` after board-state or normalization edits
	- rerun `todoCockpitActionHandler.test.ts` after draft-creation or prompt-synthesis edits
	- rerun `scheduleManager.test.ts` after task lifecycle syncing edits
	- rerun `server.test.ts` after MCP schema or routing-contract edits
	- rerun `cockpitSemanticsDocs.test.ts` after README, `How To Use`, or feature-doc edits
- Success criteria for canonical-primary rollout: zero unexpected routing mismatches in automated tests, no duplicate comments or task links in repeated transitions, and no stale `taskId` left behind after closeout or task removal.

**Rollback plan**
- Do not remove legacy read/write paths in the same release that introduces canonical-primary routing.
- Keep dual-write support long enough to revert reads back to legacy behavior without losing data.
- If canonical routing produces mismatches or duplicate side effects, switch back to legacy-primary reads, keep canonical writes disabled, and use the logged normalization mismatches to repair the mapping rules before retrying.
- Do not delete compatibility aliases such as `go` input normalization until at least one stable release proves the migration path works in practice.

**Risks and controls**
- Highest-risk change: collapsing `ready` out of status semantics. Control this with shadow normalization, dual-write, and an explicit rollout switch.
- Second-risk change: making workflow flags exclusive. This must be enforced through helper functions and tests, not by convention alone.
- Third-risk change: removing label and comment-label routing. Preserve comment parsing only for execution details and add regression tests that prove routing no longer depends on labels or comment labels.
- Fourth-risk change: restoring `FINAL-USER-CHECK` as a live flag while keeping `final-user-check` invalid as a section. Cover this with normalization plus docs-contract tests so the plugin does not regress into using it as both a section token and a flag.

**Relevant files**
- `f:\HBG Webserver\extensions\source-scheduler\src\types.ts` - source of truth for todo statuses, archive outcomes, routing card types, and migration impact radius.
- `f:\HBG Webserver\extensions\source-scheduler\src\cockpitBoard.ts` - system flag seeds, normalization, deprecated token handling, canonical workflow helper logic, and board-load migration behavior.
- `f:\HBG Webserver\extensions\source-scheduler\src\cockpitBoardManager.ts` - approve/finalize/reject/restore/update behavior that currently encodes `ready` and `rejected` as statuses.
- `f:\HBG Webserver\extensions\source-scheduler\src\cockpitRouting.ts` - current default routing signals and the multi-surface routing matcher that must become deterministic.
- `f:\HBG Webserver\extensions\source-scheduler\src\server.ts` - MCP tool descriptions, schemas, compatibility normalization entry points, and dispatcher-facing semantics.
- `f:\HBG Webserver\extensions\source-scheduler\src\todoCockpitActionHandler.ts` - task-draft creation and linked-task handoff behavior for `ON-SCHEDULE-LIST` semantics.
- `f:\HBG Webserver\extensions\source-scheduler\src\schedulerWebview.ts` - settings/help UI that currently exposes workflow flag presets and guidance.
- `f:\HBG Webserver\extensions\source-scheduler\src\schedulerWebviewStrings.ts` - localized copy for flag presets, status wording, and task-draft guidance.
- `f:\HBG Webserver\extensions\source-scheduler\src\logger.ts` - existing logging surface for migration diagnostics and rollout observability.
- `f:\HBG Webserver\extensions\source-scheduler\README.md` - public plugin workflow guidance.
- `f:\HBG Webserver\extensions\source-scheduler\TODO_COCKPIT_FEATURES.md` - detailed Cockpit semantics documentation.
- `f:\HBG Webserver\extensions\source-scheduler\.github\skills\cockpit-scheduler-router\SKILL.md` - dispatcher/router guidance that downstream repos follow.
- `f:\HBG Webserver\extensions\source-scheduler\.github\skills\cockpit-todo-agent\SKILL.md` - Cockpit mutation guidance that must align with the new state model.
- `f:\HBG Webserver\extensions\source-scheduler\.github\skills\cockpit-scheduler-agent\SKILL.md` - scheduler-side guidance for task handoff semantics.
- `f:\HBG Webserver\extensions\source-scheduler\.github\prompts\cockpit-scheduler-router.prompt.md` - bundled dispatcher prompt that should shrink because the plugin owns more of the determinism.

**Verification**
1. Add migration-focused unit tests for board normalization so legacy cards using `go`, `GO`, `status = ready`, or `rejected` semantics normalize into the new deterministic state model without data loss.
2. Add suite-level coverage for explicit draft creation, draft refresh, and latest-actionable-comment prompt synthesis.
3. Add lifecycle-sync coverage for enabled, scheduled, running, successful, failed, and deleted linked-task states.
4. Add server tests for MCP schemas and runtime behavior so routing defaults, closeout wording, compatibility normalization, and legacy input acceptance stay aligned.
5. Add docs-contract tests proving the skills, prompt, README, `How To Use` copy, and feature doc all describe the same workflow states and no longer advertise `rejected` as a routing flag or `new` as a `FINAL-USER-CHECK` exit.
6. Add observability tests or focused assertions where practical for normalization warnings and migration-mode gating.
7. Run `npm run pretest` in `f:\HBG Webserver\extensions\source-scheduler`.
8. Run `npm test` in `f:\HBG Webserver\extensions\source-scheduler`.
9. Manually verify in the installed extension that the flag presets, Todo workflow labels, explicit task-draft creation flow, deterministic `ON-SCHEDULE-LIST` syncing, `FINAL-USER-CHECK` waiting behavior, linked-task closeout behavior, README overview section, and `How To Use` guidance all reflect the new deterministic state model.

**Decisions**
- Target repo: this plugin repo only, not the downstream Todoist repo.
- Canonical active workflow states should be explicit workflow flags, not a mix of statuses, labels, and comment labels.
- `ready` should become a real workflow flag everywhere, not a special active status.
- `rejected` should be removed as a routing flag and kept only as archive outcome and explicit archive action semantics.
- `FINAL-USER-CHECK` should be restored as a supported live workflow flag, while `final-user-check` remains invalid as a section name.
- `ready` should be the approval and explicit draft-creation state, while `ON-SCHEDULE-LIST` should represent only linked tasks that have already moved beyond draft-only mode into active execution handling.
- `needs-bot-review` should return to `needs-user-review` by default and should write one semi-structured planning comment back to the Todo.
- Draft creation from `ready` should happen only on explicit user action.
- Latest actionable user comment should override older Todo context, while title, description, and recent comments remain supporting context.
- Enabling a linked one-time task should flip the Todo deterministically to `ON-SCHEDULE-LIST`.
- A future scheduled enabled task should already count as `ON-SCHEDULE-LIST`.
- Failed execution should return to `needs-user-review` by default.
- `FINAL-USER-CHECK` should not have a default automatic return path; it should only wait for the user.
- valid manual exits from `FINAL-USER-CHECK` should be limited to archive completed, `needs-user-review`, `needs-bot-review`, and `ready` only when the latest comment is a user comment.
- `new` should not be a direct exit from `FINAL-USER-CHECK`.
- after implementation and tests are complete, README and `How To Use` must get a dedicated final alignment pass plus one new high-signal overview section that explains the shipped workflow clearly.
- Docs should switch directly to the new flag-first model.
- Included scope: plugin types, normalization, MCP semantics, UI/docs, rollout controls, and tests needed to support downstream deterministic routing.
- Excluded scope: rewriting the downstream Todoist repo, changing Todoist-specific automation, or implementing repo-specific dispatcher prompts outside this plugin.

**Further considerations**
1. This is a breaking semantic change for any downstream repo that still treats labels or comment labels as routing signals. The implementation should include a documented compatibility window and migration notes in both docs and prompt guidance.
2. The next implementation-level decision after this plan is whether draft refresh while still in `ready` should always happen silently on newer comments or whether the UI should show an explicit "draft needs refresh" indicator before rewriting the prompt.
3. If downstream automation eventually needs a fully plugin-owned dispatcher primitive, the next follow-up after this migration should be a higher-level MCP tool that consumes only the canonical workflow flag and no longer depends on large external dispatcher prompts.
