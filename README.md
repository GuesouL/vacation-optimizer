# Vacation Optimizer

Finds the best shared vacation windows for a group (adults' PTO, federal holidays,
kids' school breaks), ranked by days off per PTO day spent.

## Layout
- `backend/` — Python 3.12 + FastAPI. The optimizer engine lives in `src/vacation_optimizer/`.
- `frontend/` — Next.js + TypeScript + Tailwind. Types for every API call are generated from the back end's OpenAPI schema.

## Run it
You need PostgreSQL 16 running locally (on a Mac: `brew install postgresql@16 && brew services start postgresql@16`).

```bash
# one-time database setup
psql postgres -c "CREATE USER vacation WITH PASSWORD 'vacation' CREATEDB;"
psql postgres -c "CREATE DATABASE vacation OWNER vacation;"
psql postgres -c "CREATE DATABASE vacation_test OWNER vacation;"

cd backend
uv sync                                  # install dependencies into .venv
uv run alembic upgrade head              # create tables in the dev database
DATABASE_URL=postgresql+psycopg://vacation:vacation@localhost/vacation_test uv run alembic upgrade head
uv run pytest                            # run the tests
cp .env.example .env                     # then fill in API_TOKEN_SECRET
uv run uvicorn vacation_optimizer.api:app --reload --env-file .env   # API docs at http://127.0.0.1:8000/docs
```

Change the database with a migration, never by hand: edit `orm.py`, then
`uv run alembic revision --autogenerate -m "what changed"`, read the generated file, and `uv run alembic upgrade head`.

Then, in a second terminal, start the front end:

```bash
cd frontend
npm install
cp .env.example .env.local   # fill in AUTH_SECRET and the same API_TOKEN_SECRET
npm run dev        # http://localhost:3000
npm test           # date helpers, run in Pacific time on purpose
```

When you change the API, refresh the shared contract so the front end's types match:
`cd backend && uv run python scripts/export_openapi.py && cd ../frontend && npm run gen:api`.
CI fails if you forget.

## Sign-in
Auth.js (in `frontend/src/auth.ts`) signs people in with Google, or with any
email when `AUTH_DEV_LOGIN=true` in development. It then mints a 15-minute token
signed with `API_TOKEN_SECRET`, and the browser sends it as
`Authorization: Bearer ...`. FastAPI checks it in `backend/src/vacation_optimizer/auth.py`
and creates the Account row on first use. Every route except `/health` and
`/holidays` needs it, and you only ever see your own people and groups.

## How a request flows
`api.py` (HTTP, validation via `schemas.py`) → `orm.py` rows loaded from Postgres →
`loader.py` converts them → `engine.py` ranks windows → JSON back out.

## Status
- Phase 1 (optimizer engine): done.
- Phase 2 (database + API): done.
- Phase 4 (in progress): accounts and sign-in; invite and view-only links with owner/member roles and free/busy privacy; kids with a school district calendar (NYC 2026-27 seeded). PTO renewal next.
- Phase 3 (solo UI): onboarding (name, PTO, work week), ranked suggestions with best-value / longest-trip sort, free long weekends, 12-month calendar.
