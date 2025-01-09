import { autocompletion, closeBrackets } from '@codemirror/autocomplete';
import { javascript } from '@codemirror/lang-javascript';
import { bracketMatching } from '@codemirror/language';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import { keymap, lineNumbers } from '@codemirror/view';
import { evalKeymap, flashField, remoteEvalFlash } from '@flok-editor/cm-eval';
import { vim } from '@replit/codemirror-vim';
import { highlightExtension } from '@strudel/codemirror';
import { EditorView, minimalSetup } from 'codemirror';
import { yCollab } from 'y-codemirror.next';
import { UndoManager } from 'yjs';
import './style.css';
import { strudelTheme } from './theme';
import { highlightMiniLocations, updateMiniLocations } from '@strudel/codemirror';
import { getSettings } from './settings.js';

const supportedTargets = ['strudel', 'hydra', 'shader'];
export const currentEditors = new Map();
export const editorViews = new Map();

// we need to access these variables from the strudel iframe:
window.highlightMiniLocations = highlightMiniLocations; // we cannot import this for some reason
window.updateMiniLocations = updateMiniLocations; // we cannot import this for some reason
window.editorViews = editorViews;

// dynamic codemirror extensions
const extensions = {
  lineWrapping: (on) => (on ? EditorView.lineWrapping : []),
  lineNumbers: (on) => (on ? lineNumbers() : []),
  closeBrackets: (on) => (on ? closeBrackets() : []),
};

const compartments = Object.fromEntries(Object.keys(extensions).map((key) => [key, new Compartment()]));
const reconfigureExtension = (key, value, view) => {
  console.log('reconfigureExtension', key, value);
  view.dispatch({
    effects: compartments[key].reconfigure(extensions[key](value)),
  });
};

const initialSettings = Object.keys(compartments).map((key) =>
  compartments[key].of(extensions[key](getSettings()[key])),
);
// console.log('initialSettings', initialSettings);
export const updateExtensions = (settings, appliedSettings) => {
  const keys = Object.keys(extensions);
  for (let index in keys) {
    const key = keys[index];
    for (let [_, view] of editorViews) {
      if (settings[key] !== appliedSettings[key]) {
        // console.log('reconfigure', key, settings[key]);
        reconfigureExtension(key, settings[key], view);
      }
    }
  }
};

const flokBasicSetup = (doc) => {
  doc.collabCompartment = new Compartment(); // yeah this is dirty
  const text = doc.getText();
  const undoManager = new UndoManager(text);
  const web = true;
  const collab = yCollab(text, doc.session.awareness, {
    undoManager,
    showLocalCaret: true,
    scrollIntoView: false,
  });
  return [
    flashField(),
    highlightExtension,
    remoteEvalFlash(doc),
    Prec.high(evalKeymap(doc, { web, defaultMode: 'document' })),
    //collab,
    doc.collabCompartment.of(collab),
  ];
};

export const createEditor = (doc) => {
  // console.log('createEditor', doc);
  if (!['1', '2', '3', '4', '5', '6', '7', '8'].includes(doc.id)) {
    console.warn(`ignoring doc with id "${doc.id}". only slot1 and slot2 is allowed rn..`);
    return;
  }

  const stopKeys = ['Ctrl-.', 'Alt-.'];
  const state = EditorState.create({
    doc: doc.content,
    extensions: [
      minimalSetup,
      strudelTheme,
      flokBasicSetup(doc),
      javascript(),
      getSettings().vimMode ? vim() : [],
      autocompletion({ override: [] }),
      bracketMatching({ brackets: '()[]{}<>' }),
      ...initialSettings,
      Prec.highest(
        keymap.of([
          ...stopKeys.map((key) => ({
            key,
            run: () => {
              doc.evaluate('$: silence', { from: null, to: null });
              return true;
            },
          })),
        ]),
      ),
    ],
  });

  const slotsEl = document.querySelector('.slots');

  const side = parseInt(doc.id) % 2 == 0 ? 'right' : 'left';

  slotsEl.insertAdjacentHTML(
    'beforeend',
    `<div class="slot ${side}" id="slot-${doc.id}">
      <header>
        <select class="target">
          ${supportedTargets.map((target) => `<option value="${target}">${target}</option>`).join('\n')}
        </select>
        <button class="run">▶run</button>
      </header>
    <div class="editor"></div>
  </div>`,
  );

  const tabsEl = document.querySelector(`.tabs .${side}`);
  tabsEl.insertAdjacentHTML(
    'beforeend',
    `<button class="tab ${side}" id="tab-${doc.id}">
            ${doc.id} ${doc.target}
      </button>`,
  );

  document.querySelector(`#tab-${doc.id}`).addEventListener('click', () => {
    tabsEl.querySelectorAll('.tab').forEach((tab) => {
      tab.classList.remove('active');
    });
    document.querySelector(`#tab-${doc.id}`).classList.add('active');
    editorViews.get(doc.id)?.focus();

    slotsEl.querySelectorAll(`.slot.${side}`).forEach((slot) => {
      slot.classList.remove('active');
    });
    slotsEl.querySelector(`#slot-${doc.id}`).classList.add('active');
  });

  const editorEl = document.querySelector(`#slot-${doc.id} .editor`);
  const view = new EditorView({
    state,
    parent: editorEl,
  });
  editorViews.set(doc.id, view);

  const targetEl = document.querySelector(`#slot-${doc.id} .target`);
  if (!supportedTargets.includes(doc.target)) {
    targetEl.insertAdjacentHTML('beforeend', `<option value="${doc.target}">? ${doc.target} ?</option>`);
    console.warn(`unsupported target "${doc.target}" in doc "${doc.id}". evaluations will be ignored`);
  }
  targetEl.value = doc.target;

  targetEl.addEventListener('change', (e) => {
    doc.target = e.target.value;
  });
  doc.session.on(`change-target:${doc.id}`, () => {
    targetEl.value = doc.target;
  });

  const runButton = document.querySelector(`#slot-${doc.id} .run`);
  runButton.addEventListener('click', () => {
    doc.evaluate(doc.content, { from: 0, to: doc.content.length });
  });

  currentEditors.set(doc.id, { state });
};

export function deleteEditor(id) {
  editorViews.delete(id);
  currentEditors.delete(id);
  document.querySelector(`#slot-${id}`).remove();
}
