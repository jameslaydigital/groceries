# Deploying Syncart to a Linode (native)

Syncart runs **natively** on a small Linode: `systemd` runs the Node server,
Caddy terminates TLS/reverse-proxies, and a cron takes nightly SQLite backups.
No containers — the app has zero runtime npm dependencies (`node:sqlite` is
built into Node).

## 1. Provision the Linode

- A `g6-nanode-1gb` (1 vCPU / 1GB / 25GB, ~$5/mo) is plenty.
- Add your SSH key. Boot Ubuntu LTS.

## 2. First-boot config (already done on this box)

```bash
# as root:
useradd -m -s /bin/bash deploy
echo 'deploy ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/90-syncart-deploy
chmod 440 /etc/sudoers.d/90-syncart-deploy
# install deploy's ~/.ssh/authorized_keys, then:
apt update && apt full-upgrade -y
apt install -y nodejs npm caddy        # or node via nodesource for a pinned version
hostnamectl set-hostname syncart
```

Verify `node -v` ≥ 22 (needs built-in `node:sqlite`) and `caddy version`.

## 3. App + systemd service

```bash
sudo mkdir -p /opt/syncart && sudo chown deploy:deploy /opt/syncart
# copy the repo (rsync from your machine, or git clone)
cd /opt/syncart && npm ci && npm run build
```

`/etc/systemd/system/syncart.service`:

```ini
[Unit]
Description=Syncart grocery list server
After=network.target

[Service]
User=deploy
Group=deploy
WorkingDirectory=/opt/syncart
Environment=NODE_ENV=production
Environment=PORT=8787
Environment=COOKIE_DOMAIN=.yourdomain.com
Environment=COOKIE_SECURE=1
# Before DNS is wired up, a bare host/IP maps to the default family:
Environment=DEFAULT_HOSTS=23.239.29.165
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now syncart
```

## 4. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

Keep `8787` closed — only Caddy talks to it.

## 5. Caddy

### Before a domain exists (interim)

Serve plain HTTP on port 80 so you can use the box by IP:

```
:80 {
	reverse_proxy 127.0.0.1:8787
}
```

Also set `DEFAULT_HOSTS=<your-ip>` so the IP resolves to the default `home`
family. Leave `COOKIE_SECURE` off until TLS is on (browsers reject Secure
cookies over HTTP).

### Once you have a domain

1. Point DNS at the box: `yourdomain.com` A `→ <ip>` and `*.yourdomain.com` A `→ <ip>` (Linode DNS panel).
2. Generate a Linode API token with **DNS** scope — Caddy needs it to mint the wildcard cert via DNS-01.
3. Caddy's stock binary lacks DNS providers, so build one with the Linode module
   (either on the box with Go, or locally) and replace `/usr/bin/caddy`:

   ```bash
   xcaddy build --with github.com/caddy-dns/linode
   ```

4. Replace the Caddyfile with `deploy/Caddyfile` (uses `{$BASE_DOMAIN}`,
   `{$ACME_EMAIL}`, and `{$LINODE_API_TOKEN}` env vars), and
   `systemctl reload caddy`.
5. Enable `COOKIE_SECURE=1` + `COOKIE_DOMAIN=.yourdomain.com` in the service and restart.

## 6. Backups

```bash
# in /etc/cron.d/syncart
0 3 * * * deploy cd /opt/syncart && BACKUP_DIR=/opt/syncart/backups KEEP_BACKUPS=30 npm run backup --silent
```

`npm run backup` snapshots `platform.db` + every family DB via `VACUUM INTO`,
retaining the newest `KEEP_BACKUPS`. Manually: `npm run backup`.

## 7. Day-to-day

- **Deploy an update:** `git pull && npm ci && npm run build && sudo systemctl restart syncart`
- **Provision a family:** `node scripts/create-family.mjs create james "The James Family"`
- **Known test login:** `node scripts/setup.mjs` (creates/resets `dev@example.com` / `devpassword` on the default family).

## Notes

- **Single instance only.** The SSE broadcast is in-memory; don't run multiple
  replicas without adding pub/sub.
- After enabling TLS, force clients to HTTPS by removing the `:80` plain site
  from Caddy.

---

## Current live box (as of Aug 2026)

| | |
|---|---|
| Host | **Linode `g6-nanode-1gb`** (1 vCPU / 1GB / 25GB), Ubuntu 26.04, hostname `syncart` |
| Public IP | **23.239.29.165** |
| Access | `ssh syncart` (laptop `~/.ssh/config` → user `deploy`, key `~/.ssh/id_syncart_deploy`) |
| App | `/opt/syncart`, built, `systemd` unit `syncart.service`, binds `127.0.0.1:8787` |
| Proxy | Caddy 2.6.2 (apt), reverse-proxies `:80` → `127.0.0.1:8787`. Interim Caddyfile is a plain `:80` proxy (no TLS yet). |
| Data dir | `/opt/syncart/families` + `/opt/syncart/platform.db` (no env override; defaults) |
| Known login | `dev@example.com` / `devpassword` (admin of `home`), from `npm run setup` |

**Security posture (applied):** root SSH disabled (`PermitRootLogin no`),
password auth off (key-only), root password locked, fail2ban active (sshd
jail), UFW allows only 22/80/443, app bound to loopback, unattended-upgrades
on, systemd hardening on the service (`NoNewPrivileges`, `ProtectSystem=full`,
etc.). The `deploy` user keeps **blanket passwordless sudo** by choice — the SSH
private key is treated as the trust boundary.

**Interim access without a domain:** `DEFAULT_HOSTS=23.239.29.165` maps the raw
IP to the `home` family, so `http://23.239.29.165` works today (HTTP, no
Secure cookies).

**Not done yet — the domain/TLS step:**
1. Register a domain; point `yourdomain.com` + `*.yourdomain.com` A records → 23.239.29.165.
2. Create a Linode API token (DNS scope) for Caddy's wildcard cert.
3. Build a Caddy with `github.com/caddy-dns/linode` (`xcaddy build --with ...`) and replace `/usr/bin/caddy`.
4. Set `COOKIE_DOMAIN=.yourdomain.com`, `COOKIE_SECURE=1` in `syncart.service`; swap the Caddyfile for the TLS version (`deploy/Caddyfile`).

