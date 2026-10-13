# The API as one container, so the same image runs on Render, Fly.io or your laptop.
FROM python:3.12-slim

# uv is the project's package manager. Copying its single binary beats installing it with pip.
COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /usr/local/bin/uv

# Never run a web server as root: if someone breaks in, they land with no powers.
RUN useradd --create-home app
WORKDIR /app
RUN chown app:app /app
USER app

ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1

# Dependencies first, code second. Docker caches each step, so a code change reuses
# the slow install instead of redoing it (like leaving the lift up between jobs).
COPY --chown=app:app pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

COPY --chown=app:app alembic.ini ./
COPY --chown=app:app migrations ./migrations
COPY --chown=app:app src ./src
RUN uv sync --locked --no-dev

# Bring the database up to date, then serve. `exec` hands the process to uvicorn so it
# gets the host's stop signal. PORT is set by the host; 8000 is for running it by hand.
# This runs migrations on every start, which is safe for one copy of the server.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn vacation_optimizer.api:app --host 0.0.0.0 --port ${PORT:-8000}"]
