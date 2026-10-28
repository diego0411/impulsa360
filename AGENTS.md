# AGENTS.md

## Project shape
- React Native 0.81 + Expo 54 app, written in JS (no app TS). Entry: `index.js` -> `App.js`.
- Android-first field app for activation capture with offline sync; backend is Supabase. UI, copy, and domain fields are in Spanish (Bolivia, `America/La_Paz`).
- No navigation library is used in practice: `@react-navigation/*` is installed but never imported in app code. `App.js` switches screens from the `vistaActiva` state and renders a custom tab bar. Screens live in `components/`; there are no route files.
- `android/` and `ios/` are committed native projects. Android has custom Kotlin modules (`ExitInfoModule`, `ImageDownsamplerModule`) registered manually in `MainApplication.kt`.
- `App.js` is a very large monolith (~90 KB) on purpose. Extend its existing hooks/guards rather than splitting or rewriting flows.

## Commands
- `npm install`
- `npm start` / `npm run android` / `npm run ios` / `npm run web`
- `npm run lint` (ESLint Expo config; only `dist/` ignored)
- Tests: **no `npm test` script exists**. Run `node --test` (discovers `tests/*.test.js`) or one file: `node --test tests/offlinePin.test.js`.
- Tests use Node's built-in `node:test` plus `@babel/core` to transform RN/Expo modules with stubs. Do not introduce Jest unless migrating the suite.
- There is no useful typecheck: `npx tsc --noEmit` errors with TS18003 because sources are JS and `tsconfig.json` only includes `**/*.ts(x)`.
- Android verification: `npx expo-doctor`, `npm run preflight:android`.
- Release build: `npm run build:android:aab` (loads `.env`, runs preflight, then `:app:bundleRelease`). Artifact: `android/app/build/outputs/bundle/release/app-release.aab`.
- `eas.json` exists but is not the release path used here: production has `appVersionSource: "remote"` + `autoIncrement: true`, which would bypass the gradle.properties versioning described below. Stick to the local Gradle flow unless EAS is explicitly requested.

## Config and release gotchas
- `lib/config.js` reads only `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` at bundle time. The `app.json` `expo.extra.supabase*` fallback only satisfies preflight; it is not read at runtime. If env vars are missing, `lib/supabase.js` silently uses a no-op stub.
- Release version is read from `android/gradle.properties` (`android.versionCode`, `android.versionName`). `app.json` also carries `version`/`versionCode`; keep both in sync and bump `versionCode` every release.
- Release signing comes from `ANDROID_RELEASE_*`, Gradle properties, or git-ignored `android/keystore.properties`; Gradle fails without it unless `-Pandroid.allowDebugSigningInRelease=true`. Never commit `.env`, keystores, or `releases/`.
- There is no CI or pre-commit configuration; run lint and tests locally before handing off.

## Architecture invariants
- Local persistence: use `lib/secureLocalStorage.js` (XChaCha20-Poly1305, key in SecureStore; plaintext on web) and `lib/storage.js` (`formularios_offline_v1`, corruption-aware `leerFormulariosLocalesSeguro`). Do not write form/session data directly to AsyncStorage.
- Offline sync is `sincronizarFormularios` in `App.js`: session/network/edit-active guards, eligibility RPC before photos, photo matrix from `lib/reglasFotografias.js`, upload, then upsert to `activaciones` with `onConflict: 'id'` and local cleanup. Preserve the single-sync guard and retry semantics.
- Photos: `lib/upload.js` persists pending files in `activaciones-pendientes`, enforces 6 MB / 12 MP limits, and reserves each storage path for one writer. Changes here require the invariants in `tests/uploadProtection.test.js`.
- Camera capture (`components/CameraEvidencia.js` + `lib/cameraCaptureFlow.js`): on Android, `CameraView` (SurfaceView) must stay mounted during the photo preview — the preview is an opaque overlay on the same tree position. Unmounting the camera and mounting `Image` in one commit caused the blank-modal regression (build 81). iOS still unmounts on capture. Decision helpers (`mantenerCamaraMontadaEnPreview`, `camaraReutilizableEnPreview`) are pure and covered in `tests/cameraCaptureFlow.test.js`; "Repetir" reuses the live instance or remounts exactly one. Don't reintroduce unmount-on-capture on Android.
- Testable domain logic lives in `lib/*.js`; RN-dependent libs (`upload`, `storage`, `telemetry`…) are loaded in tests through `@babel/core` + `node:module` stubs (see `tests/uploadProtection.test.js`). App logic belongs in those modules, not in components: `components/` (and `App.js`) are RN shells with no test runner.
- `metro.config.js` replaces Node `ws` with a throwing shim; do not import Node WebSocket libraries into app code.
- Supabase migrations under `supabase/migrations/` are not proof of remote state. Controlled apply/rollback/verify scripts live in `supabase/manual/`; never assume a migration was applied and never run destructive SQL against remote.

## Docs to trust
- Current references: `docs/auditoria-documental-app-movil.md` and `docs/esquema-base-datos-impulsa360.md`.
- The entire `docs/cliente/` folder is a frozen delivery snapshot pinned at version 1.0.10 (code 17), predating the current 1.0.30 (code 82). Trust `package.json`, `app.json`, and `android/gradle.properties` over it for anything version-, build-, or API-related.
