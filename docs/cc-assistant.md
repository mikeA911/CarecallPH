# CC — the CareCall assistant

CC is a chat assistant inside the signed-in portal (launcher bottom-right). It:

- answers how-to questions from the **CC wiki** (`docs/cc-wiki/`),
- shows buttons that navigate to the right screen,
- runs guided setups (`wizard-*` wiki pages) one step at a time,
- analyses campaigns with aggregate data,
- files **action items** for clinic admins, worked on the **CC action items** page (`/cc`),
- runs a **nightly review** of every clinic (02:00 Asia/Manila) and posts a summary on `/cc`.

## Architecture

```
Portal (CCPanel) ──POST /cc-chat (user JWT)──► cc-chat edge function
                                                 ├─ system prompt: role, clinic, current screen,
                                                 │  wiki index + overview page
                                                 ├─ Claude tool loop (max 8 rounds)
                                                 │   read_wiki · navigate · list_campaigns
                                                 │   campaign_report · review_queue_summary
                                                 │   list_action_items · create_action_item
                                                 └─ data tools use the CALLER's JWT → RLS scopes to clinic

pg_cron 18:00 UTC ─ cc_nightly_review() ─ one POST per clinic ─► cc-nightly (service role)
                                                 ├─ same tools minus navigate, explicit clinic filters
                                                 ├─ files ≤5 action items (source = nightly)
                                                 └─ summary → cc_reviews (shown at top of /cc)
```

Shared code: `supabase/functions/_shared/cc/` holds `tools.ts`, `claude.ts` (tool
loop) and `wiki.generated.ts`. Because the nightly job bypasses RLS, every tool
query must filter by `ctx.clinicId` explicitly; keep it that way when adding tools.

Guardrails:

- **Clinic isolation comes from Postgres RLS**, not from cc-chat code: every data
  query runs as the signed-in user.
- **Aggregates only**: tools return counts and rates, never names, phones or DOBs.
- **Read-only, except action items**: CC can't change settings, start campaigns or
  contact patients. Navigation buttons are checked against the routes declared
  in wiki pages for the user's role.
- **Usage logged** in `cc_usage` (tokens, tool calls, wiki version) per request.

## Setup

```bash
supabase db push                                   # 20261001010000_cc_assistant.sql
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...  # optional: CC_MODEL=claude-sonnet-5-5
deno run -A scripts/build-cc-wiki.ts
supabase functions deploy cc-chat                  # JWT verification stays ON
supabase functions deploy cc-nightly --no-verify-jwt   # checks the service role key itself
```

The nightly cron reuses the Vault secrets `functions_url` and `service_role_key`
from the campaign scheduler. Turn it off for a clinic with
`update clinics set cc_nightly_enabled = false where id = '…'`. Run one clinic by hand:

```bash
curl -X POST "$FUNCTIONS_URL/cc-nightly" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" -d '{"clinic_id":"<uuid>"}'
```

## Keeping the wiki current

Every feature PR updates the wiki. See `docs/cc-wiki/README.md` for the page format.

1. Edit or add `docs/cc-wiki/<id>.md` (exact on-screen labels, routes in frontmatter).
2. Add a line to `docs/cc-wiki/changelog.md`.
3. `deno run -A scripts/build-cc-wiki.ts` and commit the generated file.
4. Redeploy `cc-chat`.

CI (`.github/workflows/cc-wiki.yml`) fails the PR if the wiki is invalid or the
generated bundle is stale.

## Next steps

- Persist conversations server-side so admins can review what CC was asked.
- Prefill for wizards (e.g. open New campaign with fields filled from the chat).
- Retrieval over the wiki once it outgrows the prompt index (currently ~4k tokens).
