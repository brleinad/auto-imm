# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Chrome Extension MV3 (Manifest Version 3) side panel application built with:
- **Svelte 5** (using runes syntax)
- **Vite** for bundling
- **TypeScript** for type safety
- **TailwindCSS + DaisyUI** for styling
- Extension type: Side panel (not popup/background worker)

## Development Commands

```bash
# Install dependencies
npm install

# Development mode with HMR
npm run dev

# Production build (outputs to dist/)
npm run build

# Type checking
npm run check

# Preview production build
npm run preview
```

## Loading Extension in Chrome

1. Build the extension: `npm run build`
2. Open `chrome://extensions` in Chrome
3. Enable "Developer Mode"
4. Click "Load unpacked" and select the `dist/` directory

## Architecture

### Application Structure

The app uses a **single-page architecture** with client-side routing:

- **App.svelte** - Root component that handles theme initialization and page routing
- **src/lib/stores/navigation.ts** - Client-side routing via Svelte stores (not using a router library)
- **src/lib/stores/theme.ts** - DaisyUI theme management with localStorage persistence

### Page Routing System

Pages are switched via conditional rendering in App.svelte based on the `currentPage` store:
- Navigate using `navigateTo(page)` from `src/lib/stores/navigation.ts`
- Available pages: 'home' | 'settings' | 'help' | 'components'
- Bottom navigation (`Nav.svelte`) uses `MENU_ITEMS` from `src/lib/constants/menu.ts`

### Component Organization

```
src/lib/
├── components/        # UI components
│   ├── ui/           # Reusable DaisyUI wrapper components (Button, Card, etc.)
│   ├── Nav.svelte    # Bottom navigation bar
│   └── ThemeController.svelte
├── pages/            # Page-level components
├── stores/           # Svelte stores for state management
├── constants/        # Configuration (menu items, etc.)
├── icons/           # Lucide icon re-exports
└── types/           # TypeScript type definitions
```

### Svelte 5 Runes

This project uses Svelte 5 with runes syntax:
- `$state()` for reactive state
- `$derived()` for computed values
- Store values accessed with `$` prefix (e.g., `$currentPage`, `$theme`)

### Theming System

- 35+ DaisyUI themes available (defined in `tailwind.config.js`)
- Theme state managed in `src/lib/stores/theme.ts`
- Theme persisted to localStorage with key: `svelte5-extension-theme`
- Apply theme via `data-theme` attribute on root div
- Use `setTheme(newTheme)` or `toggleTheme()` to change themes

### Chrome Extension Specifics

- **Side Panel** manifest configuration (not popup)
- Entry point: `index.html` → `main.ts` → `App.svelte`
- Only permission: `sidePanel`
- Extension name: "Home (Svelte 5 Refactor)"

## Vite Build Configuration

The build outputs to `dist/` with custom naming:
- Entry files: `assets/[name].js`
- Chunks: `assets/[name].js`
- Assets: `assets/[name].[ext]`

## Important Notes

- Icons are from `@lucide/svelte` and re-exported via `src/lib/icons/index.ts`
- UI components in `src/lib/components/ui/` are DaisyUI wrappers for consistency
- The app mounts to `#app` element via `mount()` from Svelte 5
- All navigation happens via the store - no URL-based routing
