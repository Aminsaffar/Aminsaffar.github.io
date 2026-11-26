import { PythonEditor } from './editor.js';
import { TerminalView } from './terminal.js';
import { ProjectManager } from './project-manager.js';
import { RuntimeManager } from './runtime-manager.js';
import { EXAMPLES } from '../examples/programs.js';
import { NotebookEditor } from './notebook.js';
import { createNotebookText, isNotebookFileName } from './notebook-format.js';

const $ = (selector) => document.querySelector(selector);
const terminal = new TerminalView();
let editor;
let projectManager;
let runtime;
let currentDialogMode = 'create';
let renamingFileId = null;
let notebookEditor;
let activeNotebookCellId = null;
let notebookRunAllActive = false;

function toast(message, kind = 'info') {
  const region = $('#toastRegion');
  const item = document.createElement('div');
  item.className = `toast ${kind}`;
  item.textContent = message;
  region.append(item);
  setTimeout(() => item.remove(), 3400);
}

function blockNavigationDuringNotebookRun() {
  if (!activeNotebookCellId && !notebookRunAllActive) return false;
  toast('Wait for the running notebook cell to finish before changing files or projects.', 'info');
  return true;
}

function updateFileControls(file = projectManager?.activeFile) {
  const notebook = Boolean(file && isNotebookFileName(file.name));
  $('#runButtonLabel').textContent = notebook ? 'Run cell' : 'Run';
  $('#runButton').title = notebook ? 'Run the active notebook cell (Ctrl+Enter)' : 'Run Python (Ctrl+Enter)';
  $('#downloadButtonLabel').textContent = notebook ? 'Download .ipynb' : 'Download .py';
  $('#downloadButton').title = notebook ? 'Download current Jupyter Notebook' : 'Download current Python file';
  $('#examplesSelect').hidden = notebook;
  $('#cursorPosition').hidden = notebook;
  $('#indentStatus').hidden = notebook;
  $('#documentTypeLabel').textContent = notebook ? 'Jupyter Notebook' : 'Python';
}

function setRuntimeState(state, label) {
  const chip = $('#runtimeChip');
  const key = String(state).toLowerCase().replaceAll(' ', '-');
  const chipState = ['ready', 'busy', 'loading', 'error'].includes(key) ? key : (key === 'running' || key === 'waiting' ? 'busy' : key === 'completed' ? 'ready' : key === 'stopped' ? 'ready' : 'loading');
  chip.dataset.state = chipState;
  $('#runtimeLabel').textContent = label || 'Python runtime';
  terminal.setStatus(state, label);
  const canRun = runtime?.ready && !runtime.busy;
  $('#runButton').disabled = !canRun;
  $('#stopButton').disabled = !runtime?.busy;
  $('#restartButton').disabled = !runtime?.isolated;
  $('#packageButton').disabled = !runtime?.ready || runtime?.busy;
  $('#installPackageConfirm').disabled = !runtime?.ready || runtime?.busy;
}

function renderProjects() {
  const select = $('#projectSelect');
  const selected = projectManager.activeProjectId;
  select.replaceChildren();
  for (const project of projectManager.projects) {
    const option = document.createElement('option');
    option.value = project.id;
    option.textContent = project.name;
    option.selected = project.id === selected;
    select.append(option);
  }
  $('#breadcrumbProject').textContent = projectManager.activeProject?.name || 'Project';
  $('#terminalCwd').textContent = `~/${(projectManager.activeProject?.name || 'project').toLowerCase().replace(/[^a-z0-9-]+/g, '-')}`;
}

