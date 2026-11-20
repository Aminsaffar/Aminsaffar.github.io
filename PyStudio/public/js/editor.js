import { basicSetup, EditorView } from 'codemirror';
import { python } from '@codemirror/lang-python';

const editorTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--editor-bg)', color: 'var(--text)' },
  '.cm-content': { caretColor: 'var(--accent)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
  '.cm-gutters': { backgroundColor: 'var(--editor-bg)', color: 'var(--text-dim)', border: 'none' },
  '.cm-activeLineGutter': { color: 'var(--accent)' },
  '.cm-activeLine': { backgroundColor: 'rgba(113,138,164,.055)' },
  '.cm-selectionBackground': { backgroundColor: 'rgba(83,215,207,.2)' },
  '&.cm-focused .cm-selectionBackground': { backgroundColor: 'rgba(83,215,207,.22)' },
  '.cm-tooltip': { backgroundColor: 'var(--panel-raised)', color: 'var(--text)', border: '1px solid var(--line)' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' },
}, { dark: true });

export class PythonEditor {
  constructor(host, { onChange = () => {}, onCursor = () => {}, onRun = () => {} } = {}) {
    this.host = host;
    this.onChange = onChange;
    this.onCursor = onCursor;
    this.onRun = onRun;
    this.suppressChange = false;
    this.view = new EditorView({
      doc: '',
      extensions: [
        basicSetup,
        python(),
        editorTheme,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !this.suppressChange) this.onChange(this.getValue());
          if (update.selectionSet || update.docChanged) this.reportCursor();
        }),
        EditorView.domEventHandlers({
          keydown: (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault();
              this.onRun();
              return true;
            }
            if (event.key === 'Tab' && !event.shiftKey) {
              // CodeMirror's standard Tab behavior inserts the configured indent unit.
              return false;
            }
            return false;
          },
        }),
      ],
      parent: host,
    });
  }

  getValue() { return this.view.state.doc.toString(); }

  setValue(value, { focus = false } = {}) {
    this.suppressChange = true;
    this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: String(value ?? '') } });
    this.suppressChange = false;
    if (focus) this.focus();
    this.reportCursor();
  }

  focus() { this.view.focus(); }

  reportCursor() {
    const line = this.view.state.doc.lineAt(this.view.state.selection.main.head);
    this.onCursor({ line: line.number, column: this.view.state.selection.main.head - line.from + 1 });
  }

  destroy() { this.view.destroy(); }
}
