# Vacation Optimizer

Finds the best shared vacation windows for a group (adults' PTO, federal holidays,
kids' school breaks), ranked by days off per PTO day spent.

## Layout
- `backend/` — Python 3.12 + FastAPI. The optimizer engine lives in `src/vacation_optimizer/`.
- `frontend/` — Next.js + TypeScript (coming later).

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
uv run uvicorn vacation_optimizer.api:app --reload   # API docs at http://127.0.0.1:8000/docs
```

Change the database with a migration, never by hand: edit `orm.py`, then
`uv run alembic revision --autogenerate -m "what changed"`, read the generated file, and `uv run alembic upgrade head`.

## How a request flows
`api.py` (HTTP, validation via `schemas.py`) → `orm.py` rows loaded from Postgres →
`loader.py` converts them → `engine.py` ranks windows → JSON back out.

## Status
- Phase 1 (optimizer engine): done.
- Phase 2 (database + API): tables, first migration, CRUD endpoints, `GET /groups/{id}/windows`.
