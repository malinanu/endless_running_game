"""FastAPI application entry point: `uvicorn app.main:app`."""
import os
import secrets
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from .db import init_db
from .routes import router

PUBLIC_DIR = Path(__file__).resolve().parent.parent / "public"


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="Christmas Runner", lifespan=lifespan)
app.add_middleware(
    SessionMiddleware,
    # Without SECRET_KEY a random key is used, so sessions reset on restart.
    secret_key=os.environ.get("SECRET_KEY") or secrets.token_urlsafe(32),
    session_cookie="runner_session",
    max_age=60 * 60 * 24 * 14,
    same_site="lax",
    https_only=os.environ.get("COOKIE_SECURE") == "1",
)
app.include_router(router)


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(PUBLIC_DIR / "index.html")


app.mount("/", StaticFiles(directory=PUBLIC_DIR), name="static")
