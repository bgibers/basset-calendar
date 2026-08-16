# BaRCSE Basset Calendar

This is a Next.js application for submitting basset photos to the BaRCSE calendar.

## Getting Started
Set `NEXT_PUBLIC_SANDBOX=true` for testing

First, install the dependencies:

```bash
pnpm install
```

Then, run the development server:

```bash
pnpm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Legacy cPanel server (photo storage)

Order photos are stored on the legacy cPanel host: our `/api/orders` route forwards
each upload to the old Node endpoint there, which writes it into a `dates/` tree that
is symlinked into the webroot and served at the URL in `IMAGE_BASE_URL`.

SSH access uses the `key_rsa` private key at the repo root. **This repo is public**,
so the key and the connection details (user/host/port) are deliberately kept out of
git: both `key_rsa` and `SERVER-ACCESS.md` are gitignored. See `SERVER-ACCESS.md`
locally for the ssh command and a map of what lives on the server — if you don't
have those two files, get them from Brendan directly, never from the repo.