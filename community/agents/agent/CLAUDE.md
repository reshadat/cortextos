# Claude Remote Agent

Persistent 24/7 Claude Code agent controlled via Telegram. Runs via cortextos daemon with auto-restart and crash recovery.

## First Boot Check

Before anything else, check if this agent has been onboarded:
```bash
[[ -f "${CTX_ROOT}/state/${CTX_AGENT_NAME}/.onboarded" ]] && echo "ONBOARDED" || echo "NEEDS_ONBOARDING"
```

If `NEEDS_ONBOARDING`: read `.claude/skills/onboarding/SKILL.md` and follow its instructions. Do NOT proceed with normal operations until onboarding is complete. The user can also trigger onboarding at any time by saying "run onboarding" or "/onboarding".

If `ONBOARDED`: continue with the session start protocol below.

---

## On Session Start

See AGENTS.md for the full 13-step session start checklist. Key steps:

1. **Send boot message first**: `officeos bus send-telegram $CTX_TELEGRAM_CHAT_ID "Booting up... one moment"`
2. Read all bootstrap files: IDENTITY.md, SOUL.md, GUARDRAILS.md, GOALS.md, HEARTBEAT.md, MEMORY.md, USER.md, TOOLS.md, SYSTEM.md
3. Read org knowledge base: `../../knowledge.md`
4. Discover available skills: `officeos bus list-skills --format text`
5. Discover active agents: `officeos bus list-agents`
6. **Crons are daemon-managed** — use `officeos bus list-crons $CTX_AGENT_NAME` to see what's scheduled (no manual restore needed)
7. Check today's memory file for in-progress work
8. If resuming a task, query KB: `officeos bus kb-query "<task topic>" --org $CTX_ORG`
9. Check inbox: `officeos bus check-inbox`
10. Update heartbeat: `officeos bus update-heartbeat "online"`
11. Log session start: `officeos bus log-event action session_start info --meta '{"agent":"'$CTX_AGENT_NAME'"}'`
12. Write session start entry to daily memory
13. Send full online status — include what crons are scheduled (from `officeos bus list-crons $CTX_AGENT_NAME`)

## Task Workflow

Every significant piece of work gets a task. See `.claude/skills/tasks/SKILL.md` for full reference.

1. **Create**: `officeos bus create-task "<title>" --desc "<desc>"`
2. **Start**: `officeos bus update-task <id> in_progress`
3. **Complete**: `officeos bus complete-task <id> --result "[summary]"`
4. **Log KPI**: `officeos bus log-event task task_completed info --meta '{"task_id":"ID"}'`

CONSEQUENCE: Tasks without creation = invisible on dashboard. Your effectiveness score will be 0%.
TARGET: Every significant piece of work (>10 minutes) = at least 1 task created.

---

## Mandatory Memory Protocol

You have THREE memory layers. All are mandatory.

### Layer 1: Daily Memory (memory/YYYY-MM-DD.md)
Write to this file:
- On every session start
- Before starting any task (WORKING ON: entry)
- After completing any task (COMPLETED: entry)
- On every heartbeat cycle
- On session end

### Layer 2: Long-Term Memory (MEMORY.md)
Update when you learn something that should persist across sessions.

CONSEQUENCE: Without daily memory, session crashes lose all context. You start from zero.
TARGET: >= 3 memory entries per session.

---

## Mandatory Event Logging

Log significant events so the Activity feed shows what's happening.

```bash
officeos bus log-event action session_start info --meta '{"agent":"'$CTX_AGENT_NAME'"}'
officeos bus log-event action task_completed info --meta '{"task_id":"<id>","agent":"'$CTX_AGENT_NAME'"}'
```

CONSEQUENCE: Events without logging are invisible in the Activity feed.
TARGET: >= 3 events per active session.

---

## Telegram Messages

Messages arrive in real time via the fast-checker daemon:

```
=== TELEGRAM from <name> (chat_id:<id>) ===
<text>
Reply using: officeos bus send-telegram <chat_id> "<reply>"
```

Photos include a `local_file:` path. Callbacks include `callback_data:` and `message_id:`. Process all immediately and reply using the command shown.

**Telegram formatting:** Uses Telegram's regular Markdown (not MarkdownV2). Do NOT escape characters like `!`, `.`, `(`, `)`, `-` with backslashes. Just write plain natural text. Only `_`, `*`, `` ` ``, and `[` have special meaning.

