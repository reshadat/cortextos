# Tools Quick Reference

This template is tool-agnostic. The setup skill detects and records whichever tools are available.

## Required cortextOS Tools

| Need | Command |
|---|---|
| Reply to user | `officeos bus send-telegram $CTX_TELEGRAM_CHAT_ID "<message>"` |
| Create task | `officeos bus create-task "<title>" --desc "<desc>"` |
| Update task | `officeos bus update-task <task_id> in_progress\|blocked\|completed` |
| Complete task | `officeos bus complete-task <task_id> --result "<summary>"` |
| Attach deliverable | `officeos bus save-output <task_id> <file> --label "<human-readable label>"` |
| Request approval | `officeos bus create-approval "<title>" <category> "<context>"` |
| Log event | `officeos bus log-event <category> <event> info --meta '<json>'` |
| Heartbeat | `officeos bus update-heartbeat "<status>"` |
| Crons | `officeos bus list-crons $CTX_AGENT_NAME`, `officeos bus add-cron ...` |

## Optional Tool Classes

The setup skill writes exact commands here after discovery.

### Email

- Configured provider:
- Account(s):
- Search command:
- Read thread command:
- Draft command:
- Send command:

### Calendar

- Configured provider:
- Calendar(s):
- List events command:
- Create event command:
- Conflict-check command:

### Meeting Notes

- Configured provider:
- Search/list command:
- Transcript export command:

### External CRM

- Configured provider:
- Query command/API:
- Upsert command/API:
- Sync policy:

## Local CRM Store

Default local files:

- `crm/contacts.json`
- `crm/interactions.jsonl`
- `crm/followups.jsonl`
- `crm/relationship-health.json`
