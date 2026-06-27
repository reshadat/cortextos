# officeOs Hardening Plan (revised, 6-phase)

Supersedes the single-"Phase 0" plan, which mixed routing + delivery + authz + cron + storage + docs into one chunk so no invariant was independently provable. This breaks it into reviewable increments, each proving one guarantee.

## Threat model (trusted shared office)

1 owner + a few trusted colleagues, one host / daemon / org. No attacker, but:
- Shared model history is **acceptable**.
- Cross-thread routing and merged turns are **not**.
- Delivery is **at-least-once**; duplicate processing must be **idempotent**.
- **Open contract decision (gates everything): is readonly-mutation-prevention advisory or enforced?**

### The core contradiction to resolve first

"Only the owner may authorize mutations" cannot coexist with "readonly is prompt-level only." A readonly user reaches a full-power session; blocking `allow`/`deny` does NOT stop the agent performing a mutation that needs no interactive approval. Pick one:
- **(A)** Downgrade the invariant: "only the owner can approve *prompted* actions; colleagues are otherwise trusted." (Trusted-team default; honest.)
- **(B)** Implement hard principal-bound tool restrictions now (real RBAC). Bigger; only if confidentiality/enforcement is required.

## Corrections folded in (from review)

- **Serialization = turn ordering, not context isolation.** Name it accurately.
- **No per-agent "current request" marker** — it recreates the latest-state bug. Hooks must receive the triggering `request_id` *directly*, else post unthreaded to a dedicated owner control-channel.
- **Never "preserve owner role" after a readonly reply.** Store **immutable root principal** + **actual message actor** separately; a readonly actor must never inherit owner authority. (Reverts the role-no-downgrade change on the current branch.)
- **"Accepted on model-turn start" needs a real detectable event** — PTY paste is not acceptance. Don't claim it otherwise.
- **Cron "success" needs completion correlation.** Until then rename to `dispatched`; outcome `unknown`.
- **Fix the lock primitive (stale-takeover is itself race-unsafe) before** using it for tasks/reminders.
- **HMAC enforcement is its own phase** (needs every writer — incl. dashboard — migrated first).
- **Mock-only E2E cannot validate** crash-after-paste, runtime hook attribution, or model-turn acceptance — those need a real PTY/daemon harness.

---

## Phase 0 — Contract + regression harness

Lock the definitions above (incl. the readonly A/B decision). Build deterministic tests for: Alice/Bob interleaving; hook attribution; same thread / different actors; Slack redelivery; repeated Telegram text; crash at each delivery boundary. (Mock-seam where possible; a minimal real-PTY harness for the crash/attribution/turn-start cases the mock can't reach.)

## Phase 1 — Correlation correctness (eliminates the thread-id sibling class)

- `request_id` **mandatory** for replies; bound exactly to (transport, channel, thread).
- `send-slack` **default-deny**.
- Carry `request_id` **directly** into hooks; dedicated unthreaded owner channel when correlation is absent.
- Store **root principal + message actor** separately.
- `ask-state` **per-id**.
- **Persist** owner-approved channels.

## Phase 2 — Durable ingress + serialized turns

Small persistent queue (not full v2 WorkItem): `queued → leased → submitted → completed/expired`.
- Persist **before** transport ACK. Dedup by Slack event id / Telegram update-msg id.
- Inject **one conversation item at a time**; serialize **every** PTY writer (cron + IPC included).
- Renew leases while processing; requeue after crash before completion; idempotency by occurrence/request id.
- Do **not** claim "accepted" unless the runtime exposes a reliable turn-start event.

## Phase 3 — Atomic state + attribution

- Repair the lock primitive with **ownership tokens**.
- Approval resolution via **atomic claim/CAS**.
- Lock task + reminder read-modify-write.
- Record `initiated_by`, `executed_by`, `resolved_by`; attribute dashboard actions to the authenticated session user.

## Phase 4 — Cron correctness

- Vixie DOM/DOW semantics; defined timezone/DST behavior; implement or remove one-shot.
- Route cron occurrences through the serialized queue.
- Distinguish `dispatched / acknowledged / completed / failed`; test overlap + restart policy explicitly.

## Phase 5 — Security hygiene

- Canonically sign the **full** bus envelope; reject unsigned once all writers migrated.
- Fence slash-command **and** fetched thread-context consistently.
- Document the trusted-team threat model honestly.

## Parked (v2)

Confidential per-conversation execution; hard capability gateway (unless readonly enforcement required now); dashboard RBAC + org membership; `(org,agent)` namespaces; full WorkItem/dead-letter; multi-host transactional storage; daemon lease (unless PM2 can start duplicate daemons); the channel-adapter abstraction refactor.

---

## Status on the current branch `feat/phase0-hardening-routing`

Consistent with Phase 1/5, keep: `send-slack` default-deny + strict `--request-id`↔conversation match; PTY-fence broadening (SLACK header + `officeos bus` verbs) + thread-context sanitize.
**Revert:** `reply-targets.ts` role-no-downgrade (replace with immutable-root-principal + actor) and the planned per-agent current-request marker.
