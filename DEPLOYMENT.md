# Deploying Christmas Runner to CloudPanel

This guide puts the game on a CloudPanel server for testing. Every push to `main`
is deployed automatically by GitHub Actions. Setup uses only the **CloudPanel web UI** and
**GitHub's website**. You never need a terminal on the server.

```
push to main ─► GitHub Actions ─► run tests
                               └► copy the code to the server over SSH (as the site user)
                                  ├─ install Python packages
                                  ├─ switch "current" to the new version and restart the game
                                  └─ if it doesn't start: switch back automatically and fail
Phone/browser ─► CloudPanel Nginx (HTTPS) ─► 127.0.0.1:8090 game server
CloudPanel cron job (every minute) ─► restarts the game if it ever stops (crash, reboot)
```

Replace these placeholders as you go:

| Placeholder | Example |
| --- | --- |
| `DOMAIN` | `runner.example.com` |
| `SITE_USER` | `xmasrunner` (the site user you choose in CloudPanel) |
| `SERVER_IP` | `203.0.113.10` |

---

## Part 1: CloudPanel (web UI)

### 1. Point the domain at the server
At your DNS provider, add an **A record**: `DOMAIN → SERVER_IP`.

### 2. Create the site
**Sites → + Add Site → Create a Python Site**, then fill in:

| Field | Value |
| --- | --- |
| Domain Name | `DOMAIN` |
| Python Version | 3.11 or newer |
| App Port | `8090` |
| Site User / Password | `SITE_USER` and a strong password |

Click **Create**. CloudPanel makes the folder `/home/SITE_USER/htdocs/DOMAIN` and sets Nginx to forward
visitors to port 8090. Nothing answers on that port yet. The first deploy takes care of that.

### 3. HTTPS
Open the site → **SSL/TLS** → **Actions → New Let's Encrypt Certificate** → **Create and Install**.
(Wait until DNS from step 1 is live.)

### 4. Let GitHub log in as the site user
GitHub Actions needs an SSH key to copy the code. Create the key pair **on your own computer**. On Windows,
macOS and Linux it's the same command in PowerShell or Terminal:

```bash
ssh-keygen -t ed25519 -f christmas-runner-deploy -N "" -C "github-actions"
```

This makes two files:
- `christmas-runner-deploy.pub` is the **public** key and goes into CloudPanel.
- `christmas-runner-deploy` is the **private** key and goes into GitHub (step 6). Keep it secret.

In CloudPanel open the site → **SSH/FTP** → under **SSH Users**, edit `SITE_USER`, or click
**Add User** if you prefer a separate deploy user for this site. Paste the whole content of
`christmas-runner-deploy.pub` into **SSH Keys** and save.

---

## Part 2: GitHub (website)

### 5. Make `main` the default branch
Repo → **Settings → General → Default branch** → `main`.

### 6. Add the deployment settings
Repo → **Settings → Environments → New environment** → name it **`cloudpanel-test`**.
Optionally tick **Required reviewers** and add yourself, so each deploy waits for your click.

Under **Environment secrets → Add secret**:

| Secret | Value |
| --- | --- |
| `SSH_HOST` | `SERVER_IP` (or a hostname that points to it) |
| `SSH_USER` | `SITE_USER` (or the SSH user from step 4) |
| `SSH_PRIVATE_KEY` | the whole content of `christmas-runner-deploy`, including the `-----BEGIN…` / `-----END…` lines |
| `APP_DIR` | `/home/SITE_USER/htdocs/DOMAIN` |
| `SECRET_KEY` | any long random text, e.g. 50+ random letters and digits. Keeps players signed in. |
| `SSH_PORT` | *(optional)* only if SSH isn't on port 22 |
| `SSH_KNOWN_HOSTS` | *(optional, recommended)* the server's SSH fingerprint. Get it on your computer with `ssh-keyscan SERVER_IP`. Without it, the workflow trusts whatever key the server shows and logs a warning. |

Under **Environment variables → Add variable**:

| Variable | Value |
| --- | --- |
| `APP_URL` | `https://DOMAIN` (the workflow checks this after each deploy) |
| `APP_PORT` | *(optional)* only if you used an App Port other than `8090` |
| `COOKIE_SECURE` | *(optional)* set to `0` only while testing without HTTPS |

### 7. First deploy
Repo → **Actions → Deploy to CloudPanel → Run workflow** (branch `main`). After this, every push or
merge to `main` deploys by itself. The run shows each step, and the environment link opens the site.

---

## Part 3: back in CloudPanel

### 8. Keep the game running (cron job)
Open the site → **Cron Jobs → Add Cron Job**:

