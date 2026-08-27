# Ego

Personal Electron + TypeScript + React + Tailwind desktop app for Windows. Single user: me.

## Rules

- No `any`. Use `unknown` plus narrowing, generics, or unions.
- Do not run `npm run build`, `npm run dev`, or `npx electron-vite build`. I run those myself.
  `npm run typecheck` is fine.
- Secrets go in `.env.local` only. The repo is public. Never commit a key, token, or webhook URL.
- Comments only for non-obvious reasons. No comments restating the code.

## Architecture

Main process owns all network calls and settings. The renderer talks to it only through the
`IpcApi` surface defined in `src/shared/types.ts` and implemented in `src/preload/index.ts`.
Adding an IPC call means touching three files: the type, the preload binding, and the main handler.

Overlay windows (`quick-add.html`, `notification.html`) are plain HTML with inline styles so they
paint without booting a bundle. Keep them that way. New entries must be registered in
`electron.vite.config.ts` under `renderer.build.rollupOptions.input`.
