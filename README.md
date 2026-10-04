# Vacation Optimizer

Finds the best shared vacation windows for a group (adults' PTO, federal holidays,
kids' school breaks), ranked by days off per PTO day spent.

## Layout
- `backend/` — Python 3.12 + FastAPI. The optimizer engine lives in `src/vacation_optimizer/`.
- `frontend/` — Next.js + TypeScript (coming later).

## Run it
```bash
cd backend
uv sync                      # install dependencies into .venv
uv run pytest                # run the tests
uv run uvicorn vacation_optimizer.api:app --reload   # API at http://127.0.0.1:8000/docs
```

## Status
Phase 1 (optimizer engine): federal holiday generator, engine, and the 12 edge-case tests pass.