| Field | Value |
| --- | --- |
| Schedule | every minute: `*` `*` `*` `*` `*` |
| Command | `bash /home/SITE_USER/htdocs/DOMAIN/current/deploy/run.sh ensure` |

Every minute this checks the game answers and starts it if not, for example after a server reboot or
a crash. When everything is fine it does nothing.

### 9. Open it on your phone
Visit `https://DOMAIN`. On the phone you can use **Add to Home Screen** for a full-screen, app-like game.

### Optional: faster loading on phones
Open the site → **Vhost**. Paste the blocks from [`deploy/nginx-static.conf`](deploy/nginx-static.conf)
inside the `server { … }` block that has `listen 443`, **above** the existing `location / {` block.
Replace `SITE_USER` and `DOMAIN`, then **Save**. Nginx then serves the 3D models and textures
directly, compressed and cached.

### Optional: your logo on the cap
Open the site → **File Manager** → go to `htdocs/DOMAIN/shared/brand/` → **Upload** your logo named
**`scan-logo.png`** (transparent PNG). It's applied on the next deploy. To apply it now,
re-run the last deploy in GitHub Actions.

---

## Everyday use

| You want to… | Do this |
| --- | --- |
| Deploy | Merge or push to `main`. |
| Deploy again without changes | GitHub → Actions → Deploy to CloudPanel → **Run workflow**. |
| Go back to an older version | GitHub → Actions → open an older successful deploy run → **Re-run all jobs**. |
| See the game's log | File Manager → `htdocs/DOMAIN/shared/logs/app.log` |
| Back up scores and accounts | File Manager → `htdocs/DOMAIN/shared/data/runner.db` → **Download** |
| Change the secret key or port | Edit the secret / variable in GitHub, then re-run the deploy. |

### What's in the site folder

```
htdocs/DOMAIN/
├── current -> releases/<version>   the version being served
├── releases/                       the last 3 versions (older ones are removed)
└── shared/                         kept across deploys
    ├── app.env                     settings written by the deploy (from your GitHub secrets)
    ├── venv/                       Python packages
    ├── data/runner.db              accounts and scores
    ├── brand/                      your logo
    └── logs/app.log                game server log
```

### How the pieces fit
- **`.github/workflows/ci.yml`** runs on every push and pull request: API tests, a JavaScript syntax
  check, and a check of the deploy scripts.
- **`.github/workflows/deploy.yml`** runs on pushes to `main` and when you press **Run workflow**.
  It runs the same checks, uploads the code to `releases/<version>`, writes `shared/app.env`, and runs
  `deploy/activate.sh`.
- **`deploy/activate.sh`** prepares Python, installs packages and copies your logo into the release.
  It switches `current` and restarts the game. If the game doesn't answer within 20 seconds, it
  switches back to the previous version and the workflow fails.
- **`deploy/run.sh`** starts, stops and checks the game (`start`, `stop`, `restart`, `ensure`, `status`).
  It runs as the site user. No root, sudo or systemd is needed.

---

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Deploy fails at **Configure SSH** with "Missing secret …" | The named secret isn't in the `cloudpanel-test` environment. Check the spelling, and that it's an *environment* secret. |
| **Permission denied (publickey)** | The public key isn't saved on the SSH user in CloudPanel (step 4), `SSH_USER` doesn't match that user, or the private key secret is incomplete (it must include the BEGIN/END lines). |
| **Host key verification failed** | `SSH_KNOWN_HOSTS` is outdated. Run `ssh-keyscan SERVER_IP` again and update it, or delete the secret. |
| **Activate release** fails with "new release failed its health check" | The game didn't start. The previous version is still running. The error and the last log lines are in the step output and in `shared/logs/app.log`. |
| "python3 -m venv unavailable, using uv" in the log | Normal on some servers. The script installs `uv` for the site user and continues. |
| **502 Bad Gateway** in the browser | The game isn't running, or CloudPanel's App Port differs from `APP_PORT` (default 8090). Check the cron job (step 8) and the port in the site's **Settings**. |
| **Check the public site** fails but **Activate** passed | DNS or SSL isn't ready yet, or the App Port mismatch above. |
| Signed out right after signing in | You're on `http://` while `COOKIE_SECURE` is on. Use `https://`, or set the variable `COOKIE_SECURE=0` for testing. |
| Everyone signed out after each deploy | `SECRET_KEY` secret is missing. Add it and re-deploy. |
| Game stuck on the loading bar | If you added the Vhost snippet, check its paths point to `…/htdocs/DOMAIN/current/public`. |
