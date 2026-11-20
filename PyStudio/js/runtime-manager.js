const INPUT_HEADER_BYTES = 8;
const INPUT_BUFFER_BYTES = 65_536;
const PYTHON_TIMEOUT_MS = 30_000;
const INTERRUPT_GRACE_MS = 650;

export class RuntimeManager {
  constructor({ onStatus = () => {}, onOutput = () => {}, onProgress = () => {}, onReady = () => {}, onInputRequest = () => {}, onError = () => {}, onDuration = () => {} } = {}) {
    this.callbacks = { onStatus, onOutput, onProgress, onReady, onInputRequest, onError, onDuration };
    this.worker = null;
    this.inputHeader = null;
    this.inputBytes = null;
    this.interruptView = null;
    this.ready = false;
    this.busy = false;
    this.currentRunId = null;
    this.operationId = 0;
    this.startedAt = 0;
    this.timeoutId = null;
    this.interruptFallbackId = null;
    this.initTimeoutId = null;
    this.recoveryAttempts = 0;
    this.readyPromise = null;
    this.resolveReady = null;
    this.rejectReady = null;
    this.initializationError = null;
  }

  get isolated() {
    return Boolean(globalThis.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined');
  }

  async start() {
    if (!this.isolated) {
      const message = 'This page is not cross-origin isolated. Enable the COI service worker or host response headers, then reload to use interactive input and interruptible Python.';
      this.callbacks.onStatus('error', 'Isolation required');
      this.callbacks.onError(message);
      throw new Error(message);
    }
    this.stopTimers();
    this.terminateWorker();
    this.ready = false;
    this.busy = false;
    this.initializationError = null;
    this.callbacks.onStatus('loading', 'Loading Python runtime…');
    this.callbacks.onProgress('Downloading Pyodide runtime…', 3);
    this.readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.worker = new Worker(new URL('../workers/python-worker.js', import.meta.url), { type: 'module', name: 'pystudio-python' });
    this.worker.addEventListener('message', (event) => this.handleMessage(event.data || {}));
    this.worker.addEventListener('error', (event) => this.handleWorkerError(event));
    const sharedInput = new SharedArrayBuffer(INPUT_HEADER_BYTES + INPUT_BUFFER_BYTES);
    this.inputHeader = new Int32Array(sharedInput, 0, 2);
    this.inputBytes = new Uint8Array(sharedInput, INPUT_HEADER_BYTES);
    const interruptBuffer = new SharedArrayBuffer(1);
    this.interruptView = new Uint8Array(interruptBuffer);
    this.worker.postMessage({ type: 'init', sharedInput, interruptBuffer });
    this.initTimeoutId = setTimeout(() => this.failInitialization('The Python runtime did not finish loading within 120 seconds. Check the network connection and restart the runtime.'), 120_000);
    return this.readyPromise;
  }

  handleMessage(data) {
    switch (data.type) {
      case 'progress':
        this.callbacks.onProgress(data.message || 'Preparing Python…', data.percent);
        if (data.runId === this.currentRunId && data.message) this.callbacks.onStatus('running', data.message);
        break;
      case 'ready':
        clearTimeout(this.initTimeoutId);
        this.initTimeoutId = null;
        this.ready = true;
        this.recoveryAttempts = 0;
        this.callbacks.onStatus('ready', `Python ${data.version || ''} ready`.trim());
        this.callbacks.onReady(data.version);
        this.resolveReady?.(true);
        this.resolveReady = null;
        this.rejectReady = null;
        break;
      case 'stdout':
        this.callbacks.onOutput(data.text, 'stdout');
        break;
      case 'stderr':
        this.callbacks.onOutput(data.text, 'stderr');
        break;
      case 'input-request':
        if (data.runId === this.currentRunId) {
          this.callbacks.onStatus('waiting', 'Waiting for input');
          this.callbacks.onInputRequest((value) => this.submitInput(value, data.runId));
        }
        break;
      case 'run-started':
        if (data.runId === this.currentRunId) this.callbacks.onStatus('running', 'Running Python');
        break;
      case 'run-complete':
        if (data.runId === this.currentRunId) this.finishRun('completed', 'Completed');
        break;
      case 'run-error':
        if (data.runId === this.currentRunId) {
          const message = this.withHint(data.message || 'Python raised an error.', data.name);
          this.callbacks.onError(message, data.name);
          this.finishRun('error', 'Error');
        }
        break;
      case 'fatal':
        this.failInitialization(data.message || 'The Python runtime failed to load.');
        break;
      case 'package-started':
        if (data.operationId === this.operationId) this.callbacks.onStatus('loading', `Installing ${data.packageName}…`);
        break;
      case 'package-complete':
        if (data.operationId === this.operationId) {
          this.busy = false;
          this.callbacks.onStatus('ready', `${data.packageName} installed`);
          this.callbacks.onProgress('', 100);
        }
        break;
      case 'package-error':
        if (data.operationId === this.operationId) {
          this.busy = false;
          this.callbacks.onError(`Could not install ${data.packageName}: ${data.message}`);
          this.callbacks.onStatus('error', 'Package install failed');
        }
        break;
      default:
        break;
    }
  }

  withHint(message, exceptionName = '') {
    const name = String(exceptionName || message.match(/\b([A-Za-z]+Error|Exception):/)?.[1] || '');
    const hints = {
      SyntaxError: 'Check punctuation, quotes, and Python syntax around the traceback line.',
      IndentationError: 'Python uses consistent spaces or tabs to define code blocks. Check the indented lines.',
      NameError: 'Check that the variable or function name is spelled correctly and has been defined.',
      ValueError: 'Check that the value has the format the operation expects, such as digits for int().',
      ZeroDivisionError: 'A number was divided by zero. Check the denominator before dividing.',
      ModuleNotFoundError: 'This module may need to be installed, or it may not be supported by Pyodide.',
      ImportError: 'This library or one of its dependencies may not be compatible with WebAssembly/Pyodide.',
    };
    const hint = hints[name];
    return hint ? `${message}\n\nHint: ${hint}` : message;
  }

  async run(code) {
    if (this.busy) throw new Error('Python is already running. Stop it before starting another run.');
    if (!this.ready) await (this.readyPromise || this.start());
    if (!this.worker || !this.ready) throw new Error('Python runtime is not ready.');
    this.busy = true;
    this.operationId += 1;
    const runId = this.operationId;
    this.currentRunId = runId;
    this.startedAt = performance.now();
    this.interruptView[0] = 0;
    Atomics.store(this.inputHeader, 0, 0);
    Atomics.store(this.inputHeader, 1, 0);
    this.callbacks.onDuration(null);
    this.callbacks.onStatus('running', 'Running Python');
    this.worker.postMessage({ type: 'run', runId, code: String(code ?? '') });
    this.timeoutId = setTimeout(() => this.handleTimeout(runId), PYTHON_TIMEOUT_MS);
    return runId;
  }

  submitInput(value, runId = this.currentRunId) {
    if (!this.busy || runId !== this.currentRunId || !this.inputHeader) return;
    const encoded = new TextEncoder().encode(`${String(value)}\n`);
    if (encoded.length > this.inputBytes.length) {
      this.callbacks.onError('That input line is too long. Please enter fewer than 65,536 UTF-8 bytes.');
      this.callbacks.onInputRequest((retry) => this.submitInput(retry, runId));
      return;
    }
    this.inputBytes.fill(0);
    this.inputBytes.set(encoded);
    Atomics.store(this.inputHeader, 1, encoded.length);
    Atomics.store(this.inputHeader, 0, 1);
    Atomics.notify(this.inputHeader, 0);
    this.callbacks.onStatus('running', 'Input submitted');
  }

  async installPackage(packageName) {
    const name = String(packageName || '').trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(name)) throw new Error('Enter a valid package name.');
    if (this.busy) throw new Error('Stop the current program before installing a package.');
    if (!this.ready) await (this.readyPromise || this.start());
    this.busy = true;
    const operationId = ++this.operationId;
    this.callbacks.onStatus('loading', `Installing ${name}…`);
    this.worker.postMessage({ type: 'install-package', packageName: name, operationId });
  }

