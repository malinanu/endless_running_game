# Deploying Christmas Runner to CloudPanel

This guide puts the game on a CloudPanel server for testing, with GitHub Actions
deploying automatically every time `main` changes.

```
push to main ──► GitHub Actions: tests ──► SSH to server ──► deploy/deploy.sh
                                                            ├─ git reset to origin/main
                                                            ├─ pip install into .venv
                                                            ├─ systemctl restart christmas-runner
                                                            └─ wait for /api/health
Browser ──► Nginx (CloudPanel vhost, HTTPS) ──► 127.0.0.1:8090 uvicorn (FastAPI + SQLite)
```

Throughout this guide, replace:

| Placeholder | Example | What it is |
| --- | --- | --- |
| `DOMAIN` | `runner.example.com` | The test site's domain |
| `SITE_USER` | `xmasrunner` | The site user CloudPanel creates for the site |
| `SERVER_IP` | `203.0.113.10` | Your server's public IP |

Commands marked **(root)** run as root; **(site user)** run as `SITE_USER`
(`sudo -iu SITE_USER` from a root shell, or SSH in as that user).

---

## 1. One-time setup

### 1.1 Point the domain at the server

At your DNS provider, add an **A record** `DOMAIN → SERVER_IP` (and `AAAA` if you use IPv6).

### 1.2 Create a Python site in CloudPanel

1. CloudPanel → **Sites → Add Site → Create a Python Site**.
2. Fill in:
   - **Domain Name**: `DOMAIN`
   - **Python Version**: 3.11 or newer
   - **App Port**: `8090` (any free port works; keep it consistent below)
   - **Site User** / password: choose `SITE_USER`
3. Click **Create**. CloudPanel creates `/home/SITE_USER/htdocs/DOMAIN` and an Nginx
   vhost that forwards requests to `127.0.0.1:8090`. CloudPanel does not start Python
   apps itself; the systemd service in step 1.5 does that.
4. Site → **SSL/TLS → Actions → New Let's Encrypt Certificate** (once DNS has propagated).

### 1.3 Server packages (root)

```bash
apt update && apt install -y git python3-venv curl
command -v systemctl   # note the path; the sudo rule below assumes /usr/bin/systemctl
```

### 1.4 Get the code onto the server (site user)

```bash
sudo -iu SITE_USER
cd ~/htdocs
rm -rf DOMAIN && git clone -b main https://github.com/malinanu/endless_running_game.git DOMAIN
```

If the repository is **private**, use a read-only deploy key instead of HTTPS:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/github_deploy -N "" -C "SITE_USER@DOMAIN (read-only)"
cat ~/.ssh/github_deploy.pub
# GitHub → repo → Settings → Deploy keys → Add deploy key → paste, leave "Allow write access" OFF
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/github_deploy
  IdentitiesOnly yes
EOF
ssh-keyscan github.com >> ~/.ssh/known_hosts
cd ~/htdocs && rm -rf DOMAIN && git clone -b main git@github.com:malinanu/endless_running_game.git DOMAIN
```

Create the virtualenv and the settings file:

```bash
cd ~/htdocs/DOMAIN
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
mkdir -p ~/.config ~/data
cp deploy/christmas-runner.env.example ~/.config/christmas-runner.env
chmod 600 ~/.config/christmas-runner.env
python3 -c "import secrets; print(secrets.token_urlsafe(48))"   # copy this into SECRET_KEY
nano ~/.config/christmas-runner.env   # set SECRET_KEY, replace SITE_USER in DB_PATH, check PORT
```

Set `COOKIE_SECURE=0` until the SSL certificate is in place, then switch it to `1`.

### 1.5 Run it as a service (root)

Set your values once, then paste the rest as-is:

```bash
SITE_USER=xmasrunner            # your site user
DOMAIN=runner.example.com       # your domain
cd /home/$SITE_USER/htdocs/$DOMAIN

sed -e "s/SITE_USER/$SITE_USER/g" -e "s/DOMAIN/$DOMAIN/g" deploy/christmas-runner.service \
  > /etc/systemd/system/christmas-runner.service
systemctl daemon-reload
systemctl enable --now christmas-runner
systemctl status christmas-runner --no-pager
curl -s http://127.0.0.1:8090/api/health      # → {"status":"ok"}
```

Allow the site user to restart the service, and nothing else, so deploys can run without root:

```bash
sed "s/SITE_USER/$SITE_USER/g" deploy/sudoers-christmas-runner > /tmp/christmas-runner.sudoers
visudo -cf /tmp/christmas-runner.sudoers && install -m 440 /tmp/christmas-runner.sudoers /etc/sudoers.d/christmas-runner
sudo -iu "$SITE_USER" sudo -n /usr/bin/systemctl restart christmas-runner && echo "sudo rule OK"
```

Open `https://DOMAIN` on your phone. The game should load.

### 1.6 Optional: let Nginx serve the static files

Phones load the 3D models and textures faster when Nginx serves them directly. In CloudPanel →
Sites → `DOMAIN` → **Vhost**, paste the blocks from `deploy/nginx-static.conf` inside the
`server { … }` that listens on 443, above the existing `location / { … }` block. Replace
`SITE_USER` / `DOMAIN` and save. CloudPanel validates and reloads Nginx.

