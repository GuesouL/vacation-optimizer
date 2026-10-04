# Vacation Optimizer front end

Next.js (App Router) + TypeScript + Tailwind. See the root README for how to run it.

- `src/app/page.tsx`: onboarding (name, PTO balance, work week)
- `src/app/plan/page.tsx`: ranked suggestions and the year calendar
- `src/lib/dates.ts`: plain-date helpers ("YYYY-MM-DD" strings, all math in UTC)
- `src/lib/api.ts`: typed API client; `api-types.ts` is generated, don't edit it by hand

Set `NEXT_PUBLIC_API_URL` to point at a deployed API (defaults to http://localhost:8000).
