---
name: system-diagnostics
description: "Something in the system feels stuck or wrong — tasks are not moving, an agent has gone quiet, goals have not been updated in days, or the orchestrator has asked for a system health report. You need to run a structured check: stale tasks, stale goals, overdue human tasks, fleet heartbeat status, and metrics. This is your diagnostic toolkit. Run it on every heartbeat (orchestrator) and whenever something seems off."
triggers: ["system health", "health check", "stale tasks", "stale goals", "fleet health", "system status", "what's stuck", "blocked tasks", "overdue tasks", "goal staleness", "collect metrics", "metrics", "system check", "something seems wrong", "agent not progressing", "work stalled", "nothing moving", "check everything", "full health check", "morning health check", "diagnose system", "task stuck", "goals not updated"]
---

# System Diagnostics

Use these to detect and surface problems before they become crises.

---

## Stale Task Detection

Find tasks that have been in-progress too long or pending without action:

```bash
officeos bus check-stale-tasks
```

Flags:
- `in_progress` for more than 2 hours
- `pending` for more than 24 hours
- Human tasks with no update in 48 hours
- Tasks past their due date

**When to run:** Every heartbeat (orchestrator), on suspicion of stuck work (all agents).

---

## Goal Staleness Check

Detect agents whose GOALS.md hasn't been updated recently:

```bash
# Default threshold (7 days)
officeos bus check-goal-staleness

# Custom threshold
officeos bus check-goal-staleness --threshold 3

# JSON output for parsing
officeos bus check-goal-staleness --json
```

**When to run:** Weekly, or when an agent seems directionless.

---

## Human Task Monitoring

Check for human-assigned tasks that are waiting too long:

```bash
officeos bus check-human-tasks
```

Sends reminders for overdue human tasks. Run daily (orchestrator) or when blocked waiting on a human.

---

## Fleet Health Summary

Read all agent heartbeats at once:

```bash
officeos bus read-all-heartbeats

# JSON for parsing
officeos bus read-all-heartbeats --format json
```

Stale threshold: agent hasn't updated in >6h = investigate.

---

## Metrics Collection

Collect and record system metrics snapshot:

```bash
officeos bus collect-metrics
```

Run nightly (analyst cron). Captures task counts, completion rates, agent activity.

---

## Full Health Check Sequence

Run this during morning review or when something feels off:

```bash
echo "=== Fleet Heartbeats ==="
officeos bus read-all-heartbeats

echo "=== Stale Tasks ==="
officeos bus check-stale-tasks

echo "=== Stale Goals ==="
officeos bus check-goal-staleness

echo "=== Human Tasks ==="
officeos bus check-human-tasks
```

Surface any findings to the user via Telegram if critical.
