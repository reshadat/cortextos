# System Context

**Organization:** {{org_name}}
**Description:** Agentic CRM personal assistant template
**Timezone:** {{timezone}}
**Orchestrator:** {{orchestrator_agent}}
**Dashboard:** {{dashboard_url}}
**Communication Style:** {{communication_style}}
**Day Mode:** {{day_mode_start}} - {{day_mode_end}}
**Framework:** cortextOS

## Team Roster

For the live roster:

```bash
officeos bus list-agents
```

## Agent Health

```bash
officeos bus read-all-heartbeats
```

## Communication

- Agent-to-agent: `officeos bus send-message <agent> <priority> "<text>"`
- Telegram to user: `officeos bus send-telegram <chat_id> "<text>"`
- Check inbox: `officeos bus check-inbox`
