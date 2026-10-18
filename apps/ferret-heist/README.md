# Ferret Heist: Stash Under the Couch

Sneak around the room, collect treasures, and bring them to the couch while
avoiding the human and vacuum. This workspace contains the clean sample game,
its tests, dependencies, and Vite/Vitest configuration.

## Playing

- Move with the arrow keys, WASD, or the on-screen direction buttons.
- Use Space or the War Dance button for a burst of speed and chaos.
- Bring collected items to the couch at the bottom-left.
- Click the canvas or press a key to start; use Restart to begin again.

## Development

Install from the repository root using the shared lockfile:

```sh
npm ci
npm run dev --workspace=ferret-heist
```

Open the URL printed by Vite. Use a development or preview server rather than
opening the source HTML directly from the filesystem.

From this app directory:

| Command           | Purpose                                |
| ----------------- | -------------------------------------- |
| `npm run dev`     | Start the development server           |
| `npm run lint`    | Check JavaScript, formatting, and HTML |
| `npm run build`   | Build into this app's `dist` directory |
| `npm run preview` | Serve the production build             |
| `npm test`        | Run app tests                          |
| `npm run test:ci` | Run app tests and enforce coverage     |

From the repository root, add `--workspace=ferret-heist` to select an app
command. Root aggregate commands also remain available for checking the
framework and all registered apps.

## Tests and shared configuration

App tests live in `tests`; framework tests remain outside this workspace.
Vitest rejects empty test selections and enforces at least 80% line coverage
over the configured game-logic modules. Rendering, audio, and browser bootstrap
are excluded from that measurement. Reports are written to this app's
`coverage` directory.

ESLint and Prettier inherit the repository's shared conventions, with app-local
environment settings and generated-output ignores.

Do not add an app-local lockfile. The root `package-lock.json` records all
workspace dependencies. Run development commands or serve this app's `dist`
build; the old repository-root HTML redirect is not used.
