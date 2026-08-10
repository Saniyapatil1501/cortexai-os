# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2026-05-24

### Added

- Standardized Bug Report and Feature Request Issue Templates.
- Pull Request Template and Contributing Guidelines.
- Sentry SDK error reporting on both React and FastAPI.
- Robust exception-safe retry loop for Gemini streaming responses.
- Local timezone detection and timezone-aware analytics calculations.

### Changed

- Refactored `authedFetch` to throw explicit HTTP errors for non-2xx statuses.
- Configured security headers (`X-Frame-Options`, `nosniff`, HSTS) on the backend daemon.
- Re-routed search bar autocomplete prompt submissions to prevent history loading race conditions.
- Enabled SQLite WAL (Write-Ahead Logging) and Normal synchronous modes for better multi-threaded database access.

### Fixed

- Fixed Pomodoro timezone countdown misalignment.
- Fixed chat history reloading/wiping issues upon page sync or navigation.