function renderFiles() {
  const project = projectManager.activeProject;
  const list = $('#fileList');
  const tabs = $('#editorTabs');
  list.replaceChildren();
  tabs.replaceChildren();
  if (!project) return;

  if (!project.files.length) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-empty';
    empty.textContent = 'No files yet. Use + to create a Python file or notebook.';
    list.append(empty);
  }

  for (const file of project.files) {
    const active = file.id === project.activeFileId;
    const row = document.createElement('div');
    row.className = `file-item${active ? ' active' : ''}`;
    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'file-item-label';
    label.setAttribute('aria-current', active ? 'page' : 'false');
    label.addEventListener('click', () => switchFile(file.id));
    const icon = document.createElement('span');
    icon.className = 'file-item-icon';
    icon.textContent = isNotebookFileName(file.name) ? 'NB' : 'Py';
    const name = document.createElement('span');
    name.className = 'file-item-name';
    name.textContent = file.name;
    label.append(icon, name);

    const tools = document.createElement('span');
    tools.className = 'file-item-tools';
    const rename = document.createElement('button');
    rename.type = 'button';
    rename.className = 'file-tool';
    rename.textContent = '✎';
    rename.setAttribute('aria-label', `Rename ${file.name}`);
    rename.title = 'Rename file';
    rename.addEventListener('click', (event) => {
      event.stopPropagation();
      if (blockNavigationDuringNotebookRun()) return;
      openFileDialog('rename', file);
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'file-tool delete';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Delete ${file.name}`);
    remove.title = 'Delete file';
    remove.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (blockNavigationDuringNotebookRun()) return;
      if (!confirm(`Delete “${file.name}” from this project? This cannot be undone.`)) return;
      await projectManager.deleteFile(file.id);
      syncEditorFromProject();
      toast(`${file.name} deleted.`);
    });
    tools.append(rename, remove);
    row.append(label, tools);
    list.append(row);

    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = `editor-tab${active ? ' active' : ''}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(active));
    tab.title = file.name;
    const tabIcon = document.createElement('span');
    tabIcon.className = 'file-item-icon';
    tabIcon.textContent = isNotebookFileName(file.name) ? 'NB' : 'Py';
    const tabName = document.createElement('span');
    tabName.className = 'tab-name';
    tabName.textContent = file.name;
    tab.append(tabIcon, tabName);
    tab.addEventListener('click', () => switchFile(file.id));
    tabs.append(tab);
  }
  const activeFile = projectManager.activeFile;
  $('#breadcrumbFile').textContent = activeFile?.name || 'No file selected';
  $('#editorHost').setAttribute('aria-label', activeFile ? `${isNotebookFileName(activeFile.name) ? 'Jupyter notebook' : 'Python source code'}: ${activeFile.name}` : 'Document editor');
  updateFileControls(activeFile);
}

function syncEditorFromProject({ focus = false } = {}) {
  const file = projectManager.activeFile;
  const host = $('#editorHost');
  notebookEditor?.destroy();
  notebookEditor = null;
  editor?.destroy();
  editor = null;
  host.replaceChildren();
  if (file && isNotebookFileName(file.name)) {
    try {
      notebookEditor = new NotebookEditor(host, file.code || createNotebookText(), {
        onChange: (content) => {
          if (projectManager.activeFile?.id === file.id) projectManager.updateFileContent(file.id, content);
        },
        onRunCell: (cellId) => runNotebookCell(cellId),
        onRunAll: runAllNotebook,
      });
      if (focus) requestAnimationFrame(() => notebookEditor?.editors.get(notebookEditor.getActiveCellId())?.focus());
    } catch (error) {
      host.textContent = `Could not open notebook: ${error.message}`;
      toast(error.message, 'error');
    }
  } else {
    editor = new PythonEditor(host, {
      onChange: (code) => {
        const activeFile = projectManager.activeFile;
        if (activeFile) projectManager.updateFileContent(activeFile.id, code);
      },
      onCursor: ({ line, column }) => { $('#cursorPosition').textContent = `Ln ${line}, Col ${column}`; },
      onRun: runCurrentFile,
    });
    editor.setValue(file?.code ?? '', { focus });
  }
  renderProjects();
  renderFiles();
}

async function switchFile(id) {
  if (blockNavigationDuringNotebookRun()) return;
  try {
    await projectManager.saveNow();
    await projectManager.switchFile(id);
    syncEditorFromProject({ focus: true });
  } catch (error) { toast(error.message, 'error'); }
}

function updateFileTypeHint() {
  const file = projectManager?.activeProject?.files.find((entry) => entry.id === renamingFileId);
  const extension = currentDialogMode === 'rename'
    ? (file?.name.match(/\.(?:py|ipynb)$/i)?.[0] || '.py')
    : ($('#fileTypeSelect').value === 'ipynb' ? '.ipynb' : '.py');
  $('#fileNameInput').placeholder = currentDialogMode === 'rename' ? `lesson${extension}` : `lesson${extension}`;
  $('#fileNameHint').textContent = currentDialogMode === 'rename'
    ? `Renaming keeps the ${extension} file type.`
    : `New files use ${extension}. Python (.py) remains the default.`;
}

