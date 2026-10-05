"""Password hashing and session helpers."""
import sqlite3

import bcrypt
from fastapi import Depends, HTTPException, Request

from .db import get_db

BCRYPT_ROUNDS = 10


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=BCRYPT_ROUNDS)).decode()


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode(), password_hash.encode())


def login_session(request: Request, user_id: int) -> None:
    request.session.clear()
    request.session["user_id"] = user_id


def current_user(request: Request, db: sqlite3.Connection = Depends(get_db)) -> sqlite3.Row | None:
    user_id = request.session.get("user_id")
    if user_id is None:
        return None
    user = db.execute("SELECT id, username FROM users WHERE id = ?", (user_id,)).fetchone()
    if user is None:
        request.session.clear()
    return user


def require_user(user: sqlite3.Row | None = Depends(current_user)) -> sqlite3.Row:
    if user is None:
        raise HTTPException(status_code=401, detail="Not signed in")
    return user
