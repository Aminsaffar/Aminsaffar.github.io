import { PythonEditor } from './editor.js';
import { parseNotebook, serializeNotebook } from './notebook-format.js';

const MAX_CELL_OUTPUT_CHARS = 120_000;

function button(label, className, ariaLabel, onClick) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.textContent = label;
  element.setAttribute('aria-label', ariaLabel);
  element.title = ariaLabel;
  element.addEventListener('click', onClick);
  return element;
}

function outputText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every((part) => typeof part === 'string')) return value.join('');
  return value == null ? '' : String(value);
}

function appendInline(parent, source) {
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let offset = 0;
  let match;
  while ((match = pattern.exec(source))) {
    if (match.index > offset) parent.append(document.createTextNode(source.slice(offset, match.index)));
    const token = match[0];
    const node = document.createElement(token.startsWith('`') ? 'code' : token.startsWith('**') ? 'strong' : 'em');
    node.textContent = token.startsWith('**') ? token.slice(2, -2) : token.slice(1, -1);
    parent.append(node);
    offset = pattern.lastIndex;
  }
  if (offset < source.length) parent.append(document.createTextNode(source.slice(offset)));
}

function renderMarkdown(container, source) {
  container.replaceChildren();
  let list = null;
  for (const line of String(source || '').split(/\r?\n/)) {
    if (!line.trim()) { list = null; continue; }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      list = null;
      const node = document.createElement(`h${heading[1].length}`);
      appendInline(node, heading[2]);
      container.append(node);
      continue;
    }
    const item = /^\s*[-*]\s+(.+)$/.exec(line);
    if (item) {
      if (!list) { list = document.createElement('ul'); container.append(list); }
      const node = document.createElement('li');
      appendInline(node, item[1]);
      list.append(node);
      continue;
    }
    list = null;
    if (line.startsWith('> ')) {
      const quote = document.createElement('blockquote');
      appendInline(quote, line.slice(2));
      container.append(quote);
      continue;
    }
    const paragraph = document.createElement('p');
    appendInline(paragraph, line);
    container.append(paragraph);
  }
}

export class NotebookEditor {
  constructor(host, notebookText, { onChange = () => {}, onRunCell = () => {}, onRunAll = () => {} } = {}) {
    this.host = host;
    this.notebook = parseNotebook(notebookText);
    this.onChange = onChange;
    this.onRunCell = onRunCell;
    this.onRunAll = onRunAll;
    this.editors = new Map();
    this.outputHosts = new Map();
    this.activeCellId = this.notebook.cells.find((cell) => cell.cell_type === 'code')?.id || null;
    this.executionCount = Math.max(0, ...this.notebook.cells.map((cell) => Number.isInteger(cell.execution_count) ? cell.execution_count : 0));
    this.runningCells = new Set();
    this.render();
  }

  serialize() { return serializeNotebook(this.notebook); }

  emitChange() { this.onChange(this.serialize()); }

  getCodeCellIds() { return this.notebook.cells.filter((cell) => cell.cell_type === 'code').map((cell) => cell.id); }

  getActiveCellId() {
    return this.notebook.cells.some((cell) => cell.id === this.activeCellId && cell.cell_type === 'code')
      ? this.activeCellId
      : this.getCodeCellIds()[0] || null;
  }

  getCellSource(cellId) { return this.notebook.cells.find((cell) => cell.id === cellId && cell.cell_type === 'code')?.source ?? null; }

  destroyCellEditors() {
    for (const editor of this.editors.values()) editor.destroy();
    this.editors.clear();
    this.outputHosts.clear();
  }

  destroy() {
    this.destroyCellEditors();
    this.host.replaceChildren();
  }

