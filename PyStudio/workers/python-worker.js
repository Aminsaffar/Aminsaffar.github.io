const PYODIDE_VERSION = '0.28.3';
const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const INPUT_HEADER_BYTES = 8;

let pyodide = null;
let inputHeader = null;
let inputBytes = null;
let interruptBuffer = null;
let pendingBytes = new Uint8Array();
let pendingOffset = 0;
let activeRunId = null;
let readyPromise = null;

function send(type, extra = {}) {
  self.postMessage({ type, ...extra });
}

function createStdin() {
  return {
    isatty: true,
    read(buffer) {
      if (pendingOffset >= pendingBytes.length) {
        pendingBytes = new Uint8Array();
        pendingOffset = 0;
        Atomics.store(inputHeader, 1, 0);
        Atomics.store(inputHeader, 0, 0);
        send('input-request', { runId: activeRunId });
        while (Atomics.load(inputHeader, 0) === 0) {
          if (interruptBuffer && Atomics.load(interruptBuffer, 0) === 2) {
            pyodide.checkInterrupt();
          }
          Atomics.wait(inputHeader, 0, 0, 80);
        }
        const state = Atomics.load(inputHeader, 0);
        if (state === 3) {
          if (interruptBuffer) Atomics.store(interruptBuffer, 0, 2);
          pyodide.checkInterrupt();
          throw new Error('Input was cancelled.');
        }
        if (state === 2) return 0;
        const length = Math.max(0, Math.min(Atomics.load(inputHeader, 1), inputBytes.length));
        pendingBytes = inputBytes.slice(0, length);
        pendingOffset = 0;
        Atomics.store(inputHeader, 0, 0);
      }
      const count = Math.min(buffer.length, pendingBytes.length - pendingOffset);
      if (count <= 0) return 0;
      buffer.set(pendingBytes.subarray(pendingOffset, pendingOffset + count), 0);
      pendingOffset += count;
      return count;
    },
  };
}

async function initialize(data) {
  if (readyPromise) return readyPromise;
  const sharedInput = data.sharedInput;
  inputHeader = new Int32Array(sharedInput, 0, 2);
  inputBytes = new Uint8Array(sharedInput, INPUT_HEADER_BYTES);
  interruptBuffer = new Uint8Array(data.interruptBuffer);
  readyPromise = (async () => {
    send('progress', { message: 'Loading Pyodide runtime…', percent: 5 });
    const { loadPyodide } = await import(`${PYODIDE_CDN}pyodide.mjs`);
    pyodide = await loadPyodide({
      indexURL: PYODIDE_CDN,
      onProgress: (event) => {
        const total = Number(event?.total || 0);
        const loaded = Number(event?.loaded || 0);
        const percent = total > 0 ? Math.min(95, Math.round(10 + (loaded / total) * 80)) : undefined;
        send('progress', { message: 'Loading Python WebAssembly…', percent });
      },
    });
    pyodide.setInterruptBuffer(interruptBuffer);
    pyodide.setStdin(createStdin());
    pyodide.setStdout({ batched: (text) => { if (activeRunId !== null) send('stdout', { text, runId: activeRunId }); } });
    pyodide.setStderr({ batched: (text) => { if (activeRunId !== null) send('stderr', { text, runId: activeRunId }); } });
    send('progress', { message: 'Preparing Python packages…', percent: 96 });
    await pyodide.loadPackage('micropip');
    send('ready', { version: PYODIDE_VERSION });
    return pyodide;
  })();
  return readyPromise;
}

async function runCode({ code, runId }) {
  await readyPromise;
  activeRunId = runId;
  pendingBytes = new Uint8Array();
  pendingOffset = 0;
  Atomics.store(interruptBuffer, 0, 0);
  Atomics.store(inputHeader, 0, 0);
  Atomics.store(inputHeader, 1, 0);
  send('run-started', { runId });
  try {
    send('progress', { message: 'Resolving Python imports…', runId });
    await pyodide.loadPackagesFromImports(code);
    send('progress', { message: 'Running Python…', runId });
    const result = await pyodide.runPythonAsync(code);
    if (result && typeof result.destroy === 'function') result.destroy();
    send('run-complete', { runId });
  } catch (error) {
    send('run-error', {
      runId,
      message: String(error?.message || error),
      name: String(error?.name || 'PythonError'),
      stack: String(error?.stack || ''),
    });
  } finally {
    activeRunId = null;
  }
}

async function installPackage({ packageName, operationId }) {
  await readyPromise;
  if (activeRunId !== null) throw new Error('Stop the current Python program before installing a package.');
  const name = String(packageName || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(name)) throw new Error('Use a package name containing letters, numbers, dots, underscores, or hyphens.');
  send('package-started', { operationId, packageName: name });
  try {
    pyodide.globals.set('pystudio_package_name', name);
    await pyodide.runPythonAsync('import micropip\nawait micropip.install(pystudio_package_name)');
    pyodide.globals.delete('pystudio_package_name');
    send('package-complete', { operationId, packageName: name });
  } catch (error) {
    try { pyodide.globals.delete('pystudio_package_name'); } catch { /* runtime may have failed */ }
    send('package-error', { operationId, packageName: name, message: String(error?.message || error) });
  }
}

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'init') {
    initialize(data).catch((error) => send('fatal', { message: String(error?.message || error), stack: String(error?.stack || '') }));
  } else if (data.type === 'run') {
    runCode(data).catch((error) => send('run-error', { runId: data.runId, message: String(error?.message || error), name: String(error?.name || 'Error') }));
  } else if (data.type === 'install-package') {
    installPackage(data).catch((error) => send('package-error', { operationId: data.operationId, packageName: data.packageName, message: String(error?.message || error) }));
  }
});
