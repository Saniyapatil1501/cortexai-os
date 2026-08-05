# Contributing to CortexAI

Thank you for your interest in contributing to CortexAI! Follow these steps and guidelines to help you get started.

## Getting Started

1. **Fork and Clone**: Fork the repository on GitHub and clone your fork locally.
2. **Setup Environments**:
   - For the frontend: Run `npm install` in the root directory.
   - For the backend daemon: Run `pip install -r backend/requirements.txt` in a virtual environment (`backend/venv`).
3. **Environment Keys**: Create `.env` in the root and `backend/.env` using the provided `.env.example` templates.
4. **Run Development Mode**:
   - Start the FastAPI backend: `python backend/main.py`
   - Start the Electron app: `npm run dev`

## Code Standards

- **TypeScript**: Keep all component styling clean. Do not add random utilities or break the custom matte-black aesthetic.
- **Python**: Follow PEP 8 styles. Use SQLModel type assertions for database records.
- **Security**: Never hardcode keys or secrets. Keep `.env` files completely ignored by git.
- **Testing**: Before submitting a PR, verify the production build via `npm run build:dev` or `npm run build`.

## Pull Request Guidelines

1. Create a new branch: `git checkout -b feature/your-feature-name`.
2. Commit your changes with clear messages.
3. Push to your branch and open a Pull Request.
4. Fill out the provided Pull Request template in full detail.
