# 🎄 Christmas Runner

A festive 3D endless runner built with **Three.js** on the front end and **FastAPI + SQLite** on the back end. Players can register, sign in, save scores and compete on a Top‑10 leaderboard with gold / silver / bronze highlighting for the top three.

3D models are from the free [KayKit](https://kaylousberg.itch.io/) packs by Kay Lousberg (CC0); see `public/assets/licenses/`.

## Run it

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
SECRET_KEY=change-me uvicorn app.main:app --reload
# open http://localhost:8000
```

| Env var | Default | Purpose |
| --- | --- | --- |
| `SECRET_KEY` | random per start | Signs the session cookie. Set it so sessions survive restarts. |
| `DB_PATH` | `data/runner.db` | SQLite database file (created on start-up). |
| `COOKIE_SECURE` | unset | Set to `1` behind HTTPS to mark the session cookie `Secure`. |

Run the API tests with `pytest`.

## How to play

| Input | Action |
| --- | --- |
| `Space` / `↑` / `W`, tap, swipe up | Jump over presents, logs, coal, snow drifts and snowmen |
| `↓` / `S`, swipe down | Slide under icicle gates (in the air: drop fast, then slide) |
| `P` / `Esc` | Pause |
| `M` | Toggle sound |

Score is the distance run plus 25 per gold bar. Speed rises 5% every 200 points, forever.

## Project layout

```
app/
  main.py      FastAPI app, session middleware, static files
  db.py        SQLite connection + schema (users, scores, indexes)
  auth.py      bcrypt hashing, session helpers, auth dependencies
  routes.py    /api/auth/*, /api/scores, /api/leaderboard
public/
  index.html   game canvas, HUD, menus, auth modal, leaderboard overlay
  css/style.css
  js/game.js         Three.js runner (parallax, spawning, physics, collisions)
  js/auth.js         sign-in / register / logout + modal
  js/leaderboard.js  fetch + render with top-3 styling
  js/audio.js        WebAudio jingle and sound effects (no audio files)
  assets/            curated KayKit models (player, environment, obstacles)
  vendor/three/      three.js r170 + GLTFLoader (served locally, no CDN)
tests/test_api.py
```

## API

| Method & path | Body | Response |
| --- | --- | --- |
| `POST /api/auth/register` | `{username, password}` | `{success, user: {id, username}}` (409 if taken) |
| `POST /api/auth/login` | `{username, password}` | `{success, user}` (401 on bad credentials) |
| `POST /api/auth/logout` | – | `{success: true}` |
| `GET /api/auth/me` | – | `{authenticated, id?, username?}` |
| `POST /api/scores` | `{score}` (signed in) | `{success, personalBest}` |
| `GET /api/leaderboard?limit=10` | – | `[{rank, username, score}]` (best score per player, limit 1–50) |

Usernames are 3–20 letters, digits or underscores (case-insensitive unique); passwords are 6–72 characters and stored as bcrypt hashes (10 rounds). Sessions are signed, HTTP-only cookies.

## Game notes

- **Parallax:** sky, aurora, mountains and village scroll at 0.2×, pines and lamps at 0.5×, the track and obstacles at 1.0×.
- **Obstacles:** low ones (presents, log stacks, coal, snow drifts, snowmen) need a jump; icicle gates need a slide. Gaps scale with speed so reaction time stays fair.
- **Game over:** the score is posted when signed in, then the Top 10 is shown with your row highlighted. Guests can sign in from the game-over screen and the run they just finished is saved.
