> Calendar superseded by the user on 12/11/2026: see `2026-11-12-evaluation-first-of-month.md`. Final schedule is day 1 at 08:00 VN, assessment window 1–5, previous-month target on web and Zalo.

# Enable monthly Zalo evaluation reminders

User requests automatic group notification on day27 like existing leave Zalo messages. Existing scheduler, sender and durable company/month claim already implement delivery but feature defaults off and claim schema needs a separate preparation step. Reuse those flows; do not create another cron, send-per-web-user trigger or provider implementation.

Decision: default ZALO_EVAL_REMINDER_ENABLED to true (global ZALO_ENABLED remains false unless already configured). Preserve an explicit false deployment override. Enabled, configured background worker prepares/validates ONLY the existing reminder-claim table transactionally using the frozen migration schema checker and PostgreSQL advisory lock. No OAuth/business-table creation or alembic_version changes. Incompatible schemas fail closed. Direct run_due stays read-only about schemas. Existing manual preparation tool remains usable.

Keep08:00 on27, Asia/Ho_Chi_Minh; existing5-minute checks/catch-up during27 and restart remain. Same company/OA/group as leave notifications, one durable claim per company/month across workers/restarts. Do not replay ambiguous failed HTTP sends or rewrite old claim records. Correct reminder link to /peer-review (actual voting tab) using trusted configured origin. Web notifications unchanged.

No production access/runtime secrets are provided in this task. Ship code+env example+runbook on main under existing workflow; actual live deployment is performed by user. Clearly mention old explicitfalse env must switchtrue and backend recreate; never claim live activation/send. Tests use disposable databases + fake provider only; no live group test today.

- [x] Observe RED for default-on activation, worker preparing before sender and incompatible schema fail-closed, preserved claims/version/OAuth tables, and correct voting link.
- [x] Implement config/schema preparation/worker/link, retain explicit disable and existing at-most-once guarantees.
- [x] Fullbackend suite468/468 passed; targeted58/58 passed. Independent scoped review found no actionable P1/P2. Runbook/env example updated; integrate through authorized push workflow.

Schema preparation avoids Alembic's process-global operations context in concurrent scheduler threads; it only loads the frozen checker and uses transactional table creation. PostgreSQL uses the same advisory-lock key as the existing migration/helper. Disabled/unconfigured workers do not create the schema; malformed existing schemas do not reach the sender. No provider API or frontend behavior change beyond the corrected destination. No real group messages or production deployment performed.
