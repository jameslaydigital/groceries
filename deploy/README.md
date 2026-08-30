# Deploying Syncart to a Linode (native)

Syncart runs **natively** on a small Linode: `systemd` runs the Node server,
Caddy terminates TLS/reverse-proxies, and a cron takes nightly SQLite backups.
No Docker needed — the app has zero runtime npm dependencies (`node:sqlite` is
built into Node).

The `Dockerfile` + `docker-compose.yml` in this repo remain as an alternative
path if you ever want containers, but the Linode is set up native.

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
Environment=BASE_DOMAIN=yourdomain.com
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

4. Replace the Caddyfile with `deploy/Caddyfile` (uses `{$BASE_DOMAIN}` and
   `{$DIGITALOCEAN_API_TOKEN}`/`{$LINODE_API_TOKEN}` env vars — adjust the DNS
   module name if needed), and `systemctl reload caddy`.
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