  render() {
    this.destroyCellEditors();
    const workspace = document.createElement('div');
    workspace.className = 'notebook-workspace';
    const toolbar = document.createElement('div');
    toolbar.className = 'notebook-toolbar';
    const heading = document.createElement('div');
    heading.className = 'notebook-heading';
    const title = document.createElement('strong');
    title.textContent = 'Jupyter Notebook';
    const subtitle = document.createElement('span');
    subtitle.textContent = `${this.notebook.cells.length} cells · saved in this browser`;
    heading.append(title, subtitle);
    const actions = document.createElement('div');
    actions.className = 'notebook-actions';
    actions.append(
      button('Run all', 'notebook-action notebook-run-all', 'Run all code cells in order', () => this.onRunAll()),
      button('+ Code', 'notebook-action', 'Add a Python code cell', () => this.addCell('code')),
      button('+ Markdown', 'notebook-action', 'Add a Markdown cell', () => this.addCell('markdown')),
    );
    toolbar.append(heading, actions);
    const cellList = document.createElement('div');
    cellList.className = 'notebook-cell-list';
    for (const [index, cell] of this.notebook.cells.entries()) cellList.append(this.renderCell(cell, index));
    if (!this.notebook.cells.length) {
      const empty = document.createElement('div');
      empty.className = 'notebook-empty';
      empty.textContent = 'This notebook has no cells yet. Add a code or Markdown cell to begin.';
      cellList.append(empty);
    }
    workspace.append(toolbar, cellList);
    this.host.replaceChildren(workspace);
  }

  renderCell(cell, index) {
    const article = document.createElement('article');
    article.className = `notebook-cell notebook-cell-${cell.cell_type}`;
    article.dataset.cellId = cell.id;
    article.addEventListener('focusin', () => { if (cell.cell_type === 'code') this.activeCellId = cell.id; });
    article.addEventListener('click', () => { if (cell.cell_type === 'code') this.activeCellId = cell.id; });
    const header = document.createElement('div');
    header.className = 'notebook-cell-header';
    const label = document.createElement('span');
    label.className = 'notebook-cell-label';
    label.textContent = `${cell.cell_type === 'code' ? 'In' : cell.cell_type === 'markdown' ? 'Markdown' : 'Raw'} ${cell.cell_type === 'code' ? `[${cell.execution_count ?? ' '}]` : ''}`.trim();
    header.append(label);
    const controls = document.createElement('div');
    controls.className = 'notebook-cell-controls';
    if (cell.cell_type === 'code') {
      const run = button('Run', 'notebook-action notebook-cell-run', `Run cell ${index + 1}`, () => this.onRunCell(cell.id));
      run.disabled = this.runningCells.has(cell.id);
      controls.append(run);
    }
    const up = button('↑', 'notebook-action notebook-move', `Move cell ${index + 1} up`, () => this.moveCell(cell.id, -1));
    up.disabled = index === 0;
    const down = button('↓', 'notebook-action notebook-move', `Move cell ${index + 1} down`, () => this.moveCell(cell.id, 1));
    down.disabled = index === this.notebook.cells.length - 1;
    const remove = button('×', 'notebook-action notebook-delete', `Delete cell ${index + 1}`, () => this.deleteCell(cell.id));
    remove.disabled = this.runningCells.has(cell.id);
    controls.append(up, down, remove);
    header.append(controls);
    article.append(header);

    if (cell.cell_type === 'code') {
      const sourceBox = document.createElement('div');
      sourceBox.className = 'notebook-code-source';
      const editorHost = document.createElement('div');
      editorHost.className = 'notebook-cell-editor';
      sourceBox.append(editorHost);
      article.append(sourceBox);
      const editor = new PythonEditor(editorHost, {
        onChange: (source) => this.updateSource(cell.id, source),
        onRun: () => this.onRunCell(cell.id),
      });
      editor.setValue(cell.source);
      if (this.runningCells.has(cell.id)) editor.view.contentDOM.contentEditable = 'false';
      this.editors.set(cell.id, editor);
      const output = document.createElement('div');
      output.className = 'notebook-cell-output';
      output.setAttribute('aria-live', 'polite');
      this.outputHosts.set(cell.id, output);
      article.append(output);
      this.renderCellOutput(cell.id);
    } else {
      this.renderMarkdownCell(article, cell);
    }
    return article;
  }

