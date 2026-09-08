# Development workflow and learning guide

Status: working guide, updated 2026-09-08. Applies to humans and coding agents. Actual commands and current delivery status live in README.md.

## Organize around a reviewable outcome

An issue describes a problem and how we will know it is solved. A branch holds related implementation work. Commits preserve meaningful checkpoints. A pull request proposes integrating one coherent change. A milestone groups several outcomes. A release identifies a version intended for use.

The proposed loop is: describe the outcome → agree acceptance examples → implement a small change → verify → review → merge → demonstrate. Resolve architecture only as far ahead as needed to make the next work safe and understandable.

Open a draft PR once there is a concrete diff worth discussing, or an early design that needs feedback. Mark it ready when its stated outcome and checks are complete. Merge when acceptance evidence is satisfactory, relevant checks pass, review findings are resolved, and required review is complete. Keep unrelated changes on separate branches. GitHub documents this general branch/draft/review/merge flow in [GitHub flow](https://docs.github.com/en/get-started/using-github/github-flow).

## A useful task brief

Before implementation, write a short brief in the issue or local working note:

```text
Problem and intended behavior:
Relevant decisions, rules examples, and files:
Scope and constraints:
Acceptance examples:
Verification to run:
Open questions that affect this change:
```

Example: “When a player submits the same physical card twice, reject the action and preserve state. Distinct copies of the same face must remain usable as a pair.” Acceptance evidence should demonstrate both cases. This is more useful than a task named “implement validation.”

A task that only needs a sentence should stay a sentence. A research spike needs a question, a time/cost limit, and an expected result such as a decision or measurement. Label prototypes so unreviewed experimental code does not become the architecture by accident.

## Code and verification

Organize the game around understandable responsibilities: rules/state transitions, player observations, player implementations, provider translation, and presentation. Keep network calls and UI timers out of deterministic rules logic. Validate data where it crosses a trust boundary.

Derive important tests from agreed behavior. For this game, prioritize card conservation, duplicate identities, following obligations, score boundaries, private information, and stale API responses. Use replay fixtures and generated sequences where they catch interactions that a few examples miss. A second implementation agreeing with the first is useful evidence, but both may share the same misunderstanding.

Use fake provider responses for ordinary development and continuous integration. Run paid evaluations separately with a stated budget and recorded configuration. UI changes need an actual playthrough or visual check; passing unit tests cannot establish that the player understands the screen.

Update affected documentation in the same PR as the behavior. Run the checks that cover the change. When a check fails, understand the failure instead of repeatedly retrying until it passes. Add regression coverage for a reproduced substantive bug; do not manufacture tests for trivial document edits.

## Review and merge in this project

Use one PR for one coherent result that a reviewer can understand and, if necessary, revert. Tests and required documentation belong with the change. A milestone such as “first API player” will normally contain several PRs.

A PR description should explain the problem, resulting behavior, verification evidence, and any limitation that matters to accepting it. Report exact failures or unrun checks. Keep narrative about abandoned experiments out unless it explains a decision.

Product review should include actual human play feedback. An independent agent review can help find bugs, but does not replace observable evidence. Use a fresh review context for consequential changes, supplying the requirements, diff, and tests. If several agents implement in parallel, give each a bounded task and separate checkout/worktree; do not have them mutate the same files concurrently.

Proposed merge gate:

- The issue's acceptance examples are satisfied.
- Relevant automated checks and any needed playthrough pass on the version being merged.
- Review findings are resolved; changed contracts and docs agree.
- Reviewers understand any material tradeoff and required repository review is complete.

Squash merging is a reasonable initial choice for one-change PRs; choose the actual repository convention when setting it up. Merging integrates a change. Deploying or releasing makes a version available to users; decide that workflow explicitly rather than assuming every merge publishes the game.

## Maintain a small source of truth

The README is the map. The brief owns goals, milestone acceptance, and unresolved product decisions. Rules and API contracts should get their own documents when we specify them. Decision records explain why consequential choices were made; issues and PRs carry execution status and review evidence.

Keep current specifications separate from historical notes. When a decision changes, update the active specification and mark the earlier decision superseded. Do not paste the entire chat into project documentation. Do not maintain the same backlog in multiple places.

The short `AGENTS.md` now routes agents to the relevant documents and actual commands: `npm start`, `npm test`, and `npm run check`. OpenAI's guidance recommends concise, practical agent instructions; see [reusable guidance](https://learn.chatgpt.com/guides/best-practices#make-guidance-reusable-with-agentsmd).

Other harnesses may use different entry files or loading rules. Keep those files as thin pointers to the same repository-owned instructions, and verify that the selected harness actually reads them. Avoid duplicating a long specification into every tool's config. Add skills or connectors when a task needs them, rather than making a large catalog a project prerequisite.

## Teach through each delivery

For each meaningful task, explain briefly:

1. The engineering concept being exercised and why it matters here.
2. The decision and relevant alternative.
3. The resulting behavior, with a concrete example.
4. The verification evidence and its limits.
5. What makes the change ready for review or merge.

At milestone boundaries, demonstrate the product, compare evidence against the exit criteria, and record the next decisions. A useful handoff gives the current branch/version, completed work, relevant commands and results, open risks, and the next bounded task. Another coding agent should be able to resume without reconstructing this conversation.

The first public snapshot starts from a clean publication history. For subsequent work, branch from public main, open a focused PR, include verification evidence, and merge after review and CI pass. Local private planning branches are never push destinations.
