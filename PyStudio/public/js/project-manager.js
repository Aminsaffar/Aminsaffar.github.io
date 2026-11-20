export const STARTER_CODE = `name = input("What is your name? ")
print(f"Hello, {name}!")

number = int(input("Enter a number: "))
print(f"Your number multiplied by 2 is {number * 2}")
`;

const DB_NAME = 'pystudio-browser-ide';
const DB_VERSION = 1;
const AUTOSAVE_DELAY = 350;

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
  });
}

export class ProjectManager {
  constructor({ onChange = () => {}, onDirty = () => {}, onSaved = () => {} } = {}) {
    this.db = null;
    this.projects = [];
    this.activeProjectId = null;
    this.onChange = onChange;
    this.onDirty = onDirty;
    this.onSaved = onSaved;
    this.saveTimer = null;
    this.writeQueue = Promise.resolve();
  }

  async init() {
    if (!('indexedDB' in globalThis)) throw new Error('IndexedDB is not available in this browser.');
    this.db = await new Promise((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, DB_VERSION);
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error || new Error('Could not open local project storage.'));
      open.onblocked = () => reject(new Error('Project storage upgrade is blocked by another open PyStudio tab. Close older tabs and reload.'));
    });
    const store = this.db.transaction('projects', 'readonly').objectStore('projects');
    this.projects = (await requestResult(store.getAll())).sort((a, b) => a.createdAt - b.createdAt);
    const settingsStore = this.db.transaction('settings', 'readonly').objectStore('settings');
    const activeSetting = await requestResult(settingsStore.get('activeProjectId'));
    this.activeProjectId = this.projects.some((project) => project.id === activeSetting?.value) ? activeSetting.value : this.projects[0]?.id || null;
    if (!this.projects.length) {
      const project = this.newProjectRecord('Getting started');
      this.projects = [project];
      this.activeProjectId = project.id;
      await this.put('projects', project);
      await this.persistActiveProject();
    }
    this.emit('ready');
    return this.activeProject;
  }

  newProjectRecord(name) {
    const now = Date.now();
    const file = { id: makeId(), name: 'main.py', code: STARTER_CODE, updatedAt: now };
    return { id: makeId(), name: this.uniqueProjectName(name), files: [file], activeFileId: file.id, createdAt: now, updatedAt: now };
  }

  get activeProject() { return this.projects.find((project) => project.id === this.activeProjectId) || null; }
  get activeFile() { return this.activeProject?.files.find((file) => file.id === this.activeProject.activeFileId) || null; }

  async createProject(name) {
    const label = String(name || '').trim().slice(0, 40) || 'Untitled project';
    const project = this.newProjectRecord(label);
    this.projects.push(project);
    this.activeProjectId = project.id;
    await this.put('projects', project);
    await this.persistActiveProject();
    this.emit('project-created');
    return project;
  }

  uniqueProjectName(candidate) {
    let value = String(candidate || 'Untitled project').trim().slice(0, 40) || 'Untitled project';
    const existing = new Set(this.projects.map((project) => project.name.toLowerCase()));
    if (!existing.has(value.toLowerCase())) return value;
    let suffix = 2;
    while (existing.has(`${value} ${suffix}`.toLowerCase())) suffix += 1;
    return `${value} ${suffix}`;
  }

  async switchProject(id) {
    await this.saveNow();
    if (!this.projects.some((project) => project.id === id)) return;
    this.activeProjectId = id;
    await this.persistActiveProject();
    this.emit('project-switched');
  }

  async switchFile(id) {
    await this.saveNow();
    const project = this.activeProject;
    if (!project?.files.some((file) => file.id === id)) return;
    project.activeFileId = id;
    project.updatedAt = Date.now();
    await this.put('projects', project);
    this.emit('file-switched');
  }

  async createFile(name = 'untitled.py') {
    const project = this.activeProject;
    if (!project) throw new Error('Create a project first.');
    const safeName = this.normalizeFileName(name);
    if (project.files.some((file) => file.name.toLowerCase() === safeName.toLowerCase())) throw new Error(`A file named ${safeName} already exists.`);
    const file = { id: makeId(), name: safeName, code: '', updatedAt: Date.now() };
    project.files.push(file);
    project.activeFileId = file.id;
    project.updatedAt = Date.now();
    await this.put('projects', project);
    this.emit('file-created');
    return file;
  }

  normalizeFileName(name) {
    let result = String(name || '').trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').slice(0, 60);
    if (!result) result = 'untitled.py';
    if (!result.toLowerCase().endsWith('.py')) result += '.py';
    return result;
  }

  async renameFile(id, name) {
    const project = this.activeProject;
    const file = project?.files.find((entry) => entry.id === id);
    if (!file) throw new Error('That file no longer exists.');
    const safeName = this.normalizeFileName(name);
    if (project.files.some((entry) => entry.id !== id && entry.name.toLowerCase() === safeName.toLowerCase())) throw new Error(`A file named ${safeName} already exists.`);
    file.name = safeName;
    file.updatedAt = Date.now();
    project.updatedAt = Date.now();
    await this.put('projects', project);
    this.emit('file-renamed');
  }

  async deleteFile(id) {
    const project = this.activeProject;
    if (!project) return;
    const index = project.files.findIndex((file) => file.id === id);
    if (index < 0) return;
    project.files.splice(index, 1);
    if (project.activeFileId === id) project.activeFileId = project.files[Math.max(0, index - 1)]?.id || project.files[0]?.id || null;
    project.updatedAt = Date.now();
    await this.put('projects', project);
    this.emit('file-deleted');
  }

  async importFile(file) {
    if (!file) return null;
    const code = await file.text();
    const name = this.normalizeFileName(file.name);
    const project = this.activeProject;
    const existing = project?.files.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      existing.code = code;
      existing.updatedAt = Date.now();
      project.activeFileId = existing.id;
      project.updatedAt = Date.now();
      await this.put('projects', project);
      this.emit('file-imported');
      return existing;
    }
    const imported = { id: makeId(), name, code, updatedAt: Date.now() };
    project.files.push(imported);
    project.activeFileId = imported.id;
    project.updatedAt = Date.now();
    await this.put('projects', project);
    this.emit('file-imported');
    return imported;
  }

  updateFileContent(id, code) {
    const project = this.activeProject;
    const file = project?.files.find((entry) => entry.id === id);
    if (!file) return;
    file.code = String(code);
    file.updatedAt = Date.now();
    project.updatedAt = Date.now();
    this.onDirty();
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow().catch((error) => this.onSaved(false, error)), AUTOSAVE_DELAY);
  }

  async saveNow() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const project = this.activeProject;
    if (!project || !this.db) return;
    this.writeQueue = this.writeQueue.then(() => this.put('projects', project));
    await this.writeQueue;
    this.onSaved(true);
  }

  async persistActiveProject() {
    await this.put('settings', { key: 'activeProjectId', value: this.activeProjectId });
  }

  async put(storeName, value) {
    const tx = this.db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(structuredClone(value));
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Could not save to IndexedDB.'));
      tx.onabort = () => reject(tx.error || new Error('The IndexedDB transaction was aborted.'));
    });
  }

  emit(reason) { this.onChange({ reason, projects: this.projects, project: this.activeProject, file: this.activeFile }); }

  async destroy() { clearTimeout(this.saveTimer); await this.saveNow(); this.db?.close(); }
}
