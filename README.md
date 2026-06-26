![License](https://img.shields.io/badge/license-MIT-green) ![Node](https://img.shields.io/badge/node-20%2B-brightgreen) ![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey)

# officeOs

**Persistent 24/7 Claude Code agents you control from Slack.**

Fork of [cortextOS](https://github.com/grandamenium/cortextos) with a Slack control plane, on-demand orchestrator, and cost controls.

---

```
Slack DM

You:     Morning. What did you ship overnight?
Boss:    Overnight recap: 4 tasks done, 2 experiments ran,
         3 scripts drafted. One item needs your approval.

You:     allow
Boss:    Approved. Running now.

You:     Add a cron to check my inbox every morning at 8am.
Boss:    Done. "morning-inbox" cron set — runs daily at 08:00.
```

---

## What's different from cortextOS

| Feature | cortextOS | officeOs |
|---|---|---|
| Control plane | Telegram bot | Slack (Socket Mode) |
| Orchestrator | Always running | On-demand (starts on first Slack message) |
| Approval UI | Inline buttons | Text: type `allow` or `deny` |
| Cost controls | None built in | Model tiering + theta-wave off by default |
| Binary | `cortextos` | `officeos` (+ `cortextos` alias) |

---

## Architecture

```
Slack DM / Channel
      ↓
slack-watcher/slack_watcher.py   (Python, PM2-managed, Slack Bolt Socket Mode)
      ├─ IPC start-agent → daemon.sock   (if orchestrator not running)
      ├─ write inbox file                (FastChecker picks up within 1s)
      └─ "allow"/"deny" approval handler (writes hook-response-{id}.json)
      ↓
officeOs daemon (Node.js, PM2)
      ↓
SlackControlPlane.init() per agent — SlackSocketClient → FastChecker.queueSlackMessage()
      ↓
Agent PTY (Claude Code) → injectMessage() → Claude replies
      ↓
officeos bus send-slack <channel> "<reply>"
      ↓
Slack
```

---

## Quick Start

**Requirements:** Node.js 20+, Claude Code, PM2, Python 3.10+, Slack app.

```bash
# 1. Clone and install
git clone https://github.com/reshadat/officeOs.git
cd officeOs/cortextos
npm install && npm run build
npm install -g .

# 2. Create org and agents
officeos install
officeos init myorg
officeos add-agent orchestrator --template orchestrator --org myorg
officeos add-agent analyst --template analyst --org myorg

# 3. Add Slack credentials to the orchestrator
cat > orgs/myorg/agents/orchestrator/.env << 'EOF'
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_CHANNEL_ID=C...
SLACK_USER_ID=U...
EOF

# 4. Set orchestrator to on-demand (starts on first Slack message)
# Edit orgs/myorg/agents/orchestrator/config.json:
# { "enabled": true, "auto_start": false, "slack_polling": true, "runtime": "claude-code" }

# 5. Disable theta-wave to save tokens
mkdir -p orgs/myorg/agents/orchestrator/experiments
echo '{"theta_wave":{"enabled":false}}' > orgs/myorg/agents/orchestrator/experiments/config.json

# 6. Wire Slack hooks in orchestrator settings.json
# See "Hook Configuration" section below.

# 7. Generate PM2 config and start
officeos ecosystem
pm2 start ecosystem.config.js && pm2 save && pm2 startup

# 8. Start the Python Slack watcher
cd slack-watcher && pip install -r requirements.txt
cp .env.example .env && nano .env  # fill in tokens
pm2 start slack_watcher.py --interpreter python3 --name slack-watcher
pm2 save
```

---

## Slack App Setup

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → Create App → **Enable Socket Mode** → generate App-Level Token (`xapp-...`) with scope `connections:write`.
2. **Bot Token Scopes:** `channels:history`, `chat:write`, `chat:write.public`, `groups:history`, `im:history`, `im:read`, `im:write`, `channels:read`
3. **Event Subscriptions → Bot events:** `message.channels`, `message.groups`, `message.im`
4. Install to workspace → get Bot Token (`xoxb-...`).
5. Get your **User ID**: Profile → More → Copy Member ID (`U...`).
6. Get **Channel ID**: Right-click channel → Copy link → extract the `C...` segment.

---

## Hook Configuration

Add to your orchestrator's `settings.json` (replaces Telegram hooks):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "AskUserQuestion",
        "hooks": [{ "type": "command", "command": "node dist/hooks/hook-ask-slack.js" }]
      },
      {
        "matcher": "ExitPlanMode",
        "hooks": [{ "type": "command", "command": "node dist/hooks/hook-planmode-slack.js" }]
      },
      {
        "matcher": "*",
        "hooks": [{ "type": "command", "command": "node dist/hooks/hook-permission-slack.js" }]
      }
    ],
    "PreCompact": [{ "type": "command", "command": "node dist/hooks/hook-compact-slack.js" }],
    "SessionEnd": [
      { "type": "command", "command": "node dist/hooks/hook-crash-alert.js" },
      { "type": "command", "command": "node dist/hooks/hook-crash-alert-slack.js" }
    ]
  }
}
```

Approval flow: the hook sends a Slack message describing the tool call. Reply `allow` or `deny`. 30-minute timeout: permission hooks deny, plan hooks auto-approve.

---

## Agent Config Reference

**On-demand orchestrator** (`config.json`):
```json
{
  "enabled": true,
  "auto_start": false,
  "slack_polling": true,
  "runtime": "claude-code",
  "model": "claude-sonnet-4-6"
}
```

**Cost-optimized worker** (`config.json`):
```json
{
  "enabled": true,
  "auto_start": true,
  "slack_polling": false,
  "runtime": "claude-code",
  "model": "claude-haiku-4-5-20251001"
}
```

**Theta-wave off** (`experiments/config.json` in any agent dir):
```json
{ "theta_wave": { "enabled": false } }
```

| Field | Default | Effect |
|---|---|---|
| `auto_start` | `true` | `false` = skip in discoverAndStart; start via IPC when Slack message arrives |
| `slack_polling` | `true` | `false` = skip SlackControlPlane init (workers don't own a Slack socket) |
| `model` | `claude-sonnet-4-6` | Set `claude-haiku-4-5-20251001` for ~10x cheaper workers |

---

## Cost Controls

**Model tiering** — set `model` per agent in `config.json`. Haiku is ~10x cheaper than Sonnet.

**Theta-wave off** — write `{"theta_wave":{"enabled":false}}` to `experiments/config.json` in each agent dir. Ships off in officeOs templates.

**Headroom (context compression)** — optional third-party tool for 60-90% token reduction on tool outputs:
```bash
# Proxy mode (zero code change)
headroom proxy --port 8787 &
# Add to agent .env:
ANTHROPIC_BASE_URL=http://localhost:8787
```

---

## CLI Reference

```bash
officeos install             # Set up state directories
officeos init <org>          # Create an organization
officeos add-agent <name>    # Add an agent (--template, --org, --runtime)
officeos enable <name>       # Enable agent in daemon
officeos ecosystem           # Generate PM2 config
officeos status              # Agent health table
officeos doctor              # Check prerequisites
officeos list-agents         # List agents
officeos dashboard           # Start web dashboard (--port 3000)
officeos bus send-slack <channel-id> '<message>'  # Send Slack message from agent
```

`cortextos` is a legacy alias for `officeos` — existing scripts continue to work.

---

## Requirements

| Dependency | Notes |
|---|---|
| Node.js 20+ | [nodejs.org](https://nodejs.org) |
| macOS or Linux | |
| Claude Code | `npm install -g @anthropic-ai/claude-code` + `claude login` |
| PM2 | `npm install -g pm2` |
| Python 3.10+ | For `slack-watcher/` |
| Slack app | See "Slack App Setup" above |

---

## Templates

| Template | Description |
|---|---|
| `orchestrator` | Coordinates agents, manages goals, handles reviews, approves actions |
| `analyst` | System health, metrics, theta-wave autoresearch, analytics |
| `agent` | General-purpose worker |
| `agent-codex` | Codex-runtime worker (`runtime: codex-app-server`) |

---

## Upstream

officeOs tracks [grandamenium/cortextos](https://github.com/grandamenium/cortextos). To rebase:

```bash
git fetch upstream
git rebase upstream/main officeOs
```

All officeOs changes are additive-only: new files in `src/slack/`, new hooks, `slack-watcher/`. Telegram code left intact as dead code (no BOT_TOKEN = no Telegram). Each commit is independently revertable.

---

## Security

Approval gate: every tool call goes to Slack. Type `allow` or `deny`. 30-minute timeout denies automatically (permission hooks) or auto-approves (plan hooks). `SLACK_USER_ID` gates all messages — only your Slack user ID triggers the orchestrator.

---

## License

MIT — see [LICENSE](./LICENSE).