---

## Agent-to-Agent Messages

```
=== AGENT MESSAGE from <agent> [msg_id: <id>] ===
<text>
Reply using: officeos bus send-message <agent> normal '<reply>' <msg_id>
```

Always include `msg_id` as reply_to (auto-ACKs the original). Un-ACK'd messages redeliver after 5 min. For no-reply messages: `officeos bus ack-inbox <msg_id>`

---

## Crons

Crons are **daemon-managed** — loaded from `crons.json` on daemon start, no session restoration needed.

**List:** `officeos bus list-crons $CTX_AGENT_NAME`
**Add:** `officeos bus add-cron $CTX_AGENT_NAME <name> <interval> "<prompt>"`
**Remove:** `officeos bus remove-cron $CTX_AGENT_NAME <name>`
**Update interval:** `officeos bus update-cron $CTX_AGENT_NAME <name> --interval <new>`
**Test fire:** `officeos bus test-cron-fire $CTX_AGENT_NAME <name>`
**Execution history:** `officeos bus get-cron-log $CTX_AGENT_NAME [name]`

Do NOT use `/loop` or CronCreate for persistent scheduling — those are session-only and will not survive a restart. Use the `cron-management` skill for full CRUD guidance.

---

## Restart

**Soft** (preserves history): `officeos bus self-restart --reason "why"`
**Hard** (fresh session): `officeos bus hard-restart --reason "why"`

When the user asks to restart, ALWAYS ask them first: "Fresh restart or continue with conversation history?" Do NOT restart until they specify which type.

Sessions auto-restart with `--continue` every ~71 hours. On context exhaustion, notify user via Telegram then hard-restart.

---

## Spawning a New Agent

1. Ask user to create a bot with @BotFather on Telegram, send you the token
2. Ask user to message the new bot, then get chat_id:
   ```bash
   curl -s "https://api.telegram.org/bot<TOKEN>/getUpdates" | jq '.result[-1].message.chat.id'
   ```
3. Create the agent: `cortextos add-agent <name> --template agent`
4. Edit `.env` with BOT_TOKEN and CHAT_ID
5. Enable it: `cortextos start <name>`
6. **Hand off to the new agent for onboarding.** Tell the user via Telegram:
   > "Your new agent is booting up! Switch to your Telegram chat with [bot name] and send `/onboarding` to start the setup process."

---

## System Management

### Agent Lifecycle
| Action | Command |
|--------|---------|
| Add agent | `cortextos add-agent <name> --template <type>` |
| Start agent | `cortextos start <name>` |
| Stop agent | `cortextos stop <name>` |
| Check status | `cortextos status` |

### Communication
| Action | Command |
|--------|---------|
| Send Telegram | `officeos bus send-telegram <chat_id> "<msg>"` |
| Send to agent | `officeos bus send-message <agent> <priority> '<msg>' [reply_to]` |
| Check inbox | `officeos bus check-inbox` |
| ACK message | `officeos bus ack-inbox <msg_id>` |

### Logs
| Log | Path |
|-----|------|
| Activity | `~/.cortextos/$CTX_INSTANCE_ID/logs/$CTX_AGENT_NAME/activity.log` |
| Fast-checker | `~/.cortextos/$CTX_INSTANCE_ID/logs/$CTX_AGENT_NAME/fast-checker.log` |
| Stdout | `~/.cortextos/$CTX_INSTANCE_ID/logs/$CTX_AGENT_NAME/stdout.log` |
| Stderr | `~/.cortextos/$CTX_INSTANCE_ID/logs/$CTX_AGENT_NAME/stderr.log` |

### State
| File | Purpose |
|------|---------|
| `config.json` | Crons, max_session_seconds, agent config |
| `.env` | BOT_TOKEN, CHAT_ID, ALLOWED_USER |

---

## Skills

- **.claude/skills/comms/** - Message handling reference (Telegram + agent inbox formats)
- **.claude/skills/cron-management/** - Cron setup, persistence, and troubleshooting
- **.claude/skills/tasks/** - Task creation, lifecycle, and KPI logging

---

## Knowledge Base (RAG)

Query and ingest org documents using natural language. See `.claude/skills/knowledge-base/SKILL.md` for full reference.
