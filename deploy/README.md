# Deploying to a DigitalOcean Droplet with Caddy

One 1GB Droplet runs everything: the Node app, Caddy (TLS + reverse proxy), and
nightly SQLite backups. SQLite files live on the Droplet's disk via a Docker
volume.

## 1. Create the Droplet

- DigitalOcean → Droplets → **Ubuntu 24.04**, **Basic / 1GB / 25GB** (~$6/mo).
- Add your SSH key so you can log in.

## 2. Point DNS at the Droplet

In your DNS provider (DigitalOcean DNS or wherever the domain lives), create two
**A records** pointing at the Droplet's public IP:

```
example.com     A  <droplet-ip>
*.example.com   A  <droplet-ip>
```

The wildcard is what makes `home.example.com`, `james.example.com`, etc. all
work. If the domain is hosted in DO's DNS panel, Caddy will be able to manage
certificates for it too.

## 3. Create a DigitalOcean API token

Caddy needs a token to prove ownership of `*.example.com` (the Let's Encrypt
DNS-01 challenge). In the DO dashboard: **API → Tokens → Generate New Token**,
scope it to **DNS** only, and copy it.

## 4. Install Docker on the Droplet

```bash
ssh root@<droplet-ip>
curl -fsSL https://get.docker.com | sh
```

## 5. Get the code on the box

```bash
git clone git@github.com:jameslaydigital/groceries.git /opt/groceries
cd /opt/groceries
```

## 6. Configure and launch

```bash
cd deploy
cp .env.example .env
$EDITOR .env          # BASE_DOMAIN, ACME_EMAIL, DIGITALOCEAN_API_TOKEN
docker compose up -d --build
```

Caddy will fetch a wildcard certificate automatically on first request (takes a
minute). Watch it with `docker compose logs -f caddy`.

## 7. First login & data

The first visitor to `home.example.com` can sign up and becomes admin — or
provision a known account and sample data from the container:

```bash
docker compose exec app node scripts/setup.mjs
docker compose exec app node scripts/create-family.mjs create james "The James Family"
```

## 8. Backups & maintenance

- The `backup` service snapshots all databases into the persistent volume every
  24h, keeping the newest 30 (set `KEEP_BACKUPS` to change).
- Manual snapshot: `docker compose exec app npm run backup`.
- Restore: copy a `families/*.db` + `platform.db` out of the volume
  (`docker compose cp` or `docker run` a shell on it) and replace the live ones
  with the app stopped.

## Notes & gotchas

- **Do not scale `app` to more than one replica.** The SSE broadcast is
  in-memory (one process). If you ever need multiple instances, add pub/sub
  (Redis) first.
- `COOKIE_SECURE=1` is already set — sessions are `Secure`/`HttpOnly`/`SameSite=Lax`.
- Upgrade: `git pull && docker compose up -d --build`. The service-worker cache
  name is versioned per build, so clients pick up changes without stale caches.
- Droplet disk is ephemeral across a rebuild — keep a `.env` backup and run the
  `npm run backup` snapshots somewhere off-box if you care about disaster
  recovery.
