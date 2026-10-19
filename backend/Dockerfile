FROM python:3.13.16-slim-bookworm AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Dependency changes invalidate this layer; application edits reuse it.
COPY requirements.txt ./requirements.txt
RUN python -m pip install --no-cache-dir -r requirements.txt \
    && python -m pip check

RUN groupadd --gid 10001 tracker \
    && useradd --uid 10001 --gid tracker --create-home --shell /usr/sbin/nologin tracker

COPY app/ ./app/

USER tracker:tracker

# This target runs the existing integration suite against the Compose database.
FROM base AS test
COPY tests/ ./tests/
CMD ["python", "-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py", "-v"]

# The default final image runs the API.
FROM base AS runtime
COPY docker/healthcheck.py ./healthcheck.py
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=8s --start-period=10s --retries=5 CMD ["python", "/app/healthcheck.py"]
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
