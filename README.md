## Video Editing Project

Desktop-first video editing app built with React, Express, Python (Whisper), and Electron.

This repository contains a complete local workflow for:
- user authentication with session cookies
- timeline-based editing (visual, audio, subtitle tracks)
- subtitle generation with OpenAI Whisper
- exporting MP4 output with FFmpeg

## Architecture

The app runs as 4 cooperating services/processes:

1. `frontend/` (React + Vite, default `http://localhost:5173`)
2. `backend/` (Express API, default `http://localhost:3000`)
3. `python/` (Flask Whisper service, default `http://localhost:5001`)
4. `electron/` (desktop shell that loads the frontend)

Data flow:
- Frontend calls backend HTTP APIs.
- Backend stores users/projects/media metadata in MongoDB.
- Backend stores uploaded/exported files under `storage/`.
- Backend calls Python service for transcription.
- Backend spawns FFmpeg for export jobs.

## Current Feature Set

- Email/password signup and signin
- Session-based auth persisted in MongoDB (`connect-mongo`)
- Media import in UI (video, audio, image, subtitle)
- Timeline editing with:
  - drag/drop track placement
  - clip move/trim
  - snapping guides
  - overlap protection within a track
- Autosave project state to MongoDB (`/api/projects/current`)
- Subtitle generation pipeline (`/api/media/upload` -> `/api/subtitles/generate`)
- Export pipeline with progress polling and download endpoint

## Repository Layout

```text
video-editing-project/
├── backend/                 # Express API + MongoDB models/services
├── frontend/                # React editor UI (single large App.jsx)
├── python/                  # Flask Whisper transcription service
├── electron/                # Electron main process + preload
├── storage/                 # Uploaded files and export outputs
├── KT.md                    # Deep knowledge-transfer document
├── README.md
└── .gitignore
```

## Prerequisites

- Node.js 18+ (recommended: current LTS)
- npm
- Python 3.10+
- MongoDB running locally (or reachable by URI)
- FFmpeg installed and available in `PATH`

## Environment Variables

Set these in root `.env` (loaded by backend):

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PORT` | no | `3000` | Backend port |
| `MONGO_URI` | yes | none | MongoDB connection URI |
| `SESSION_SECRET` | yes | `dev_secret_change_me` fallback exists | Session signing secret |
| `FRONTEND_ORIGIN` | no | `http://localhost:5173` | Allowed CORS origin(s), comma-separated |
| `NODE_ENV` | no | `development` | Cookie security behavior |
| `PYTHON_SERVICE_URL` | no | `http://localhost:5001` | Backend -> Python service URL |

Python service also reads:
- `PYTHON_SERVICE_PORT` (default `5001`)

## Install

From the repository root:

```bash
npm --prefix backend install
npm --prefix frontend install
npm --prefix electron install
python3 -m venv .venv
source .venv/bin/activate
pip install -r python/requirements.txt
```

## Run (Web Mode)

Use 4 terminals:

1. MongoDB
```bash
mongod
```

2. Backend
```bash
npm --prefix backend run dev
```

3. Python service
```bash
source .venv/bin/activate
python python/app/main.py
```

4. Frontend
```bash
npm --prefix frontend run dev
```

Open `http://localhost:5173`.

## Run (Electron Mode)

Start MongoDB, backend, and Python service first, then:

```bash
npm --prefix electron run dev
```

This starts Vite and opens Electron once the frontend server is ready.

For production-style desktop launch (after frontend build):

```bash
npm --prefix frontend run build
npm --prefix electron run desktop
```

## API Overview

### Auth
- `POST /api/auth/signup`
- `POST /api/auth/signin`
- `GET /api/auth/me`
- `POST /api/auth/logout`

### Projects
- `GET /api/projects/current`
- `PUT /api/projects/current`

### Media
- `POST /api/media/upload` (multipart, key: `file`)

### Subtitles
- `POST /api/subtitles/generate` (body: `{ mediaId }`)

### Export
- `POST /api/export` (body: `{ timelineClips }`)
- `GET /api/export/:exportId/status`
- `GET /api/export/:exportId/download`

## Storage and Persistence

- MongoDB:
  - users (`users`)
  - one project per user (`projects`)
  - media metadata (`media`)
  - sessions (`sessions`)
- Filesystem:
  - uploads: `storage/uploads/<userId>/...`
  - exports: `storage/exports/<userId>/...`

## Known Implementation Notes

- Frontend keeps actual `File` objects in browser memory; persisted project data stores metadata only.
- Export currently uses primary clips (first visual, first audio) plus subtitle timeline for rendering.
- Electron IPC handlers exist as placeholders (`electron/main/ipc/*.js` are empty).
- `frontend/src/App.jsx` contains most UI/editor logic in one file (~1600 lines).

## Troubleshooting

- `Cannot reach backend`:
  - check backend is running on `PORT` (`3000` by default)
  - verify `VITE_API_URL` if using custom API URL
- `Subtitle generation failed`:
  - ensure Python service is running on `PYTHON_SERVICE_URL`
  - ensure Whisper dependencies installed in active venv
- `Export failed` or FFmpeg spawn errors:
  - verify `ffmpeg -version` works in terminal
- No preview for some videos on Linux:
  - install required codecs/libraries (for example FFmpeg/GStreamer packages)

## Additional Project Notes

For a deeper technical walkthrough and extension guidance, see `KT.md`.