function openFileDialog(mode, file = null) {
  currentDialogMode = mode;
  renamingFileId = file?.id || null;
  $('#fileDialogTitle').textContent = mode === 'rename' ? 'Rename file' : 'Create a file';
  $('#fileDialogEyebrow').textContent = mode === 'rename' ? 'FILE' : 'NEW FILE';
  $('#fileConfirm').textContent = mode === 'rename' ? 'Save name' : 'Create file';
  $('#fileNameInput').value = mode === 'rename' ? (file?.name || '') : '';
  $('#fileTypeRow').hidden = mode === 'rename';
  $('#fileTypeSelect').value = 'py';
  updateFileTypeHint();
  $('#fileDialog').showModal();
  $('#fileNameInput').focus();
}

function downloadCurrentFile() {
  const file = projectManager.activeFile;
  if (!file) { toast('Create a file or notebook first.', 'error'); return; }
  const notebook = isNotebookFileName(file.name);
  const content = notebook ? (notebookEditor?.serialize() || file.code) : (editor?.getValue() ?? file.code);
  const blob = new Blob([content], { type: notebook ? 'application/x-ipynb+json;charset=utf-8' : 'text/x-python;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`${file.name} downloaded.`, 'success');
}

async function runNotebookCell(cellId) {
  if (!notebookEditor) return { state: 'error' };
  if (!runtime?.ready) {
    toast(runtime?.isolated ? 'Python is still loading. Try again when the runtime is ready.' : 'Enable cross-origin isolation in this browser before running Python.', 'error');
    return { state: 'error' };
  }
  if (runtime.busy) {
    toast('Python is already running. Stop it before starting another cell.', 'error');
    return { state: 'error' };
  }
  let code;
  try { code = notebookEditor.startCellRun(cellId); }
  catch (error) { toast(error.message, 'error'); return { state: 'error' }; }
  activeNotebookCellId = cellId;
  try {
    const runId = await runtime.run(code, { displayResult: true, waitForCompletion: true });
    const result = await runtime.waitForRun(runId);
    notebookEditor?.finishCellRun(cellId, result.state);
    return result;
  } catch (error) {
    notebookEditor?.appendOutput(cellId, `${error.message || String(error)}\n`, 'stderr');
    notebookEditor?.finishCellRun(cellId, 'error');
    toast(error.message || 'Could not run notebook cell.', 'error');
    return { state: 'error' };
  } finally {
    if (activeNotebookCellId === cellId) activeNotebookCellId = null;
    if (window.matchMedia('(max-width: 680px)').matches) selectMobileView('editor');
  }
}

async function runAllNotebook() {
  if (!notebookEditor || notebookRunAllActive) return;
  if (runtime?.busy) { toast('Stop the current Python run before running the notebook.', 'error'); return; }
  const cellIds = notebookEditor.getCodeCellIds();
  if (!cellIds.length) { toast('Add a code cell before running the notebook.', 'error'); return; }
  notebookRunAllActive = true;
  const runAllButton = $('#editorHost').querySelector('.notebook-run-all');
  if (runAllButton) runAllButton.disabled = true;
  try {
    for (const cellId of cellIds) {
      const result = await runNotebookCell(cellId);
      if (result.state !== 'completed') break;
    }
  } finally {
    notebookRunAllActive = false;
    if (runAllButton?.isConnected) runAllButton.disabled = false;
  }
}

async function runCurrentFile() {
  const file = projectManager?.activeFile;
  if (file && isNotebookFileName(file.name)) {
    const cellId = notebookEditor?.getActiveCellId();
    if (!cellId) { toast('Select or add a code cell to run.', 'error'); return; }
    return runNotebookCell(cellId);
  }
  if (!runtime?.ready) {
    toast(runtime?.isolated ? 'Python is still loading. Try again when the runtime is ready.' : 'Enable cross-origin isolation in this browser before running Python.', 'error');
    return;
  }
  try {
    terminal.clear();
    terminal.setDuration(null);
    await runtime.run(editor?.getValue() ?? '');
    if (window.matchMedia('(max-width: 680px)').matches) selectMobileView('terminal');
  } catch (error) {
    terminal.append(error.message || String(error), 'stderr');
    toast(error.message || 'Could not run Python.', 'error');
  }
}

function selectMobileView(view) {
  const panels = $('#panels');
  const editorTab = $('#mobileEditorTab');
  const terminalTab = $('#mobileTerminalTab');
  panels.classList.toggle('mobile-view-terminal', view === 'terminal');
  panels.classList.toggle('mobile-view-editor', view !== 'terminal');
  editorTab.classList.toggle('active', view !== 'terminal');
  terminalTab.classList.toggle('active', view === 'terminal');
  editorTab.setAttribute('aria-selected', String(view !== 'terminal'));
  terminalTab.setAttribute('aria-selected', String(view === 'terminal'));
}

function setTheme(theme) {
  const normalized = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = normalized;
  localStorage.setItem('pystudio-theme', normalized);
  $('#themeButton').setAttribute('aria-label', `Switch to ${normalized === 'dark' ? 'light' : 'dark'} theme`);
  document.querySelector('meta[name="theme-color"]').content = normalized === 'dark' ? '#0b0f15' : '#eff3f6';
}

function populateExamples() {
  const select = $('#examplesSelect');
  for (const example of EXAMPLES) {
    const option = document.createElement('option');
    option.value = example.id;
    option.textContent = `${example.title} · ${example.level}`;
    select.append(option);
  }
}

function setupResizer() {
  const resizer = $('#panelResizer');
  const panels = $('#panels');
  const editorPanel = $('#editorPanel');
  const saved = Number(localStorage.getItem('pystudio-editor-height'));
  if (saved > 140) editorPanel.style.flex = `0 0 ${saved}px`;
  let startY = 0;
  let startHeight = 0;
  resizer.addEventListener('pointerdown', (event) => {
    if (window.matchMedia('(max-width: 680px)').matches) return;
    startY = event.clientY;
    startHeight = editorPanel.getBoundingClientRect().height;
    resizer.classList.add('dragging');
    resizer.setPointerCapture(event.pointerId);
  });
  resizer.addEventListener('pointermove', (event) => {
    if (!resizer.hasPointerCapture(event.pointerId)) return;
    const available = panels.getBoundingClientRect().height;
    const next = Math.max(140, Math.min(available - 135, startHeight + (event.clientY - startY)));
    editorPanel.style.flex = `0 0 ${next}px`;
  });
  const finish = () => {
    if (!resizer.classList.contains('dragging')) return;
    resizer.classList.remove('dragging');
    localStorage.setItem('pystudio-editor-height', String(Math.round(editorPanel.getBoundingClientRect().height)));
  };
  resizer.addEventListener('pointerup', finish);
  resizer.addEventListener('pointercancel', finish);
  resizer.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const height = editorPanel.getBoundingClientRect().height + (event.key === 'ArrowDown' ? 20 : -20);
    editorPanel.style.flex = `0 0 ${Math.max(140, height)}px`;
    localStorage.setItem('pystudio-editor-height', String(Math.round(editorPanel.getBoundingClientRect().height)));
  });
}