### 1.7 Connect GitHub Actions

1. **A key for GitHub Actions to log in with (site user):**

   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/gh_actions -N "" -C "github-actions deploy"
   cat ~/.ssh/gh_actions.pub >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys
   cat ~/.ssh/gh_actions        # private key, goes into the SSH_PRIVATE_KEY secret
   ```

   CloudPanel's firewall must allow SSH (port 22 by default) from the internet, since GitHub's
   runners have changing IPs.

2. **The server's host key (from your own computer):**

   ```bash
   ssh-keyscan -p 22 SERVER_IP     # goes into the SSH_KNOWN_HOSTS secret
   ```

3. GitHub → repo → **Settings → Environments → New environment** named `cloudpanel-test`,
   then add:

   | Type | Name | Value |
   | --- | --- | --- |
   | Secret | `SSH_HOST` | `SERVER_IP` (or a hostname) |
   | Secret | `SSH_PORT` | `22` (optional; defaults to 22) |
   | Secret | `SSH_USER` | `SITE_USER` |
   | Secret | `SSH_PRIVATE_KEY` | contents of `~/.ssh/gh_actions` |
   | Secret | `SSH_KNOWN_HOSTS` | output of `ssh-keyscan` above |
   | Secret | `APP_DIR` | `/home/SITE_USER/htdocs/DOMAIN` |
   | Variable | `APP_URL` | `https://DOMAIN` |

   Optionally add yourself under **Required reviewers** so each deploy waits for your approval.

4. Make `main` the default branch (Settings → General → Default branch).

---

## 2. Everyday use

| You want to… | Do this |
| --- | --- |
| Deploy | Merge or push to `main`. Watch **Actions → Deploy to CloudPanel**. |
| Re-deploy without changes | Actions → Deploy to CloudPanel → **Run workflow**. |
| Deploy by hand | `sudo -iu SITE_USER` → `cd ~/htdocs/DOMAIN && bash deploy/deploy.sh` |
| See logs | `journalctl -u christmas-runner -f` (root) |
| Restart | `sudo systemctl restart christmas-runner` |
| Roll back | `cd ~/htdocs/DOMAIN && git reset --hard <old-commit> && sudo systemctl restart christmas-runner`, then revert the bad commit on `main` so the next deploy doesn't bring it back |

### What the workflows do

- **`.github/workflows/ci.yml`** runs on every push (except `main`) and every pull request:
  API tests (`pytest`), a syntax check of every JavaScript module, and `shellcheck` on the deploy script.
- **`.github/workflows/deploy.yml`** runs on pushes to `main` and on demand. It runs the same checks,
  then SSHes in as `SITE_USER`, runs `deploy/deploy.sh`, and finally checks `APP_URL/api/health`.
  Deploys never overlap.

`deploy/deploy.sh` resets the code to `origin/main`, installs dependencies into `.venv`, restarts the
service and waits for `/api/health`. If the app doesn't come up, it prints the service status and the
exact rollback command, and the workflow fails.

### Data and files that survive deploys

- **Database**: `DB_PATH` (default `~/data/runner.db`) lives outside the code folder, so deploys never
  touch it. Back it up with:

  ```bash
  sqlite3 ~/data/runner.db ".backup '$HOME/data/runner-$(date +%F).db'"
  ```

  (`apt install sqlite3` if needed.) A CloudPanel cron job can run this daily.
- **Brand logo**: copy it to `~/htdocs/DOMAIN/public/assets/brand/scan-logo.png`. Untracked files are
  kept by `git reset --hard`, so it stays across deploys.
- **Settings**: `~/.config/christmas-runner.env`. Edit it, then restart the service.

---

## 3. Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| **502 Bad Gateway** | The service isn't running or the port differs from CloudPanel's App Port. Check `systemctl status christmas-runner` and that `PORT` in the env file matches the App Port. |
| Deploy fails at `sudo -n … restart` with "a password is required" | The sudoers rule isn't installed, or `systemctl` lives at a different path; check `command -v systemctl` and fix the path in `/etc/sudoers.d/christmas-runner`. |
| Deploy fails at SSH with "Host key verification failed" | `SSH_KNOWN_HOSTS` is missing or stale. Re-run `ssh-keyscan` and update the secret. |
| Deploy fails with "Permission denied (publickey)" | The public key isn't in `SITE_USER`'s `~/.ssh/authorized_keys`, or `SSH_USER` is wrong. |
| `git fetch` fails on the server | For a private repo, check the deploy key (section 1.4). |
| Sign-in works but you're logged out immediately | `COOKIE_SECURE=1` without HTTPS. Install the certificate or set it to `0` for plain HTTP testing. |
| Everyone is logged out after each deploy | `SECRET_KEY` is empty, so a random key is used per start. Set it in the env file. |
| Game stuck on the loading bar | Open the browser console. If you added the Nginx static block, check the `root` path points at `…/htdocs/DOMAIN/public`. |
| Slow on phones | Add the Nginx static block (gzip + caching). The game also drops effects automatically on slow devices. `?lowfx` forces low effects. |

Useful checks on the server:

```bash
curl -s http://127.0.0.1:8090/api/health            # app itself
curl -sI https://DOMAIN/ | head -1                   # through Nginx
journalctl -u christmas-runner --since "10 min ago"  # recent logs
```
