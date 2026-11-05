# Cappture

Cappfinity's internal time capture tool. Log time against client projects in a minute a week; see who spent what, where.

## Stack

- **Front end** — Vite + React, deployed on Netlify (`netlify.toml` handles SPA routing)
- **Back end** — Supabase: Postgres with Row Level Security, Auth (magic link now, Microsoft Entra next), Edge Functions for reminders and Outlook sync (phase 2)
- Schema lives in `supabase/migrations/` and is applied to the `Cappture` project

## Roles

| Role | Sees | Can |
| --- | --- | --- |
| Member | Own time | Log, edit and remove own entries |
| Manager | Own team's time | Everything a member can, plus Reports for their team and manual reminders |
| Admin | Everything | Projects, allocations, work types, people, settings, rates |

The first person to sign in becomes admin. Anyone with an allowed email domain (default `cappfinity.com`) arrives as a member; invited people get the role and team on their invite; everyone else waits for approval.

## Local development

```bash
cp .env.example .env   # fill in the publishable key
npm install
npm run dev
```

## Phase 2 (not yet built)

- Microsoft Entra sign-in and `Calendars.Read` consent
- Outlook → `calendar_suggestions` sync (match on project code in subject, then attendee domain)
- Friday nudge / Monday chase emails via pg_cron + Edge Function
- Optional weekly submit + manager approval