function setSaveState(state, error) {
  const indicator = $('#saveIndicator');
  if (state === 'dirty') {
    indicator.textContent = 'Saving…';
    indicator.className = 'save-indicator saving';
    $('#savedAt').textContent = 'Saving';
  } else if (state === 'saved') {
    indicator.textContent = 'All changes saved';
    indicator.className = 'save-indicator saved';
    $('#savedAt').textContent = `Saved ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } else {
    indicator.textContent = 'Save failed';
    indicator.className = 'save-indicator';
    $('#savedAt').textContent = 'Save failed';
    toast(`Could not save project: ${error?.message || 'IndexedDB error'}`, 'error');
  }
}

function bindEvents() {
  $('#runButton').addEventListener('click', runCurrentFile);
  $('#stopButton').addEventListener('click', () => {
    terminal.cancelInput(true);
    runtime.stop();
  });
  $('#restartButton').addEventListener('click', async () => {
    terminal.cancelInput(true);
    terminal.append('Restarting Python runtime…\n', 'system');
    try { await runtime.restart(); toast('Python runtime restarted.', 'success'); }
    catch (error) { toast(error.message, 'error'); }
  });
  $('#saveButton').addEventListener('click', async () => {
    try { await projectManager.saveNow(); toast('Project saved in this browser.', 'success'); }
    catch (error) { toast(error.message, 'error'); }
  });
  $('#downloadButton').addEventListener('click', downloadCurrentFile);
  $('#themeButton').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  $('#helpButton').addEventListener('click', () => $('#helpDialog').showModal());
  $('#clearTerminalButton').addEventListener('click', () => terminal.clear());
  $('#copyTerminalButton').addEventListener('click', async () => {
    try { await terminal.copy(); toast('Terminal output copied.', 'success'); }
    catch { toast('Clipboard access is unavailable. Select and copy the terminal text instead.', 'error'); }
  });
  $('#downloadTerminalButton').addEventListener('click', () => terminal.download());
  $('#newProjectButton').addEventListener('click', () => {
    if (blockNavigationDuringNotebookRun()) return;
    $('#projectNameInput').value = '';
    $('#projectDialog').showModal();
    $('#projectNameInput').focus();
  });
  $('#projectForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (event.submitter?.value === 'cancel') { $('#projectDialog').close(); return; }
    if (blockNavigationDuringNotebookRun()) return;
    const name = $('#projectNameInput').value.trim();
    if (!name) return;
    try {
      await projectManager.createProject(name);
      syncEditorFromProject();
      $('#projectDialog').close();
      terminal.clear();
      toast(`Project “${projectManager.activeProject.name}” created.`, 'success');
    } catch (error) { toast(error.message, 'error'); }
  });
  $('#projectSelect').addEventListener('change', async (event) => {
    if (blockNavigationDuringNotebookRun()) {
      event.target.value = projectManager.activeProjectId;
      return;
    }
    await projectManager.switchProject(event.target.value);
    syncEditorFromProject();
    terminal.clear();
  });
  $('#newFileButton').addEventListener('click', () => {
    if (blockNavigationDuringNotebookRun()) return;
    openFileDialog('create');
  });
  $('#fileTypeSelect').addEventListener('change', updateFileTypeHint);
  $('#fileForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (event.submitter?.value === 'cancel') { $('#fileDialog').close(); return; }
    if (blockNavigationDuringNotebookRun()) return;
    const name = $('#fileNameInput').value.trim();
    if (!name) return;
    try {
      if (currentDialogMode === 'rename') await projectManager.renameFile(renamingFileId, name);
      else {
        const extension = $('#fileTypeSelect').value === 'ipynb' ? '.ipynb' : '.py';
        const baseName = name.replace(/\.(?:py|ipynb)$/i, '') || 'untitled';
        await projectManager.createFile(`${baseName}${extension}`, extension === '.ipynb' ? createNotebookText() : '');
      }
      syncEditorFromProject({ focus: true });
      $('#fileDialog').close();
      toast(currentDialogMode === 'rename' ? 'File renamed.' : 'File created.', 'success');
    } catch (error) { toast(error.message, 'error'); }
  });
  $('#importFileButton').addEventListener('click', () => {
    if (blockNavigationDuringNotebookRun()) return;
    $('#fileImportInput').click();
  });
  $('#fileImportInput').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (blockNavigationDuringNotebookRun()) { event.target.value = ''; return; }
    if (!/\.(?:py|ipynb)$/i.test(file.name)) { toast('Choose a .py Python file or a .ipynb Jupyter notebook.', 'error'); event.target.value = ''; return; }
    try {
      await projectManager.importFile(file);
      syncEditorFromProject({ focus: true });
      toast(`${file.name} imported.`, 'success');
    } catch (error) { toast(error.message, 'error'); }
    event.target.value = '';
  });
  $('#packageButton').addEventListener('click', () => {
    $('#packageNameInput').value = '';
    $('#packageDialog').showModal();
    $('#packageNameInput').focus();
  });
  $('#packageForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (event.submitter?.value === 'cancel') { $('#packageDialog').close(); return; }
    const packageName = $('#packageNameInput').value.trim();
    if (!packageName) return;
    try {
      await runtime.installPackage(packageName);
      $('#packageDialog').close();
      terminal.append(`Installing ${packageName}…\n`, 'system');
    } catch (error) { toast(error.message, 'error'); }
  });
  $('#examplesSelect').addEventListener('change', (event) => {
    const selected = EXAMPLES.find((example) => example.id === event.target.value);
    event.target.value = '';
    if (!selected || !projectManager.activeFile) return;
    if (isNotebookFileName(projectManager.activeFile.name)) { toast('Examples can be loaded into a .py file, not a notebook.', 'info'); return; }
    if (editor.getValue().trim() && !confirm(`Replace the contents of ${projectManager.activeFile.name} with “${selected.title}”?`)) return;
    editor.setValue(selected.code, { focus: true });
    projectManager.updateFileContent(projectManager.activeFile.id, selected.code);
    toast(`Loaded: ${selected.title}`, 'success');
  });
  $('#mobileEditorTab').addEventListener('click', () => selectMobileView('editor'));
  $('#mobileTerminalTab').addEventListener('click', () => selectMobileView('terminal'));
  $('#dismissIsolation').addEventListener('click', () => { $('#isolationBanner').hidden = true; });
  $('#collapseSidebar').addEventListener('click', () => {
    $('#sidebar').classList.toggle('collapsed');
    const collapsed = $('#sidebar').classList.contains('collapsed');
    $('#collapseSidebar').setAttribute('aria-label', collapsed ? 'Expand file explorer' : 'Collapse file explorer');
    $('#collapseSidebar').title = collapsed ? 'Expand file explorer' : 'Collapse file explorer';
  });
  window.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      projectManager.saveNow().then(() => toast('Project saved.', 'success')).catch((error) => toast(error.message, 'error'));
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n' && !event.shiftKey) {
      event.preventDefault();
      if (blockNavigationDuringNotebookRun()) return;
      openFileDialog('create');
    }
  });
  window.addEventListener('beforeunload', () => { projectManager.saveNow().catch(() => {}); });
}

async function initialize() {
  const savedTheme = localStorage.getItem('pystudio-theme') || 'dark';
  setTheme(savedTheme);
  populateExamples();
  setupResizer();
  try {
    projectManager = new ProjectManager({
      onChange: () => { renderProjects(); renderFiles(); },
      onDirty: () => setSaveState('dirty'),
      onSaved: (success, error) => setSaveState(success ? 'saved' : 'error', error),
    });
    await projectManager.init();
  } catch (error) {
    terminal.append(`Local project storage could not start: ${error.message}\n`, 'stderr');
    toast('Project persistence is unavailable. Check browser storage settings.', 'error');
    throw error;
  }
  renderProjects();
  renderFiles();
  syncEditorFromProject();
  bindEvents();
  setSaveState('saved');

  runtime = new RuntimeManager({
    onStatus: setRuntimeState,
    onProgress: (message, percent) => {
      if (message) $('#runtimeLabel').textContent = percent ? `Python ${percent}%` : message;
    },
    onReady: (version) => {
      $('#isolationBanner').hidden = true;
      $('#footerMessage').textContent = `Pyodide ${version} · Runs on this device`;
      toast('Python runtime is ready.', 'success');
    },
    onOutput: (text, kind) => {
      if (activeNotebookCellId && notebookEditor && (kind === 'stdout' || kind === 'stderr' || kind === 'result')) {
        if (kind === 'result') notebookEditor.appendResult(activeNotebookCellId, text);
        else notebookEditor.appendOutput(activeNotebookCellId, text, kind);
        return;
      }
      terminal.append(text, kind === 'stderr' ? 'stderr' : kind === 'system' ? 'system' : 'stdout');
    },
    onInputRequest: (submit) => {
      if (activeNotebookCellId && window.matchMedia('(max-width: 680px)').matches) {
        terminal.append('Notebook cell requested input. Its prompt is shown in the active cell.\n', 'system');
        selectMobileView('terminal');
      }
      terminal.requestInput(submit);
    },
    onError: (message) => {
      if (activeNotebookCellId && notebookEditor) notebookEditor.appendOutput(activeNotebookCellId, `${message}\n`, 'stderr');
      else terminal.append(`${message}\n`, 'stderr');
    },
    onDuration: (duration) => terminal.setDuration(duration),
  });
  if (!runtime.isolated) $('#isolationBanner').hidden = false;
  try {
    await runtime.start();
  } catch (error) {
    if (runtime.isolated) terminal.append(`${error.message}\n`, 'stderr');
    else $('#isolationBanner').hidden = false;
    setRuntimeState('error', runtime.isolated ? 'Runtime failed' : 'Isolation required');
  }
  window.addEventListener('pagehide', () => { projectManager.destroy().catch(() => {}); }, { once: true });
}

initialize().catch((error) => {
  console.error(error);
  toast(`PyStudio could not initialize: ${error.message}`, 'error');
});