  stop() {
    if (!this.busy || !this.worker) return false;
    if (this.interruptView) this.interruptView[0] = 2;
    if (this.inputHeader) {
      Atomics.store(this.inputHeader, 0, 3);
      Atomics.notify(this.inputHeader, 0);
    }
    this.callbacks.onOutput('\n[Execution stopped. Python worker restarted.]\n', 'system');
    this.finishRun('stopped', 'Stopped');
    this.terminateWorker();
    this.start().catch(() => {});
    return true;
  }

  handleTimeout(runId) {
    if (!this.busy || this.currentRunId !== runId) return;
    this.callbacks.onError(`Execution exceeded the ${PYTHON_TIMEOUT_MS / 1000}-second limit. The Worker was terminated and restarted.`);
    this.callbacks.onOutput('\n[Execution timed out. Python worker restarted.]\n', 'system');
    this.finishRun('error', 'Execution timed out');
    this.terminateWorker();
    this.start().catch(() => {});
  }

  finishRun(state, label) {
    const elapsed = this.currentRunId !== null && this.startedAt ? performance.now() - this.startedAt : null;
    this.stopTimers();
    this.busy = false;
    this.currentRunId = null;
    this.callbacks.onDuration(elapsed);
    this.callbacks.onStatus(state, label);
  }

  failInitialization(message) {
    this.stopTimers();
    this.initializationError = message;
    this.ready = false;
    this.busy = false;
    this.callbacks.onError(message);
    this.callbacks.onStatus('error', 'Runtime failed');
    this.rejectReady?.(new Error(message));
    this.resolveReady = null;
    this.rejectReady = null;
    this.terminateWorker();
  }

  handleWorkerError(event) {
    const message = event?.message || 'The Python Worker crashed.';
    if (!this.ready && this.rejectReady) this.failInitialization(message);
    else {
      if (this.busy) this.finishRun('error', 'Worker crashed');
      const recover = this.ready && this.recoveryAttempts < 1;
      this.ready = false;
      this.callbacks.onError(`Python worker error: ${message}`);
      this.callbacks.onStatus('error', 'Worker crashed');
      this.terminateWorker();
      if (recover) {
        this.recoveryAttempts += 1;
        setTimeout(() => this.start().catch(() => {}), 250);
      }
    }
  }

  restart() {
    this.stopTimers();
    if (this.busy) {
      this.callbacks.onOutput('\n[Python runtime restarted.]\n', 'system');
      this.callbacks.onDuration(this.startedAt ? performance.now() - this.startedAt : null);
    }
    this.busy = false;
    this.currentRunId = null;
    this.ready = false;
    this.terminateWorker();
    return this.start();
  }

  stopTimers() {
    clearTimeout(this.timeoutId);
    clearTimeout(this.interruptFallbackId);
    clearTimeout(this.initTimeoutId);
    this.timeoutId = null;
    this.interruptFallbackId = null;
    this.initTimeoutId = null;
  }

  terminateWorker() {
    this.worker?.terminate();
    this.worker = null;
    this.inputHeader = null;
    this.inputBytes = null;
    this.interruptView = null;
  }
}
