const CELL_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function makeCellId() {
  return globalThis.crypto?.randomUUID?.().replaceAll('-', '').slice(0, 8)
    || `cell-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function isNotebookFileName(name) {
  return String(name || '').toLowerCase().endsWith('.ipynb');
}

export function sourceToText(source) {
  if (typeof source === 'string') return source;
  if (Array.isArray(source) && source.every((part) => typeof part === 'string')) return source.join('');
  if (source == null) return '';
  throw new Error('Notebook cell source must be text or an array of text lines.');
}

export function sourceToArray(source) {
  const text = String(source ?? '');
  if (!text) return [];
  return text.match(/[^\n]*\n|[^\n]+/g) || [];
}

export function createNotebook() {
  return {
    cells: [
      {
        cell_type: 'markdown',
        id: makeCellId(),
        metadata: {},
        source: '# PyStudio notebook\n\nRun Python cells with the buttons or Ctrl/⌘ + Enter. Variables stay available to later cells.',
      },
      {
        cell_type: 'code',
        execution_count: null,
        id: makeCellId(),
        metadata: {},
        outputs: [],
        source: 'print("Hello from PyStudio!")\n',
      },
    ],
    metadata: {
      kernelspec: { display_name: 'Python 3 (Pyodide)', language: 'python', name: 'python3' },
      language_info: { name: 'python' },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
}

export function createNotebookText() {
  return JSON.stringify(createNotebook(), null, 2);
}

export function parseNotebook(text) {
  let notebook;
  try {
    notebook = JSON.parse(String(text ?? ''));
  } catch {
    throw new Error('This .ipynb file is not valid JSON.');
  }
  if (!notebook || typeof notebook !== 'object' || Array.isArray(notebook) || notebook.nbformat !== 4 || !Array.isArray(notebook.cells)) {
    throw new Error('PyStudio supports Jupyter Notebook nbformat 4 files with a cells array.');
  }
  const cells = notebook.cells.map((cell, index) => {
    if (!cell || typeof cell !== 'object' || !['code', 'markdown', 'raw'].includes(cell.cell_type)) {
      throw new Error(`Notebook cell ${index + 1} has an unsupported cell type.`);
    }
    const normalized = {
      ...cell,
      cell_type: cell.cell_type,
      id: CELL_ID_PATTERN.test(String(cell.id || '')) ? String(cell.id) : makeCellId(),
      metadata: cell.metadata && typeof cell.metadata === 'object' ? cell.metadata : {},
      source: sourceToText(cell.source),
    };
    if (normalized.cell_type === 'code') {
      normalized.outputs = Array.isArray(cell.outputs) ? cell.outputs : [];
      normalized.execution_count = Number.isInteger(cell.execution_count) ? cell.execution_count : null;
    } else {
      delete normalized.outputs;
      delete normalized.execution_count;
    }
    return normalized;
  });
  return {
    ...notebook,
    cells,
    metadata: notebook.metadata && typeof notebook.metadata === 'object' ? notebook.metadata : {},
    nbformat: 4,
    nbformat_minor: Math.max(5, Number(notebook.nbformat_minor) || 0),
  };
}

export function serializeNotebook(notebook) {
  const output = JSON.parse(JSON.stringify(notebook));
  output.nbformat = 4;
  output.nbformat_minor = Math.max(5, Number(output.nbformat_minor) || 0);
  output.cells = output.cells.map((cell) => ({ ...cell, source: sourceToArray(cell.source) }));
  return JSON.stringify(output, null, 2);
}
