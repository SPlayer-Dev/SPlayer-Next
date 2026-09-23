# Contributing

Thank you for contributing to SPlayer-Next. This page covers the local environment and core conventions.

## Requirements

- **Node.js** >= 22.19.0
- **pnpm** >= 10
- **Rust toolchain** for [native modules](/en/native)

## Getting started

```bash
git clone https://github.com/SPlayer-Dev/SPlayer-Next.git
cd SPlayer-Next
pnpm install
pnpm dev

# Pass arguments to the application
pnpm dev -- [arguments]...
```

Set `SKIP_NATIVE_BUILD=true` to skip Rust compilation during renderer-only development.

## Building

```bash
pnpm build
pnpm build:win
pnpm build:mac
pnpm build:linux

# Build selected electron-builder targets
pnpm build:win nsis
pnpm build:mac dmg
pnpm build:linux tar.gz

# Build unpacked output for local testing
pnpm build:unpack
```

See [electron-builder targets](https://www.electron.build/docs/targets) for all package targets.

## Common scripts

```bash
pnpm typecheck
pnpm lint
pnpm format
pnpm build:native
pnpm build:native --dev
```

## Project structure

```text
electron/main/      Main process: windows, IPC, native modules, services
electron/preload/   contextBridge APIs exposed as window.api
src/                Vue 3 renderer application
windows/            Desktop lyric, Dynamic Island, and taskbar lyric windows
native/             Rust native modules built with NAPI-RS
shared/             Cross-process types and defaults
```

## Conventions

- Write code comments in Chinese. Use standard JSDoc for methods and comment only when the reason is not obvious.
- Follow Prettier: double quotes, semicolons, 100 columns, and trailing commas.
- Run `pnpm typecheck` and `pnpm lint` before submitting.
- Import native types from `@splayer/*`; do not edit generated `native/*/index.d.ts` files.
- Use Conventional Commits in the form `<type>: <Chinese summary>` and keep the title on one line.

## Application localization

The application uses [vue-i18n](https://vue-i18n.intlify.dev/). Locale files are stored in `src/i18n/locales/`.

### Visual Studio Code

Install [i18n Ally](https://marketplace.visualstudio.com/items?itemName=Lokalise.i18n-ally) and configure:

```json
{
  "i18n-ally.localesPaths": "./src/i18n/locales/"
}
```

### JetBrains IDEs

Install [Easy i18n](https://plugins.jetbrains.com/plugin/16316-easy-i18n), select the `VUE_I18N` preset, and use this path template:

```text
$PROJECT_DIR$/src/i18n/locales/{locale}.json
```

## Pull requests

1. Create a feature branch from `dev`.
2. Run formatting, type checking, and linting.
3. Open the PR against `dev` and clearly describe the motivation and changes.
