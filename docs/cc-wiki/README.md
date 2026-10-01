# CC wiki

This folder is the knowledge base for **CC**, the CareCall assistant inside the
portal. CC answers questions, walks users through workflows and analyses
campaigns using only these pages plus live (aggregate) data from its tools.

**Rule: a feature isn't done until its wiki page is updated.** If CC can't read
about it, CC will tell users it doesn't exist.

## How it gets to CC

```
docs/cc-wiki/*.md ──(deno run -A scripts/build-cc-wiki.ts)──► supabase/functions/_shared/cc/wiki.generated.ts
```

Commit the generated file and redeploy `cc-chat`. CI runs
`deno run -A scripts/build-cc-wiki.ts --check` and fails if the generated file
is stale.

## Page format

```markdown
---
id: campaigns                    # unique, lowercase, used by read_wiki
title: Campaigns
summary: One line CC reads in its index to decide whether to open the page.
roles: staff                     # minimum role: staff | clinic_admin | admin
routes:                          # pages CC may navigate to (path | min role | label)
  - /campaigns | staff | Campaigns
  - /campaigns/:id | staff | Campaign detail
updated: 2026-10-01
---

Body in plain markdown.
```

## Writing for CC

- Write facts, not marketing. CC repeats what it reads.
- Use the exact on-screen labels ("Start calling", "Review queue") so CC's
  directions match the UI.
- Put step-by-step workflows under a `## Steps` heading with the route for each
  step. CC uses these to guide users.
- Say plainly what the app can't do yet. CC should say "not yet" rather than
  invent a workaround.
- Never put patient data, secrets or credentials in a page.
- Add a line to `changelog.md` for every user-visible change.
