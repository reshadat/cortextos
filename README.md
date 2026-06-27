<p align="center"><pre>
  ┌─────────────────────────────────┐
  │  ▓▓  analyst   codebase  ▓▓▓  │
  │  ▓▓  ·······   ········  ▓▓▓  │
  │                                 │
  │       orchestrator              │
  │       ─────────────             │
  │       you → Slack → ✓           │
  └─────────────────────────────────┘
         o  f  f  i  c  e  O  s
</pre></p>

<h1 align="center">officeOs</h1>

<p align="center">
  <em>An office of AI agents. Your infra. Your Slack. Your rules.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-111111?style=flat-square" alt="MIT">
  <img src="https://img.shields.io/badge/node-20%2B-111111?style=flat-square" alt="Node 20+">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux-111111?style=flat-square" alt="macOS / Linux">
  <img src="https://img.shields.io/badge/runtime-Claude%20Code%20%7C%20Codex-111111?style=flat-square" alt="Claude Code / Codex">
  <img src="https://img.shields.io/badge/Slack-Socket%20Mode-111111?style=flat-square" alt="Slack Socket Mode">
</p>

---

Think about the best engineering team you've ever worked with. Someone who knows the codebase cold. Someone who monitors the dashboards so you don't have to. Someone who handles the overnight jobs, writes the status updates, routes questions to whoever knows best — and only wakes you when a decision actually needs a human.

Now imagine that team works 24/7, costs almost nothing, lives on your own servers, and talks to you in Slack.

That's officeOs. Not a chatbot. Not a single Claude session. An operating system for a team of AI agents — each with a job title, a knowledge base, a set of responsibilities, and colleagues they hand off to when a query isn't theirs. The orchestrator is your chief of staff. The analyst watches your systems. Specialists handle the domain work. You make the calls that actually need you.

```
You:    What shipped overnight?

Chief:  Overnight summary:
        · Analyst ran nightly metrics — no anomalies
        · Codebase agent answered 3 questions from the team
        · Deploy pipeline ran at 02:14, one approval pending

You:    allow

Chief:  ✅ Deploy complete. Everything green.
```

```
Colleague (Slack):  How does the rate limiter work?

Chief:  Routing to codebase agent.
        Rate limiter: token-bucket. 10 req/60s per user, 100 req/60s global.
        Config: src/middleware/rate-limit.ts
```

```
Boss:   Migration needs your sign-off.
        File: /workspace/db/migrations/0042_users.sql
        Triggered by: deploy pipeline
        Request ID: a1b2c3
        Reply: allow a1b2c3 / deny a1b2c3

You:    allow a1b2c3

Boss:   ✅ Done. Back to sleep.
```

Your team, your infra. Agents run on your machine, talk through your Slack, and can only touch what you explicitly give them. The keys are yours.

## How it works

Not a chatbot. Not a wrapper. A persistent agent team — each member has a job description, knows what it handles, and routes everything else to the right specialist.

```
You → Slack → Orchestrator (Officer: routes only, never does domain work)
                 └─ reads who handles what
                 └─ routes to the right specialist
                 └─ relays answer back to you

Specialists (you build these):
  Analyst        — metrics, system health, weekly improvement proposals
  Codebase       — questions about your repo
  (add any agent with a JD)
```

Every agent declares what it does. No keyword matching — the orchestrator reads intent.

```
You:   How does the rate limiter work?

Boss:  Routing to codebase agent.
       Rate limiter is token-bucket, configured in src/middleware/rate-limit.ts.
       Defaults: 10 req/60s per user, 100 req/60s global.
```

When the right agent doesn't exist yet, the orchestrator handles it or tells you.

## Install

```bash
git clone https://github.com/reshadat/officeOs.git
cd officeOs && npm install && npm run build && npm install -g .

officeos install
officeos init myorg
officeos add-agent orchestrator --template orchestrator --org myorg
officeos add-agent analyst     --template analyst     --org myorg
```

Add Slack credentials to `orgs/myorg/agents/orchestrator/.env`, then:

```bash
officeos ecosystem
pm2 start ecosystem.config.js && pm2 save && pm2 startup
```

→ [Full setup guide](SETUP.md) — Slack app, hooks, agent config, Docker, security.

## When to skip

This is overhead if you want a single session. It's for agents you want running when you're not.

No Slack? Run headless (`slack_polling: false`) and use the file bus for inter-agent comms.

---

Adapted from [cortextOS](https://github.com/grandamenium/cortextos) by grandamenium. MIT license.
