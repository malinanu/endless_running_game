"""REST API: authentication, score submission and leaderboard."""
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field, StrictInt

from .auth import current_user, hash_password, login_session, require_user, verify_password
from .db import get_db

router = APIRouter(prefix="/api")

MAX_SCORE = 10_000_000


class Credentials(BaseModel):
    username: str = Field(min_length=3, max_length=20, pattern=r"^[A-Za-z0-9_]+$")
    password: str = Field(min_length=6, max_length=72)


class LoginBody(BaseModel):
    username: str = Field(max_length=20)
    password: str = Field(max_length=72)


class ScoreBody(BaseModel):
    score: StrictInt = Field(gt=0, le=MAX_SCORE)


def _user_payload(user: sqlite3.Row) -> dict:
    return {"success": True, "user": {"id": user["id"], "username": user["username"]}}


@router.post("/auth/register")
def register(body: Credentials, request: Request, db: sqlite3.Connection = Depends(get_db)):
    try:
        cur = db.execute(
            "INSERT INTO users (username, password_hash) VALUES (?, ?)",
            (body.username, hash_password(body.password)),
        )
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="Username already taken")
    login_session(request, cur.lastrowid)
    return {"success": True, "user": {"id": cur.lastrowid, "username": body.username}}


@router.post("/auth/login")
def login(body: LoginBody, request: Request, db: sqlite3.Connection = Depends(get_db)):
    user = db.execute(
        "SELECT id, username, password_hash FROM users WHERE username = ?", (body.username,)
    ).fetchone()
    if user is None or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    login_session(request, user["id"])
    return _user_payload(user)


@router.post("/auth/logout")
def logout(request: Request):
    request.session.clear()
    return {"success": True}


@router.get("/auth/me")
def me(user: sqlite3.Row | None = Depends(current_user)):
    if user is None:
        return {"authenticated": False}
    return {"authenticated": True, "id": user["id"], "username": user["username"]}


@router.post("/scores")
def submit_score(
    body: ScoreBody,
    user: sqlite3.Row = Depends(require_user),
    db: sqlite3.Connection = Depends(get_db),
):
    db.execute("INSERT INTO scores (user_id, score) VALUES (?, ?)", (user["id"], body.score))
    best = db.execute("SELECT MAX(score) FROM scores WHERE user_id = ?", (user["id"],)).fetchone()[0]
    return {"success": True, "personalBest": best}


@router.get("/leaderboard")
def leaderboard(limit: int = Query(10, ge=1, le=50), db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute(
        """
        SELECT u.username, MAX(s.score) AS high_score, MIN(s.recorded_at) AS first_at
        FROM scores s
        JOIN users u ON s.user_id = u.id
        GROUP BY s.user_id
        ORDER BY high_score DESC, first_at ASC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()
    return [
        {"rank": i + 1, "username": r["username"], "score": r["high_score"]}
        for i, r in enumerate(rows)
    ]
