const MAX_RENDERED_CHARS = 250_000;
const ANSI_FG = new Map(Array.from({ length: 16 }, (_, index) => [index < 8 ? 30 + index : 90 + index - 8, `terminal-ansi-fg-${index}`]));

export class TerminalView {
  constructor() {
    this.output = document.querySelector('#terminalOutput');
    this.statusLabel = document.querySelector('#terminalStatus');
    this.statusDot = document.querySelector('#terminalStatusDot');
    this.executionTime = document.querySelector('#executionTime');
    this.welcome = document.querySelector('#terminalWelcome');
    this.history = [];
    this.historyIndex = -1;
    this.inputPrompt = null;
    this.inputCallback = null;
    this.ansi = { fg: null, bold: false, dim: false };
    this.renderedChars = 0;
  }

  setStatus(status, detail = '') {
    const key = String(status).toLowerCase().replaceAll(' ', '-');
    const allowed = new Set(['ready', 'starting', 'loading', 'running', 'waiting', 'waiting-for-input', 'completed', 'error', 'stopped']);
    const state = allowed.has(key) ? key : 'ready';
    this.statusDot.dataset.state = state === 'waiting-for-input' ? 'waiting' : state;
    this.statusLabel.textContent = detail || status;
    const mobileDot = document.querySelector('#mobileStatusDot');
    if (mobileDot) mobileDot.dataset.state = state === 'waiting-for-input' ? 'waiting' : state;
  }

  setDuration(milliseconds) {
    this.executionTime.textContent = Number.isFinite(milliseconds) ? `${(milliseconds / 1000).toFixed(2)}s` : '';
  }

  append(text, kind = 'stdout') {
    const value = String(text ?? '');
    if (!value) return;
    if (this.welcome?.isConnected) this.welcome.remove();
    const normal = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const clearPattern = /\x1b\[(?:2J|H)/g;
    if (/\x1b\[2J/.test(normal)) this.clear();
    const clean = normal.replace(clearPattern, '');
    const outer = document.createElement('span');
    outer.className = `terminal-chunk ${kind}`;
    this.appendAnsiContent(outer, clean);
    this.output.append(outer);
    this.renderedChars += clean.length;
    this.trimOutput();
    this.scrollToBottom();
  }

  appendAnsiContent(parent, value) {
    const pattern = /\x1b\[([0-9;]*)m/g;
    let offset = 0;
    let match;
    while ((match = pattern.exec(value))) {
      if (match.index > offset) parent.append(this.ansiSpan(value.slice(offset, match.index)));
      this.applyAnsi(match[1]);
      offset = pattern.lastIndex;
    }
    if (offset < value.length) parent.append(this.ansiSpan(value.slice(offset)));
  }

  applyAnsi(codes) {
    const values = codes === '' ? [0] : codes.split(';').map((value) => Number(value || 0));
    for (const code of values) {
      if (code === 0) this.ansi = { fg: null, bold: false, dim: false };
      else if (code === 1) this.ansi.bold = true;
      else if (code === 2) this.ansi.dim = true;
      else if (code === 22) { this.ansi.bold = false; this.ansi.dim = false; }
      else if (code === 39) this.ansi.fg = null;
      else if (ANSI_FG.has(code)) this.ansi.fg = ANSI_FG.get(code);
    }
  }

  ansiSpan(text) {
    const span = document.createElement('span');
    if (this.ansi.fg) span.classList.add(this.ansi.fg);
    if (this.ansi.bold) span.classList.add('terminal-ansi-bold');
    if (this.ansi.dim) span.classList.add('terminal-ansi-dim');
    span.textContent = text;
    return span;
  }

  requestInput(onSubmit, { maxBytes = 65536 } = {}) {
    this.cancelInput(false);
    if (this.welcome?.isConnected) this.welcome.remove();
    const wrapper = document.createElement('span');
    wrapper.className = 'terminal-input-inline';
    const input = document.createElement('input');
    input.type = 'text';
    input.autocomplete = 'off';
    input.autocapitalize = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', 'Python input. Press Enter to submit.');
    input.maxLength = 20_000;
    wrapper.append(input);
    this.output.append(wrapper);
    this.inputPrompt = { wrapper, input };
    this.inputCallback = onSubmit;
    input.addEventListener('keydown', (event) => this.handleInputKeydown(event));
    input.addEventListener('input', () => {
      const bytes = new TextEncoder().encode(input.value).length;
      if (bytes > maxBytes - 1) {
        input.value = Array.from(input.value).slice(0, Math.max(1, Math.floor(input.value.length * ((maxBytes - 1) / bytes)))).join('');
      }
    });
    this.scrollToBottom();
    requestAnimationFrame(() => input.focus({ preventScroll: true }));
  }

  handleInputKeydown(event) {
    const { input } = this.inputPrompt || {};
    if (!input) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.submitInput(input.value);
    } else if (event.key === 'ArrowUp' && !input.value) {
      event.preventDefault();
      if (this.history.length) {
        this.historyIndex = Math.max(0, this.historyIndex - 1);
        input.value = this.history[this.historyIndex] ?? '';
        input.setSelectionRange(input.value.length, input.value.length);
      }
    } else if (event.key === 'ArrowDown' && this.historyIndex >= 0) {
      event.preventDefault();
      this.historyIndex += 1;
      input.value = this.history[this.historyIndex] ?? '';
      if (this.historyIndex >= this.history.length) this.historyIndex = -1;
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  submitInput(value) {
    if (!this.inputPrompt) return;
    const response = String(value);
    if (response && this.history.at(-1) !== response) this.history.push(response);
    if (this.history.length > 100) this.history.shift();
    this.historyIndex = -1;
    const { wrapper } = this.inputPrompt;
    const shown = document.createElement('span');
    shown.className = 'terminal-user-input';
    shown.textContent = `${response}\n`;
    wrapper.replaceWith(shown);
    this.inputPrompt = null;
    const callback = this.inputCallback;
    this.inputCallback = null;
    this.renderedChars += response.length + 1;
    this.trimOutput();
    this.scrollToBottom();
    callback?.(response);
  }

  cancelInput(showMessage = true) {
    if (!this.inputPrompt) return;
    const { wrapper } = this.inputPrompt;
    if (showMessage) {
      const marker = document.createElement('span');
      marker.className = 'terminal-input-cancelled';
      marker.textContent = '[input cancelled]';
      wrapper.replaceWith(marker);
    } else wrapper.remove();
    this.inputPrompt = null;
    this.inputCallback = null;
  }

  clear() {
    const active = this.inputPrompt?.wrapper;
    this.output.replaceChildren();
    this.renderedChars = 0;
    if (active) this.output.append(active);
    this.scrollToBottom();
  }

  trimOutput() {
    while (this.renderedChars > MAX_RENDERED_CHARS && this.output.firstElementChild && this.output.firstElementChild !== this.inputPrompt?.wrapper) {
      const first = this.output.firstElementChild;
      this.renderedChars -= first.textContent?.length || 0;
      first.remove();
    }
  }

  scrollToBottom() { this.output.scrollTop = this.output.scrollHeight; }

  getText() { return this.output.textContent || ''; }

  async copy() {
    const text = this.getText();
    if (!text) return false;
    await navigator.clipboard.writeText(text);
    return true;
  }

  download() {
    const blob = new Blob([this.getText()], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'pystudio-terminal.txt';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
