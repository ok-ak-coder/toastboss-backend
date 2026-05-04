# ToastBoss Scheduler

A standalone mobile-first scheduler app for Toastmaster clubs.

- `ToastBoss` is the UI shell.
- `EquiToast Engine` is the scheduling and scoring core.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Run frontend development server:
   ```bash
   npm run dev:frontend
   ```
3. Run backend development server:
   ```bash
   npm run dev:backend
   ```

## WordPress integration

- Install the `idtt-child` folder as a child theme of Astra and activate it.
- Build the frontend assets to populate `idtt-child/toastboss-app`.
- Create a WordPress page with slug `toastboss` and assign the `ToastBoss App` template.
- Set `TOASTBOSS_API_BASE_URL` in WordPress if the backend API is not exposed at `/toastboss-api`.
- The app is mounted at `https://idtttoastmasters.com/toastboss` and uses hash-based SPA routes to avoid WordPress rewrite conflicts.
