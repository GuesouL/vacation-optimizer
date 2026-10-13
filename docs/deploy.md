# Putting the app online

Goal: a real web address, so a link you send (an invite, or a view-only link) opens for anyone,
not just on your computer.

```
Browser ──► Vercel (the Next.js site, signs people in)
               │  15-minute token, same shared secret
               ▼
            Render (the FastAPI container: runs migrations, then serves)
               │  DATABASE_URL
               ▼
            Neon (Postgres)
```

Three small services instead of one big one, because each does one job and has a free tier:
Vercel is built for Next.js, Render runs any container, Neon is managed Postgres.
You trade a few more dashboards for no servers to maintain.

I can't open those dashboards for you, so the field names below may have moved a little.
The values to enter will not change. Do the steps in order: each one produces a value the next needs.

## 0. Make two secrets (and keep them in a password manager)

```
openssl rand -base64 32     # run twice
```
- `API_TOKEN_SECRET`: one value, entered on **both** Render and Vercel. It is the shared badge-printer key.
- `AUTH_SECRET`: the second value, Vercel only. It encrypts the sign-in cookie.

Use different values from the ones on your laptop. A secret you've typed into a chat or a screenshot is a used secret.

## 1. Database: Neon

1. Create a project (Postgres 16). Copy the **direct** connection string (not the "pooled" one).
   Migrations run through it, and the pooler can interfere with them.
2. It looks like `postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require`.
   Keep `sslmode=require`: it encrypts the connection. The app rewrites the start of the URL to name its
   driver (`db.py: normalize_database_url`), so paste it exactly as given.

## 2. API: Render

1. New **Web Service** from the GitHub repo. Set the **Root Directory** to `backend` and the language to **Docker**
   (it finds `backend/Dockerfile`). If the form asks for the Dockerfile path, use the one that points at that file.
2. Health check path: `/health`.
3. Environment variables:

| Name | Value |
|---|---|
| `DATABASE_URL` | the Neon string from step 1 |
| `API_TOKEN_SECRET` | the shared secret from step 0 |
| `ALLOWED_ORIGINS` | your Vercel address from step 3, e.g. `https://vacation-optimizer.vercel.app` (no trailing slash; separate several with commas). Set it after step 3 and redeploy. |

4. Deploy. On every start the container runs `alembic upgrade head`, then the server. Keep it to **one instance**:
   two copies starting at once would both try to migrate.
5. Check `https://<your-api>.onrender.com/health` returns `{"status":"ok"}`.

The free tier sleeps after a quiet spell, so the first request can take about a minute. That's the cost of free.

## 3. Site: Vercel

1. Import the repo. Set the **Root Directory** to `frontend`. The framework is detected as Next.js.
2. Environment variables:

| Name | Value |
|---|---|
| `AUTH_SECRET` | the second secret from step 0 |
| `API_TOKEN_SECRET` | the same shared secret as Render |
| `NEXT_PUBLIC_API_URL` | your Render address, e.g. `https://vacation-optimizer-api.onrender.com` |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | from Google (step 4) |

Do **not** set `AUTH_DEV_LOGIN`. A production build ignores it anyway, but not setting it is the second lock.

`NEXT_PUBLIC_` values are baked into the page when it is built, so after changing `NEXT_PUBLIC_API_URL`
you must redeploy, not just restart.

## 4. Google sign-in

In the Google Cloud console, on the OAuth client you already made:
- Add the **authorized redirect URI** `https://<your-vercel-address>/api/auth/callback/google`
  (keep the localhost one, Google allows several).
- On the consent screen, either add your friends' emails as **test users**, or **publish** the app.
  Our basic scopes (email, profile) don't need Google's full review.

## 5. Go back and close the loop

Set `ALLOWED_ORIGINS` on Render to the real Vercel address, and redeploy Render. Until then the browser
will block the site from calling the API (CORS), and you'll see failed requests in the browser console.

## 6. Prove it works

1. Open the Vercel address in a **private window** and sign in with Google.
2. Add a partner and a kid, and save a trip.
3. Make an invite link, then open it in a different browser signed in as someone else. Accept it.

If the page says it can't reach the server, open the browser console first: a CORS message means step 5,
a 401 means the two `API_TOKEN_SECRET` values differ, a 500 saying the secret isn't set means Render is missing it.

## What this doesn't cover yet

- Database backups (Neon keeps short history on the free plan; export before anything risky).
- A custom domain. Both Vercel and Render support one; add it, then update the Google redirect URI and `ALLOWED_ORIGINS`.
- Error alerts. Today you'd learn about a crash from a user.
- A staging copy. This is one live copy: test changes on your laptop first.
