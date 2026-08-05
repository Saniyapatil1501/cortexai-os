# CortexAI Production Operations Guide

This guide details the architecture, setup instructions, security practices, and deployment guidelines for running CortexAI in a production-ready desktop environment.

## 1. System Architecture

CortexAI operates as a hybrid desktop-local daemon application:

- **Frontend**: Single-Page React App built with Vite, TypeScript, and TanStack Start, hosted inside an Electron wrapper.
- **Backend Daemon**: Locally running FastAPI web server utilizing SQLModel (SQLite) for database storage and psutil/win32 APIs for background window active state tracking.
- **Authentication**: Clerk OAuth / JWT verified locally on the daemon via JWKS signatures.
- **LLM Integration**: Native Google Generative AI SDK (Gemini-2.0-Flash) with asynchronous streaming.

```
┌────────────────────────────────────────┐
│             Electron Window            │
│  ┌──────────────────────────────────┐  │
│  │         Vite / React UI          │  │
│  └──────────────────┬───────────────┘  │
└─────────────────────┼──────────────────┘
                      │ Local HTTP + JWT
                      ▼
┌────────────────────────────────────────┐
│             FastAPI Server             │
│  ┌───────────────┐  ┌────────────────┐ │
│  │  SQLModel/DB  │  │ Window Tracker │ │
│  └───────────────┘  └────────────────┘ │
└────────────────────────────────────────┘
```

---

## 2. Environment Setup

### Frontend (.env)
Create a `.env` file in the root of the project:
```env
# Clerk Publishable Key (from dashboard)
VITE_CLERK_PUBLISHABLE_KEY=pk_live_...

# Frontend API Connection URL
VITE_API_URL=http://127.0.0.1:8000/api

# Node Mode
NODE_ENV=production

# Optional Sentry DSN
VITE_SENTRY_DSN=
```

### Backend (backend/.env)
Create a `.env` file in the `backend` folder:
```env
HOST=127.0.0.1
PORT=8000
DATABASE_URL=sqlite:///cortexai.db

# Gemini API Key (Google AI Studio)
GEMINI_API_KEY=AIzaSy...

# Clerk Issuer URL (Clerk Dashboard -> API Keys -> Advanced)
CLERK_ISSUER=https://...
CLERK_JWKS_URL=https://.../.well-known/jwks.json

# Optional Sentry DSN
SENTRY_DSN=
```

---

## 3. Packaging & Distribution

### Windows Packaging (Electron Builder)

1. Compile the React and Electron assets:
   ```bash
   npm run build
   ```
2. Build the distribution installer:
   ```bash
   npm run electron:build
   ```
   This compiles `electron/main.ts` into `dist-electron/main.js`.
3. To package the app as an executable installable file:
   Use `electron-builder` to package it.
   ```bash
   npx electron-builder --win
   ```
   The installer will be generated under the `dist/` directory.

### Python Backend Packaging
To package the local Python backend alongside Electron, you can compile the Python server into a single executable using `pyinstaller` and bundle it inside Electron's extraResources:
1. Compile backend:
   ```bash
   cd backend
   pyinstaller --onefile main.py
   ```
2. Configure `electron-builder` `extraResources` in `package.json` to copy the generated binary to the packaged output directory.

---

## 4. Security Overview

CortexAI adheres to strict desktop security principles:
- **No Node.js Integration in Renderer**: `nodeIntegration` is disabled, and `contextIsolation` is enabled in `electron/main.ts`.
- **Content Security Policy (CSP)**: An explicit CSP header in the root routing prevents cross-site scripting (XSS) and unauthorized network leaks.
- **Secure Key Storage**: All critical AI keys (`GEMINI_API_KEY`) and Clerk credentials (`CLERK_SECRET_KEY`) reside exclusively in the backend `.env` variables and are never bundled or exposed to the renderer client.
- **SQL Injection Prevention**: SQLModel ORM executes parameterized queries for database operations.
- **Security Headers**: Standard HTTP headers (`X-Frame-Options`, `X-Content-Type-Options`) are configured on FastAPI middleware responses.

---

## 5. Troubleshooting

- **FastAPI Daemon Fails to Boot**:
  Ensure port `8000` is free. You can check it or change it in `backend/.env`.
- **Clerk Authentication Fails to Verify**:
  Verify that `CLERK_ISSUER` or `CLERK_JWKS_URL` is set correctly and the backend machine has network access to fetch the JWKS public keys.
- **Sentry Event Reporting Fails**:
  Ensure the `SENTRY_DSN` is set and resolves correctly. Check the server output logs for Sentry init warnings.
