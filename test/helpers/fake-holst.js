// Fake window.ds + mini-Yjs for EXECUTING real eval scripts in Node (L2 of
// the unit-testing plan). The fakes implement exactly the surface the
// scripts touch: yDoc maps, Yjs.Map/Text with toDelta, the domain store and
// singleDocumentStore (createFromString / createFromJSON paths).
// Fidelity boundary: this is a minimal model, not a Holst clone — drift is
// caught by the mandatory live cycle (docs/plans/…-unit-testing-cdp-layer.md).

class FakeYMap {
  constructor(fields = {}) { this.fields = fields; }
  get(k) { return this.fields[k]; }
  set(k, v) { this.fields[k] = v; }
  has(k) { return k in this.fields; }
  delete(k) { return delete this.fields[k]; }
  toJSON() { return JSON.parse(JSON.stringify(this.fields)); }
}

class FakeYText {
  constructor(plain = '') { this.plain = plain; this.ops = null; }
  // Slate paragraphs carry no \n; marked runs render like the app's Y-XML
  // toString: '<bold><color>x</color></bold>'.
  toDelta() {
    if (this.ops) return this.ops;
    return this.plain === '' ? [] : [{ insert: this.plain }];
  }
}

const wrapMarkup = (node) => {
  let h = node.text;
  if (node.color !== undefined) h = `<color>${h}</color>`;
  if (node.bold) h = `<bold>${h}</bold>`;
  if (node.italic) h = `<em>${h}</em>`;
  if (node.underline) h = `<u>${h}</u>`;
  if (node.strikethrough) h = `<s>${h}</s>`;
  return h;
};

class FakeDataTransfer {
  constructor() { this.data = {}; }
  setData(k, v) { this.data[k] = String(v); }
  getData(k) { return this.data[k]; }
}

// Navigation service mirroring the live app build (verified on Holst 0.0.7,
// issue #15): `zoom` is a GETTER-ONLY accessor on the prototype, so a bare
// `nav.zoom = x` write is a silent no-op under CDP's sloppy-mode evaluate.
// Camera moves must go through the method API; the setters record their
// calls so L2 tests can assert which method ran and with what args.
export class FakeNavigationService {
  #zoom;
  constructor({ zoom = 1, viewport = { x: 0, y: 0, width: 1600, height: 900 } } = {}) {
    this.#zoom = zoom;
    this.viewport = { ...viewport };
    this.calls = [];
  }
  get zoom() { return this.#zoom; }
  get viewportRect() { return this.viewport; }
  setViewportCenter(cx, cy) {
    this.calls.push({ method: 'setViewportCenter', args: [cx, cy] });
    this.viewport.x = cx - this.viewport.width / 2;
    this.viewport.y = cy - this.viewport.height / 2;
  }
  setZoomManual(z) { this.calls.push({ method: 'setZoomManual', args: [z] }); this.#zoom = z; }
  setZoom(z) { this.calls.push({ method: 'setZoom', args: [z] }); this.#zoom = z; }
}

export function createState() {
  const objectsMap = new Map(); // id → FakeYMap
  const documentsMap = new Map(); // docId → FakeYText
  const created = []; // creation expr outputs: { ref, id, documentId }
  const createdDocs = [];
  const svcCalls = []; // objectsService.update calls recorded for assertions

  const sds = {
    getEditor: () => null, // force the not-mounted write path
    removeEditor: () => {},
    createFromString: (docId, html) => {
      const plain = String(html).split(/<\/?p>/).filter((s) => s !== '').join('');
      documentsMap.set(docId, new FakeYText(plain));
    },
    createFromJSON: (docId, payload) => {
      const nodes = typeof payload.children === 'string' ? JSON.parse(payload.children) : payload.children;
      const ops = [];
      for (const wrapper of nodes) {
        for (const para of wrapper.children || []) {
          for (const t of para.children || []) {
            ops.push({ insert: { toString: () => wrapMarkup(t) }, props: t });
          }
        }
      }
      const ytext = new FakeYText(ops.map((o) => o.props.text).join(''));
      ytext.ops = ops;
      documentsMap.set(docId, ytext);
    },
  };

  // The app's own update path (mirrors ds.store.objectBuilder.getApp()). Only
  // `update` is faked — no `remove`, so delete exprs keep taking their raw
  // fallback in tests exactly as before.
  const app = {
    objectsService: {
      update: async (id, patch) => {
        svcCalls.push({ id, patch });
        const m = objectsMap.get(id);
        if (m) for (const k of Object.keys(patch)) m.set(k, patch[k]);
      },
    },
  };

  const yDoc = {
    getMap: (name) => (name === 'objects' ? objectsMap : documentsMap),
    transact: (fn) => fn(),
    toJSON: () => ({
      objects: Object.fromEntries([...objectsMap].map(([id, m]) => [id, m.toJSON()])),
      documents: Object.fromEntries([...documentsMap].map(([id, t]) => [id, t.plain])),
    }),
  };

  const state = {
    window: {
      ds: {
        yPersistence: { yDoc },
        store: {
          objects: {
            has: (id) => objectsMap.has(id),
            get: (id) => objectsMap.get(id),
            entries: () => objectsMap.entries(),
          },
          objectBuilder: { singleDocumentStore: sds, getApp: () => app },
        },
      },
      Yjs: { Map: FakeYMap, Text: FakeYText },
    },
    // -- introspection API for tests --
    objectsList: () => [...objectsMap].map(([id, m]) => ({ id, fields: m.fields })),
    documentsList: () => [...documentsMap].map(([docId, t]) => ({
      docId,
      text: t.plain,
      rendered: t.toDelta().map((d) => String(d.insert)).join(''),
    })),
    byIndex: () => created,
    svcCalls,
    setDoc: (docId, markup) => {
      const t = new FakeYText(markup.replace(/<[^>]*>/g, ''));
      t.ops = [{ insert: { toString: () => markup } }];
      documentsMap.set(docId, t);
    },
    createdDocs,
  };
  return state;
}

/**
 * Execute a real eval script against the fake ds. Fresh state unless one is
 * passed in (then it is mutated). ALWAYS returns the state (a Promise —
 * await it: some scripts are async IIFEs, e.g. the delete pass); the
 * script's own return value is exposed as `state.result`. Creation-shaped
 * results are additionally captured into state.byIndex().
 */
export async function runExpr(expr, state = createState()) {
  const { window, Yjs } = { window: state.window, Yjs: state.window.Yjs };
  const fn = new Function(
    'window', 'crypto', 'DataTransfer', 'Yjs',
    `"use strict";\nreturn (${expr});`
  );
  let result = fn(window, globalThis.crypto, FakeDataTransfer, Yjs);
  if (result && typeof result.then === 'function') result = await result;
  state.result = result;
  if (Array.isArray(result) && result.length && result[0] && result[0].ref && result[0].id) {
    state.byIndex().push(...result);
    for (const r of result) if (r.documentId) state.createdDocs.push(r.documentId);
  }
  return state;
}
