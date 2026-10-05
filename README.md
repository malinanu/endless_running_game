# 🎄 Christmas Runner

A festive 3D endless runner built with **Three.js** on the front end and **FastAPI + SQLite** on the back end. Players can register, sign in, save scores and compete on a Top‑10 leaderboard with gold / silver / bronze highlighting for the top three.

3D models are from the free [KayKit](https://kaylousberg.itch.io/) packs by Kay Lousberg (CC0) and effects textures from the Brackeys VFX bundle (CC0); see `public/assets/licenses/`.

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

To put it on a CloudPanel server with automatic deploys from GitHub Actions, see [DEPLOYMENT.md](DEPLOYMENT.md).

## How to play

Built mobile-first (portrait phones); keyboards work too.

| Phone | Keyboard | Action |
| --- | --- | --- |
| Swipe left / right | `←` `→` / `A` `D` | Switch lanes |
| Swipe up or tap | `Space` / `↑` / `W` | Jump over presents, logs, coal, drifts, snowmen, rolling snowballs |
| Swipe down | `↓` / `S` | Slide under icicle gates (in the air: drop fast, then slide) |
| Pause button | `P` / `Esc` | Pause |
| Bell button | `M` | Toggle sound |

Score is the distance run plus 10 per peanut. Speed rises 5% every 200 points, forever, and the
obstacle mix gets harder with each level: more blocked lanes, back-to-back rows and giant
snowballs that roll toward you. The road winds left and right and climbs over hills and crests.

On phones the game can be added to the home screen (PWA manifest, full screen, portrait),
keeps the screen awake while running, vibrates on crashes and speed-ups, and automatically
drops bloom / resolution if the frame rate is low (`?lowfx` forces low effects).

### Brand logo

Put a transparent PNG at `public/assets/brand/scan-logo.png` to show it on the back of the
runner's cap and on the menus (see `public/assets/brand/README.md`). It is optional and not
included in the repository.

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
  js/game.js         runner: lanes, spawning, physics, collisions, camera, HUD
  js/world.js        track chunks (snow path, rope bridge, stone plaza) and scenery
  js/curve.js        road shape: turns, climbs and crests via a vertex-shader bend
  js/vfx.js          instanced particle / flipbook effects
  js/auth.js         sign-in / register / logout + modal
  js/leaderboard.js  fetch + render with top-3 styling
  js/audio.js        WebAudio jingle and sound effects (no audio files)
  assets/            curated KayKit models and Brackeys VFX textures (CC0)
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
| `GET /api/brand` | – | `{logo}`: URL of the optional brand logo, or `null` |

Usernames are 3–20 letters, digits or underscores (case-insensitive unique); passwords are 6–72 characters and stored as bcrypt hashes (10 rounds). Sessions are signed, HTTP-only cookies.

## Game notes

- **Road:** recycled 24-unit chunks; a procedural road plan bends the world in the vertex shader so the straight three-lane gameplay reads as a winding, hilly path.
- **Obstacles:** low ones (presents, log stacks, coal, snow drifts, snowmen, fallen logs) need a jump or a lane change; icicle gates and garland arches need a slide. Every row leaves a reachable open lane, and gaps scale with speed so reaction time stays fair.
- **Game over:** the score is posted when signed in, then the Top 10 is shown with your row highlighted. Guests can sign in from the game-over screen and the run they just finished is saved.
