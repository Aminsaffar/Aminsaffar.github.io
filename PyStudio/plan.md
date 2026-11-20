# Implementation plan — Browser Python IDE

## Product approach

Build this as a static, browser-only website using semantic HTML, CSS, and JavaScript ES modules. Python source will only run inside a dedicated Pyodide Web Worker; there will be no application server, execution API, Node execution service, or remote code runner. Use CodeMirror 6 for the editor, loaded as version-pinned browser modules, and load a pinned Pyodide distribution from its CDN. Keep the application itself free of a build step so the same files can be served from a local static server, GitHub Pages, and Cloudflare Pages. External CDN use is limited to delivering the editor/runtime libraries and Python package assets; user code and saved projects remain in the browser.

### Interactive stdin and isolation

Pyodide's standard-input callback is synchronous, while browser `postMessage` handling is asynchronous. To retain normal Python `input()` semantics without `prompt()`, use a small SharedArrayBuffer mailbox: the worker's Pyodide stdin reader announces that it needs a line and blocks with `Atomics.wait`; the terminal writes the user's UTF-8 response into shared memory and notifies the worker. The worker decodes input through Pyodide's byte-oriented stdin callback, preserving Persian and other Unicode. The user can edit and submit terminal input on the main thread while Python waits.

This mailbox requires a secure, cross-origin-isolated page. Provide Cloudflare Pages `_headers` with COOP/COEP headers, and a same-origin service-worker bootstrap for GitHub Pages, which does not offer configurable response headers. The GitHub Pages bootstrap may reload the page once when first installed. Check isolation at startup and explain the issue in the UI if the host/browser has not enabled it; do not silently switch to JavaScript `prompt()` or pretend interactive stdin works. The same bootstrap supports localhost served over HTTP. Add a shared interrupt buffer for cooperative Pyodide cancellation, a bounded execution timer that terminates/recreates an unresponsive worker, and limits on retained terminal output. Browsers do not expose a reliable hard per-worker memory quota, so show a clear limitation rather than promising a strict memory cap.

## Architecture and modules

- `index.html`: application shell, navigation, accessible editor/terminal panels, dialogs, and mobile view controls.
- `css/main.css`: themes, responsive shell, file explorer, toolbar, and shared components.
- `css/editor.css`: CodeMirror styling, tabs, editor status, and focus states.
- `css/terminal.css`: terminal rows, stdin prompt, status indicators, ANSI color classes, and resize handle.
- `js/app.js`: startup, wiring, themes, shortcuts, layout resizing, and application state.
- `js/editor.js`: CodeMirror 6 setup, Python language support, completion, find/replace, folding, indentation, file tabs, and editor state.
- `js/terminal.js`: safe text rendering, output/error/input presentation, input history, Unicode entry, copy/download, clearing, and scrolling.
- `js/project-manager.js`: IndexedDB schema and migrations, projects/files CRUD, autosave, import/download, and project switching.
- `js/runtime-manager.js`: worker lifecycle, initialization progress, execution/status timing, timeout/stop/restart, package installation requests, crash recovery, and interrupt handling.
- `workers/python-worker.js`: module worker; pinned Pyodide initialization, stdout/stderr callbacks, SharedArrayBuffer stdin, compatible micropip installs, Python execution, and error serialization.
- `coi-serviceworker.js`: self-hosted cross-origin-isolation bootstrap for static hosts without configurable headers.
- `_headers`: Cloudflare Pages COOP/COEP declarations.
- `README.md`: local serving, browser/runtime requirements, limitations, and GitHub Pages/Cloudflare Pages deployment steps.
- `app.config.ts`: project display metadata, added before the project checkpoint.
- `public/`: committed browser-runtime output used by the platform's no-build static deployment declaration; source modules remain at the repository root.

## Interface and design

Use a VS Code/Replit-inspired developer-tool direction, avoiding a generic dashboard or textarea appearance. The brand is a lightweight browser workspace for learning real Python, positioned around fast startup and locally executed code; its personality is focused, reassuring, and approachable. The mark is a compact custom bracket-and-dot symbol beside a short wordmark. The ownable accent is bright cyan against a graphite default dark theme; the light theme uses cool paper neutrals. Use a system sans-serif UI stack and a crisp system monospace stack to avoid font downloads. Core principles: keep code and output primary, make run/input states unmistakable, keep controls discoverable without crowding, and protect focus/keyboard flow.

On desktop, use a compact top bar, a narrow file explorer, a tabbed editor, and a vertically resizable terminal beneath the editor. Include the requested Run, Stop, restart-runtime, save, download, and theme controls. On small screens, collapse the explorer and expose Editor/Terminal tabs while keeping Run available. Use restrained borders, rounded panels, clear hover/focus states, and short transitions. Include a welcome/examples view with starter code and simple learner exercises/help. Default starter code requests a name and integer and prints the personalized greeting and doubled number.

## User-facing behavior and storage

Persist multiple projects and their Python files in IndexedDB, including active project/file and editor contents; autosave and restore after refresh. Implement file create, rename, delete, switching, `.py` import, and `.py` download, with sensible confirmation before destructive deletion. Keep theme/layout preferences separately in local storage. Provide examples and the requested test programs, including standard output, consecutive `input()` calls, loops, exception handling, Persian prompts/output, and an infinite loop that can be stopped without freezing the interface.

Render terminal content as text nodes rather than HTML, capture stdout/stderr, keep prompt and typed input visually distinct, retain multiline output and optional ANSI colors, and support terminal history, clear/copy/download, autoscroll, execution duration, and Running / Waiting for Input / Completed / Error / Stopped status. Provide a package-install control backed by `micropip` for packages compatible with Pyodide. Explain that Pyodide runs locally but is not a complete security sandbox: Python code can consume browser resources and may access network-capable APIs; advise against running untrusted code. Never `eval()` Python-produced JavaScript.

## Implementation decisions and limits

The project stays static; local development uses a file-serving development command only, which serves assets and never executes Python. CodeMirror and Pyodide are pinned to explicit compatible releases. Pyodide's Worker is restarted after a forced timeout or crash. Stop writes a shared interrupt request and immediately terminates/recreates the Worker so cancellation remains deterministic, including for code that does not respond to cooperative interrupts. Apply sensible defaults for maximum execution time and terminal output; describe memory limits as best-effort because browser APIs do not provide a portable hard cap. IndexedDB remains local to each browser profile and is not synchronized across devices.
