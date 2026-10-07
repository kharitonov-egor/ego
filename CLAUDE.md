# Ego

Personal Electron + TypeScript + React + Tailwind desktop app for Windows, plus the same screens
in the browser at ego.kharitonovegor.com. Single user: me.

## Rules

- No `any`. Use `unknown` plus narrowing, generics, or unions.
- Do not run `npm run build`, `npm run dev`, `npx electron-vite build`, or `vite build`. I run those
  myself, and Vercel builds the web app.
  `npm run typecheck` is fine.
- Secrets go in `.env.local` only. The repo is public. Never commit a key or token.
- Comments only for non-obvious reasons. No comments restating the code.

## Architecture

The screens live in `packages/ui` and talk to their host only through `window.api`, the `IpcApi`
type in `packages/ui/src/platform/types.ts`. The desktop implements it in
`apps/desktop/src/preload/index.ts` with handlers in the main process, which owns the network calls
and settings. The web app implements it in `apps/web/src/api.ts`. Adding a call means touching
four files: the type, the preload binding, the main handler, and the web implementation. Check
`isWeb()` in `packages/ui/src/lib/platform.ts` before showing something only the desktop can do.

Overlay windows (`quick-add.html`, `notification.html`) are plain HTML with inline styles so they
paint without booting a bundle. Keep them that way. New entries must be registered in
`electron.vite.config.ts` under `renderer.build.rollupOptions.input`.
