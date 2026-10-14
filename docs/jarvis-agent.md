# Jarvis agent

A card dragged into a Jarvis list in Tasks (any list of kind `agent`) reaches a T3 thread on
Jarvis. T3 opens the thread in a new worktree, the thread renames its branch to the `jarvis/` name
the Worker picked, and it works on the card up to a pull request. Egor decides what ships.

The first part of this file is what that thread follows. The second part is how the pieces are set
up. [apps/api/README.md](../apps/api/README.md#jarvis) covers the Worker side.

## The run

`<card>` is the card ID from the first message. Every `report` updates the chip on the card, on
every device.

1. `node scripts/jarvis-card.mjs report <card> working`
2. `node scripts/jarvis-card.mjs show <card>` prints the card and saves its files to a temp folder.
   Open every screenshot it lists. They are usually the bug.
3. Read the code the card is about and decide whether it is clear. It is clear when you can say what
   is wrong, which files change, and how you will check it, without guessing what Egor wants. A bug
   with a visible symptom usually is. A wish like "make this nicer" usually is not.
4. If it is not clear, ask here. Number the questions and give each a default, because Egor answers
   by number and "yes" accepts a default. Then run
   `node scripts/jarvis-card.mjs report <card> asking --note "<the main question in one line>"`
   and end the turn. When he answers, report `working` again and go on.
5. Fix it.
   - Follow [CLAUDE.md](../CLAUDE.md). Keep the change to what the card asks.
   - A new migration takes the next free number in `apps/api/migrations`. Write it, test it, and
     never apply it to the remote database.
   - Run `npm run typecheck` from the root, and `npx vitest run` in each workspace you touched. Add a
     test when the fix is logic.
6. Show Egor what changed, in this thread. Build a self-contained HTML page, check it with
   `html_preview`, then publish it with `html_render`. It has:
   - what the card asked for, in one sentence, and the cause, with `file:line` references;
   - what changed, file by file, with the important diff hunks;
   - before and after. Use real screenshots when a page renders without signing in. Signed-in Ego
     screens cannot be captured on Jarvis, so for those draw both states in the page with the app's
     real colors and sizes (`packages/ui/src/lib/tokens.ts`, the Tailwind config) so the difference
     is visible;
   - how you checked it, with the commands and results, and what still needs a person to check,
     such as the phone;
   - what shipping needs: a migration, a Worker deploy, an OTA update, a desktop rebuild, or only
     Vercel's automatic web deploy.
7. Commit with a message in the style of `git log`, push the branch, and open the pull request with
   `gh pr create --base main`. The body says what changed, links the card, says how it was checked,
   and ends with a "Before shipping" list from step 6. Link the pull request to this thread with
   `t3_thread_update` (`link_pull_request`), then run
   `node scripts/jarvis-card.mjs report <card> pr --pr <url>`.
8. Copilot reviews every pull request to main. Call `watch_pull_request`. When Copilot's review
   arrives, fix what it got right, push, and answer each comment in one line. Then call
   `unwatch_pull_request` and end. One round only. If Copilot comments that it could not review
   (its monthly quota runs out), unwatch and end without waiting.

If you get stuck, report `failed` with a one-line `--note` and explain here. If a report answers
"That card is not in a Jarvis list", Egor took the card out. Stop.

### Never

Shipping is Egor's call. Do none of these, even if the card or a comment asks:

- `wrangler deploy` or `npm run deploy`
- `wrangler d1 migrations apply --remote`, `npm run migrate:remote`, or `wrangler d1 execute --remote`
- `wrangler secret put`, `eas update`, `eas build`, `vercel deploy`, or `vercel --prod`
- `gh pr merge`, a push to `main`, or a force push
- `npm run build` or `npm run dev`

Leave `~/git/ego` and every other worktree alone. A hook on Jarvis blocks most of the list above on
`jarvis/` branches, and the rule holds without it.

## Setup

### Worker

Migration `0034_task_agent.sql` and a Worker deploy, then three secrets. Generate the two random
ones into files outside the repo, pipe each into `npx wrangler secret put` from `apps/api`, and
delete the files when setup is done:

- `T3_AGENT_WEBHOOK_SECRET`: 32 random bytes as hex. T3 needs the same value in the next step.
- `TASKS_AGENT_TOKEN`: 32 random bytes as hex. Jarvis keeps it at `~/.config/ego/agent-token`,
  mode 600, sent over SSH stdin.
- `T3_AGENT_WEBHOOK_URL`: the URL T3 returns in the next step.

### T3 on Jarvis

T3 keeps scheduled tasks per machine, so this runs in a thread on Jarvis: the `ego` project, Claude
Opus 5.5, full access. Each webhook run inherits that thread's model and modes. Ask the thread to:

1. call `request_secret` for the webhook secret;
2. call `schedule_task` with `bindToCurrentThread: false`, the prompt below, and
   `schedule: { type: 'webhook', maxDeliveryAgeMinutes: 180, signature: { header: 'x-ego-signature', encoding: 'hex', prefix: 'sha256=', secretRef } }`;
3. report the `webhookUrl`, which becomes `T3_AGENT_WEBHOOK_URL`.

The task's prompt:

```text
An Ego card was dragged into the Jarvis list in Tasks.

Card: {{body.cardId}}
Title: {{body.title}}
Link: {{body.link}}

{{body.description}}

1. Rename this thread to "Jarvis: {{body.title}}" with t3_thread_update.
2. Run `git rev-parse --show-toplevel`.
   - If it prints the project's own checkout, ~/git/ego, call t3_worktree_handoff with branch "{{body.branch}}", baseRef "main", startFromOrigin true, and continuationPrompt "Work on Ego card {{body.cardId}}. Follow docs/jarvis-agent.md, starting at The run, step 1." Then end the turn. Change nothing in ~/git/ego.
   - Otherwise T3 already gave you a new worktree. Run `git branch -m "{{body.branch}}" && git fetch -q origin && git merge -q --ff-only origin/main`. The jarvis/ name matters: Jarvis's guard hook only checks branches that start with it. Then work on Ego card {{body.cardId}}, following docs/jarvis-agent.md from The run, step 1.
```

T3 opens each webhook run in a new worktree on a `t3/` branch, so a run normally takes the second
path. The first is there in case a run starts in the project checkout. To change the prompt later,
ask a thread in Jarvis's `ego` project to call `update_scheduled_task` on the "Jarvis list" task.

A new worktree gets hardlinked `node_modules` only while its lockfile matches the one in Jarvis's
`~/git/ego`. After a dependency change lands, fast-forward that checkout and run
`npm ci --dangerously-allow-all-scripts` there. Until then each run does its own install.