  renderMarkdownCell(article, cell) {
    const content = document.createElement('div');
    content.className = 'notebook-markdown-content';
    const editor = document.createElement('textarea');
    editor.className = 'notebook-markdown-editor';
    editor.setAttribute('aria-label', 'Markdown cell source');
    editor.spellcheck = false;
    editor.value = cell.source;
    const preview = document.createElement('div');
    preview.className = 'notebook-markdown-preview';
    preview.hidden = true;
    renderMarkdown(preview, cell.source);
    const toggle = button('Preview', 'notebook-action notebook-markdown-toggle', 'Preview Markdown cell', () => {
      const showingPreview = !preview.hidden;
      preview.hidden = showingPreview;
      editor.hidden = !showingPreview;
      toggle.textContent = showingPreview ? 'Edit' : 'Preview';
      toggle.setAttribute('aria-label', showingPreview ? 'Edit Markdown cell' : 'Preview Markdown cell');
      if (showingPreview) editor.focus();
    });
    editor.addEventListener('input', () => {
      this.updateSource(cell.id, editor.value);
      renderMarkdown(preview, editor.value);
    });
    content.append(editor, preview);
    const controls = article.querySelector('.notebook-cell-controls');
    controls.prepend(toggle);
    article.append(content);
  }

  updateSource(cellId, source) {
    const cell = this.notebook.cells.find((entry) => entry.id === cellId);
    if (!cell || cell.source === source) return;
    cell.source = source;
    if (cell.cell_type === 'code') {
      cell.outputs = [];
      cell.execution_count = null;
      this.renderCellOutput(cellId);
    }
    this.emitChange();
  }

  renderCellOutput(cellId) {
    const cell = this.notebook.cells.find((entry) => entry.id === cellId);
    const host = this.outputHosts.get(cellId);
    if (!cell || !host) return;
    host.replaceChildren();
    for (const output of cell.outputs || []) {
      if (!output || typeof output !== 'object') continue;
      const pre = document.createElement('pre');
      if (output.output_type === 'stream') {
        pre.className = `notebook-output-text ${output.name === 'stderr' ? 'stderr' : 'stdout'}`;
        pre.textContent = outputText(output.text);
      } else if (output.output_type === 'error') {
        pre.className = 'notebook-output-text stderr';
        pre.textContent = [...(output.traceback || []), `${output.ename || 'Error'}: ${output.evalue || ''}`].join('\n');
      } else if (output.output_type === 'execute_result' || output.output_type === 'display_data') {
        pre.className = 'notebook-output-text execute-result';
        const plain = output.data?.['text/plain'];
        pre.textContent = plain === undefined ? '[Rich output is not rendered in PyStudio; text/plain output is supported.]' : outputText(plain);
      } else {
        pre.className = 'notebook-output-text';
        pre.textContent = '[Unsupported notebook output]';
      }
      host.append(pre);
    }
  }

  startCellRun(cellId) {
    const cell = this.notebook.cells.find((entry) => entry.id === cellId && entry.cell_type === 'code');
    if (!cell) throw new Error('Select a Python code cell to run.');
    this.activeCellId = cell.id;
    cell.outputs = [];
    cell.execution_count = ++this.executionCount;
    this.runningCells.add(cellId);
    const sourceEditor = this.editors.get(cellId);
    if (sourceEditor?.view?.contentDOM) sourceEditor.view.contentDOM.contentEditable = 'false';
    const article = this.host.querySelector(`[data-cell-id="${cellId}"]`);
    article?.classList.add('is-running');
    const runButton = article?.querySelector('.notebook-cell-run');
    if (runButton) { runButton.disabled = true; runButton.textContent = 'Running…'; }
    const deleteButton = article?.querySelector('.notebook-delete');
    if (deleteButton) deleteButton.disabled = true;
    this.renderCellOutput(cellId);
    this.emitChange();
    return cell.source;
  }

