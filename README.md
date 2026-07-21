# Google Meet Agent — Production

An autonomous agent that joins Google Meet calls, transcribes speech (mic +
optional tab-audio capture), sends it to an LLM, and speaks the reply back into
the call. This is the **production-grade** version: Supabase-backed multi-tenant
storage + auth, a Vercel-hosted Next.js frontend, and a containerized Puppeteer
agent backend.

## Architecture

```
┌─────────────┐      ┌──────────────┐      ┌─────────────────────┐
│  Vercel     │      │  Supabase    │      │  Agent backend       │
│  (Next.js   │◄────►│  Postgres +  │◄────►│  (Docker/VM, Chrome) │
│   frontend) │ auth │  Auth +      │ data │  - joins Meet        │
│             │      │  Realtime    │      │  - Puppeteer         │
└─────────────┘      └──────────────┘      └─────────────────────┘
       │                     ▲                      │
       └────── API calls ────┘──────────────────────┘
              (browser → backend, Bearer = Supabase JWT)
```

- **Frontend (Vercel):** `web/` — Next.js 14 app. Handles auth (Supabase Auth),
  shows sessions/chat, subscribes to Supabase Realtime for live updates. Talks to
  the agent backend directly using the user's Supabase JWT.
- **Database + Auth (Supabase):** `supabase/schema.sql` — `profiles`, `sessions`,
  `messages`, `schedules` with Row Level Security scoped per `user_id`. Realtime
  enabled on `sessions` + `messages`.
- **Agent backend (your container/VM):** the Express + Puppeteer server at repo
  root. Uses the **service-role key** to read/write sessions/messages on behalf
  of users (scoped by `user_id`). Runs headful Chrome via Xvfb.

> ⚠️ The Puppeteer agent **cannot run on Vercel** (no Chrome/display). It must run
> on a VM/container (Railway, Render, Fly.io, or your own server) with the
> `Dockerfile` provided.

## Prerequisites

1. A Supabase project — copy `supabase/schema.sql` into the SQL editor and run it.
2. OpenRouter (or OpenAI) API key for the LLM. Optional: OpenAI key for Whisper STT.
3. A deploy target for the backend with Docker + a public URL (for the in-page
   transcript/audio callbacks).

## Backend setup (agent container)

```bash
cp .env.example .env
# fill in SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, OPENROUTER_API_KEY, BACKEND_BASE_URL
npm install
npm run build
docker build -t meet-agent .
docker run -p 3000:3000 --env-file .env -v meet-profile:/root/.google_meet_agent meet-agent
```

Or with compose: `docker compose up --build`.

Set `BACKEND_BASE_URL` to the container's public URL (the in-page script posts
transcripts/audio there). Set `SCHEDULER_USER_ID` to a Supabase `auth.users` id
if you use `schedules.json` auto-joins.

## Frontend setup (Vercel)

1. Import the repo into Vercel. Set root/working dir as the repo; `vercel.json`
   points the build at `web/`.
2. Add env vars (see `web/.env.example`):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_API_BASE_URL` → your agent backend's public URL.
3. Deploy.

The browser authenticates with Supabase, then calls the backend with the
Supabase access token as `Authorization: Bearer <jwt>`.

## Local development

```bash
# backend
cp .env.example .env   # add Supabase + OpenRouter keys
npm install && npm run dev

# frontend (separate terminal)
cd web && cp .env.example .env.local && npm install && npm run dev
```

Open the frontend at http://localhost:3000 (or its Vite/Next port), sign up, and
join a meeting. The backend joins via Chrome and streams transcripts/replies into
Supabase; the UI updates live via Realtime.

## API (all require `Authorization: Bearer <supabase_jwt>`)

| Method | Path                        | Description                       |
| ------ | --------------------------- | --------------------------------- |
| GET    | `/api/health`               | Liveness (no auth)                |
| GET    | `/api/sessions`             | List current user's sessions      |
| GET    | `/api/sessions/:id`         | Session + messages                |
| POST   | `/api/sessions`             | Create + join a meeting           |
| POST   | `/api/sessions/:id/leave`   | Leave (close) the meeting tab     |
| DELETE | `/api/sessions/:id`         | Delete a session                  |
| POST   | `/api/sessions/:id/message` | Manual message → LLM → speak      |
| POST   | `/api/transcript`           | In-page speech callback           |
| POST   | `/api/audio`                | In-page tab-audio chunk → STT     |

## Notes

- The in-page `SpeechRecognition` captures the **local mic**. For true
  multi-participant capture, the tab-audio path uses `getDisplayMedia` + Whisper
  (`OPENAI_API_KEY`); the user must tick "Share audio" in the Chrome picker.
- Sessions are scoped per user via RLS; the backend uses the service-role key but
  always filters by the authenticated `user_id`.