  appendOutput(cellId, text, kind = 'stdout') {
    const cell = this.notebook.cells.find((entry) => entry.id === cellId && entry.cell_type === 'code');
    if (!cell || !text) return;
    const value = String(text);
    const currentLength = (cell.outputs || []).reduce((sum, item) => sum + outputText(item?.text ?? item?.data?.['text/plain']).length, 0);
    const remaining = Math.max(0, MAX_CELL_OUTPUT_CHARS - currentLength);
    if (remaining <= 0) return;
    const bounded = value.slice(0, remaining);
    const name = kind === 'stderr' ? 'stderr' : 'stdout';
    const previous = cell.outputs.at(-1);
    if (previous?.output_type === 'stream' && previous.name === name) previous.text += bounded;
    else cell.outputs.push({ output_type: 'stream', name, text: bounded });
    if (bounded.length < value.length && !cell.outputs.some((item) => item.output_type === 'stream' && item.text.includes('[cell output truncated]'))) {
      cell.outputs.push({ output_type: 'stream', name: 'stderr', text: '\n[cell output truncated]\n' });
    }
    this.renderCellOutput(cellId);
  }

  appendResult(cellId, text) {
    const cell = this.notebook.cells.find((entry) => entry.id === cellId && entry.cell_type === 'code');
    if (!cell) return;
    const currentLength = (cell.outputs || []).reduce((sum, item) => sum + outputText(item?.text ?? item?.data?.['text/plain']).length, 0);
    const remaining = Math.max(0, MAX_CELL_OUTPUT_CHARS - currentLength);
    if (remaining <= 0) return;
    const value = String(text);
    const truncated = value.length > remaining;
    const marker = '\n[cell output truncated]';
    const visible = truncated
      ? `${value.slice(0, Math.max(0, remaining - marker.length))}${marker.slice(0, remaining)}`
      : value;
    cell.outputs.push({
      output_type: 'execute_result',
      execution_count: cell.execution_count,
      data: { 'text/plain': visible },
      metadata: {},
    });
    this.renderCellOutput(cellId);
  }

  finishCellRun(cellId, state = 'completed') {
    this.runningCells.delete(cellId);
    const article = this.host.querySelector(`[data-cell-id="${cellId}"]`);
    article?.classList.remove('is-running');
    if (state === 'error') article?.classList.add('has-error');
    else article?.classList.remove('has-error');
    const runButton = article?.querySelector('.notebook-cell-run');
    if (runButton) { runButton.disabled = false; runButton.textContent = 'Run'; }
    const deleteButton = article?.querySelector('.notebook-delete');
    if (deleteButton) deleteButton.disabled = false;
    const sourceEditor = this.editors.get(cellId);
    if (sourceEditor?.view?.contentDOM) sourceEditor.view.contentDOM.contentEditable = 'true';
    this.emitChange();
  }

  addCell(cellType) {
    const cell = cellType === 'code'
      ? { cell_type: 'code', execution_count: null, id: `cell-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, metadata: {}, outputs: [], source: '' }
      : { cell_type: 'markdown', id: `cell-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, metadata: {}, source: '' };
    this.notebook.cells.push(cell);
    if (cell.cell_type === 'code') this.activeCellId = cell.id;
    this.emitChange();
    this.render();
    requestAnimationFrame(() => this.editors.get(cell.id)?.focus());
  }

  deleteCell(cellId) {
    const index = this.notebook.cells.findIndex((cell) => cell.id === cellId);
    if (index < 0 || this.runningCells.has(cellId)) return;
    this.notebook.cells.splice(index, 1);
    this.runningCells.delete(cellId);
    if (this.activeCellId === cellId) this.activeCellId = this.notebook.cells.find((cell) => cell.cell_type === 'code')?.id || null;
    this.emitChange();
    this.render();
  }

  moveCell(cellId, direction) {
    const index = this.notebook.cells.findIndex((cell) => cell.id === cellId);
    const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= this.notebook.cells.length) return;
    const [cell] = this.notebook.cells.splice(index, 1);
    this.notebook.cells.splice(destination, 0, cell);
    this.emitChange();
    this.render();
    requestAnimationFrame(() => this.editors.get(cellId)?.focus());
  }
}
