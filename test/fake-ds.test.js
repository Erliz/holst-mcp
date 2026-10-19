import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runExpr } from './helpers/fake-holst.js';
import {
  buildBatchCreationExpr,
  buildBatchArrowsExpr,
  buildBatchTextWriteExpr,
  buildBoardContentExpr,
  buildStyleFieldsExpr,
  buildNativeStyleUpdateExpr,
  buildKindExpr,
  buildArrowLabelsStateExpr,
} from '../src/eval-scripts.js';
import { segmentsToSlateNodes } from '../src/text-style.js';
import { randomUUID } from 'node:crypto';

// L2: real eval scripts executed against a fake window.ds + mini-Yjs.
// These tests would have caught the arrowsBehind-below-frame bug and
// catch field-name/structure regressions without a running Holst.

describe('L2: batch creation mutates the fake yDoc', () => {
  test('shape with typography extras lands in fields', async () => {
    const state = await runExpr(buildBatchCreationExpr([{
      kind: 'shape', ref: 'a', x: 1, y: 2, width: 10, height: 20, shapeType: 'round-rect',
      fillColor: { color: 0xbf4520, opacity: 0.08 }, strokeColor: { color: 0x202020, opacity: 1 },
      strokeWidth: 2.2, fixedSize: true, borderRadius: 24, fontSize: 36,
      hasDocument: true, text: 'hi',
    }]));
    const obj = state.objectsList()[0];
    assert.equal(obj.fields.type, 'shape');
    assert.equal(obj.fields.borderRadius, 24);
    assert.equal(obj.fields.fontSize, 36);
    assert.deepEqual(obj.fields.fillColor, { color: 0xbf4520, opacity: 0.08 });
    assert.equal(state.createdDocs.length, 1); // documentId seeded with empty Y.Text
  });
});

describe('L2: arrowsBehind layering (quadrant regression)', () => {
  const makeDiagram = async (behind) => {
    const creations = [
      { kind: 'frame', ref: 'f', x: 0, y: 0, width: 900, height: 500, labelText: 'z', fillColor: { color: 0xffffff, opacity: 1 }, backgroundStyle: 2, hasDocument: false },
      { kind: 'shape', ref: 'n1', x: 100, y: 100, width: 50, height: 50, shapeType: 'square', fillColor: { color: 0xffffff, opacity: 1 }, strokeColor: { color: 0x202020, opacity: 1 }, strokeWidth: 2, fixedSize: true, hasDocument: true, text: 'a' },
      { kind: 'shape', ref: 'n2', x: 200, y: 200, width: 50, height: 50, shapeType: 'square', fillColor: { color: 0xffffff, opacity: 1 }, strokeColor: { color: 0x202020, opacity: 1 }, strokeWidth: 2, fixedSize: true, hasDocument: true, text: 'b' },
    ];
    let state = await runExpr(buildBatchCreationExpr(creations));
    const byIndex = state.byIndex();
    state = await runExpr(buildBatchArrowsExpr(byIndex, [{
      arrowType: 'straight', strokeColor: 0x2e5aa8, strokeStyle: 'solid',
      arrowheadEnd: 'none', text: 'link', textPosition: 0.5,
      from: { refIndex: 1 }, to: { refIndex: 2 },
    }], behind), state);
    return state;
  };

  test('behind=true: arrow z is BETWEEN frame and nodes', async () => {
    const s = await makeDiagram(true);
    const z = (type) => s.objectsList().filter((o) => o.fields.type === type).map((o) => o.fields.zIndex);
    const frameZ = z('frame')[0];
    const arrowZ = z('arrow')[0];
    const nodeZ = Math.min(...z('shape'));
    assert.ok(frameZ < arrowZ, `frame ${frameZ} < arrow ${arrowZ}`);
    assert.ok(arrowZ < nodeZ, `arrow ${arrowZ} < min node ${nodeZ}`);
  });

  test('behind=false: arrow z is above nodes', async () => {
    const s = await makeDiagram(false);
    const arrow = s.objectsList().find((o) => o.fields.type === 'arrow');
    const nodeZ = Math.max(...s.objectsList().filter((o) => o.fields.type === 'shape').map((o) => o.fields.zIndex));
    assert.ok(arrow.fields.zIndex > nodeZ);
  });

  test('arrow label payload lands in texts field', async () => {
    const s = await makeDiagram(true);
    const arrow = s.objectsList().find((o) => o.fields.type === 'arrow');
    assert.equal(arrow.fields.texts.length, 1);
    assert.equal(arrow.fields.texts[0].text, 'link');
    assert.equal(arrow.fields.arrowheadEnd, 'none');
    assert.deepEqual(arrow.fields.strokeColor, { color: 0x2e5aa8, opacity: 1 });
  });
});

describe('L2: arrow label verification expr (issue #3)', () => {
  const makeLabeledArrow = async () => {
    let state = await runExpr(buildBatchCreationExpr([{
      kind: 'shape', ref: 'n1', x: 0, y: 0, width: 50, height: 50, shapeType: 'square',
      fillColor: { color: 0xffffff, opacity: 1 }, strokeColor: { color: 0x202020, opacity: 1 },
      strokeWidth: 2, fixedSize: true, hasDocument: false,
    }]));
    const byIndex = state.byIndex();
    state = await runExpr(buildBatchArrowsExpr(byIndex, [{
      arrowType: 'straight', strokeColor: 0x2e5aa8, strokeStyle: 'solid',
      text: 'link', textPosition: 0.5,
      from: { refIndex: 0 }, to: { point: { x: 100, y: 100 } },
    }], false), state);
    const arrow = state.objectsList().find((o) => o.fields.type === 'arrow');
    return { state, arrowId: arrow.id };
  };

  test('render API present: returns the mounted label string', async () => {
    const { state, arrowId } = await makeLabeledArrow();
    // simulate the app domain object exposing the render-layer API
    state.window.ds.store.objects.get(arrowId).getTextOnArrowString = () => 'link';
    const st2 = await runExpr(buildArrowLabelsStateExpr([arrowId]), state);
    assert.deepEqual(st2.result[arrowId], { str: 'link' });
  });

  test('render API absent: reports apiMissing (fail-open, not an error)', async () => {
    const { state, arrowId } = await makeLabeledArrow();
    const st2 = await runExpr(buildArrowLabelsStateExpr([arrowId]), state);
    assert.deepEqual(st2.result[arrowId], { apiMissing: true });
  });

  test('unknown id: reports missing', async () => {
    const { state } = await makeLabeledArrow();
    const st2 = await runExpr(buildArrowLabelsStateExpr(['no-such-id']), state);
    assert.deepEqual(st2.result['no-such-id'], { missing: true });
  });

  test('label not mounted yet: API returns empty/other string', async () => {
    const { state, arrowId } = await makeLabeledArrow();
    state.window.ds.store.objects.get(arrowId).getTextOnArrowString = () => '';
    const st2 = await runExpr(buildArrowLabelsStateExpr([arrowId]), state);
    assert.deepEqual(st2.result[arrowId], { str: '' });
  });

  test('render API throws: reports error instead of failing the whole expr', async () => {
    const { state, arrowId } = await makeLabeledArrow();
    state.window.ds.store.objects.get(arrowId).getTextOnArrowString = () => { throw new Error('boom'); };
    const st2 = await runExpr(buildArrowLabelsStateExpr([arrowId]), state);
    assert.ok(String(st2.result[arrowId].error).includes('boom'));
  });
});

describe('L2: native text write against fake singleDocumentStore', () => {
  test('plain multiline job lands via createFromString and reports ok', async () => {
    let state = await runExpr(buildBatchCreationExpr([{
      kind: 'simple-text', ref: 't', x: 0, y: 0, hasDocument: true, text: 'x',
    }]));
    const byIndex = state.byIndex();
    const jobs = [{ idx: 0, segments: [{ text: 'Name\nsub' }], plainText: 'Name\nsub' }];
    const st2 = await runExpr(buildBatchTextWriteExpr(byIndex, jobs), state);
    const res = st2.result;
    assert.deepEqual(res, [{ idx: 0, ok: true }]);
    // fake store rendered paragraphs into the doc
    const doc = state.documentsList()[0];
    assert.equal(doc.text, 'Namesub'); // Slate paragraphs carry no \n
  });

  test('colored runs go through createFromJSON and produce mark-up delta', async () => {
    let state = await runExpr(buildBatchCreationExpr([{
      kind: 'simple-text', ref: 't', x: 0, y: 0, hasDocument: true, text: 'x',
    }]));
    const byIndex = state.byIndex();
    const segments = [
      { text: 'Orders ', color: 0xbf4520, marks: { bold: true } },
      { text: 'API', color: 0x202020 },
    ];
    const jobs = [{
      idx: 0,
      segments,
      plainText: 'Orders API',
      slateNodes: segmentsToSlateNodes(segments, randomUUID),
    }];
    const st2 = await runExpr(buildBatchTextWriteExpr(byIndex, jobs), state);
    const res = st2.result;
    assert.deepEqual(res, [{ idx: 0, ok: true }]);
    const doc = state.documentsList()[0];
    assert.equal(doc.rendered, '<bold><color>Orders </color></bold><color>API</color>');
  });
});

describe('L2: read path + style fields', () => {
  test('arrow endpoint with existing objectId attaches to that object', async () => {
    let state = await runExpr(buildBatchCreationExpr([{
      kind: 'shape', ref: 'n', x: 0, y: 0, width: 10, height: 10, shapeType: 'square',
      fillColor: { color: 0xffffff, opacity: 1 }, strokeColor: { color: 0x202020, opacity: 1 },
      strokeWidth: 1, fixedSize: true, hasDocument: true, text: '',
    }]));
    const targetId = state.byIndex()[0].id;
    state = await runExpr(buildBatchArrowsExpr([], [{
      arrowType: 'straight', strokeColor: 0x808080, strokeStyle: 'solid',
      from: { objectId: targetId, relativePoint: { x: 1, y: 0.5 } }, to: { point: { x: 50, y: 50 } },
    }], false), state);
    const arrow = state.objectsList().find((o) => o.fields.type === 'arrow');
    assert.equal(arrow.fields.start.objectId, targetId);
    assert.deepEqual(arrow.fields.start.relativePoint, { x: 1, y: 0.5 });
  });

  test('explicit per-object zIndex wins over computed z', async () => {
    const state = await runExpr(buildBatchCreationExpr([
      { kind: 'shape', ref: 'wash', x: 0, y: 0, width: 10, height: 10, shapeType: 'square', zIndex: -900,
        fillColor: { color: 0xbf4520, opacity: 0.04 }, strokeColor: { color: 0x202020, opacity: 1 },
        strokeWidth: 0, fixedSize: true, hasDocument: true, text: '' },
      { kind: 'shape', ref: 'top', x: 0, y: 0, width: 5, height: 5, shapeType: 'square',
        fillColor: { color: 0xffffff, opacity: 1 }, strokeColor: { color: 0x202020, opacity: 1 },
        strokeWidth: 1, fixedSize: true, hasDocument: true, text: '' },
    ]));
    const z = Object.fromEntries(state.objectsList().map((o) => [o.fields.type + (o.fields.zIndex < 0 ? '-low' : ''), o.fields.zIndex]));
    const wash = state.objectsList().find((o) => o.fields.zIndex === -900);
    assert.ok(wash, 'explicit zIndex -900 respected');
  });

  test('simple-text width writes width + fixedWidth (parity with add_simple_text)', async () => {
    const state = await runExpr(buildBatchCreationExpr([{
      kind: 'simple-text', ref: 't', x: 5, y: 6, width: 260,
      hasDocument: true, text: 'fixed width label',
    }]));
    const f = state.objectsList()[0].fields;
    assert.equal(f.width, 260);
    assert.equal(f.fixedWidth, true);
    // without width: no fixedWidth field (auto-size stays the default)
    const state2 = await runExpr(buildBatchCreationExpr([{
      kind: 'simple-text', ref: 't2', x: 5, y: 6,
      hasDocument: true, text: 'auto width',
    }]));
    const f2 = state2.objectsList()[0].fields;
    assert.equal(f2.width, undefined);
    assert.equal(f2.fixedWidth, undefined);
  });
});

describe('L2: read path + style fields (original)', () => {
  test('boardContent returns objects and documents from deltas', async () => {
    const state = await runExpr(buildBatchCreationExpr([{
      kind: 'simple-text', ref: 't', x: 5, y: 6, hasDocument: true, text: 'seed',
    }]));
    // simulate a rendered doc
    state.setDoc(state.createdDocs[0], '<bold>seeded</bold>');
    const dump = (await runExpr(buildBoardContentExpr(), state)).result;
    assert.ok(dump.objects);
    const ids = Object.keys(dump.objects);
    assert.equal(ids.length, 1);
    assert.equal(dump.documents[state.createdDocs[0]], '<bold>seeded</bold>');
  });

  test('styleFields sets extras + touches updated', async () => {
    let state = await runExpr(buildBatchCreationExpr([{
      kind: 'shape', ref: 's', x: 0, y: 0, width: 1, height: 1, shapeType: 'square',
      fillColor: { color: 0xffffff, opacity: 1 }, strokeColor: { color: 0x202020, opacity: 1 },
      strokeWidth: 1, fixedSize: true, hasDocument: true, text: '',
    }]));
    const id = state.byIndex()[0].id;
    state = await runExpr(buildStyleFieldsExpr(id, { fontSize: 40, verticalAlign: 'top' }), state);
    assert.deepEqual(state.objectsList()[0].fields.fontSize, 40);
    assert.deepEqual(state.objectsList()[0].fields.verticalAlign, 'top');
    assert.ok(state.objectsList()[0].fields.updated);
  });

  test('kindExpr reads the object type', async () => {
    const state = await runExpr(buildBatchCreationExpr([{
      kind: 'shape', ref: 's', x: 0, y: 0, width: 1, height: 1, shapeType: 'square',
      fillColor: { color: 0xffffff, opacity: 1 }, strokeColor: { color: 0x202020, opacity: 1 },
      strokeWidth: 1, fixedSize: true, hasDocument: true, text: '',
    }]));
    const id = state.byIndex()[0].id;
    assert.equal((await runExpr(buildKindExpr(id), state)).result, 'shape');
  });

  test('styleFields heals a stale fontSize field on simple-text (issue #2)', async () => {
    let state = await runExpr(buildBatchCreationExpr([{
      kind: 'simple-text', ref: 't', x: 0, y: 0, hasDocument: true, text: 'x', textScale: 24 / 14,
    }]));
    const id = state.byIndex()[0].id;
    // the pre-fix update_text wrote a shape-style fontSize field onto simple-text
    state = await runExpr(buildStyleFieldsExpr(id, { fontSize: 22 }), state);
    assert.equal(state.objectsList()[0].fields.fontSize, 22);
    // fixed update path: absolute px → textScale + clear of the alien field
    state = await runExpr(buildStyleFieldsExpr(id, { textScale: 22 / 14 }, ['fontSize']), state);
    const f = state.objectsList()[0].fields;
    assert.equal(f.fontSize, undefined);
    assert.equal(f.textScale, 22 / 14);
    assert.deepEqual(state.result.cleared, ['fontSize']);
  });

  test('styleFields with no deleteFields keeps the old contract', async () => {
    let state = await runExpr(buildBatchCreationExpr([{
      kind: 'simple-text', ref: 't', x: 0, y: 0, hasDocument: true, text: 'x',
    }]));
    const id = state.byIndex()[0].id;
    state = await runExpr(buildStyleFieldsExpr(id, { textScale: 1.5 }), state);
    assert.equal(state.objectsList()[0].fields.textScale, 1.5);
    assert.equal(state.result.cleared, undefined);
  });

  test('nativeStyleUpdate styles via objectsService.update and heals stale fields (issue #2)', async () => {
    let state = await runExpr(buildBatchCreationExpr([{
      kind: 'simple-text', ref: 't', x: 0, y: 0, hasDocument: true, text: 'x', textScale: 24 / 14,
    }]));
    const id = state.byIndex()[0].id;
    // pre-fix update_text planted the alien fontSize field
    state = await runExpr(buildStyleFieldsExpr(id, { fontSize: 22 }), state);
    state.svcCalls.length = 0;

    state = await runExpr(buildNativeStyleUpdateExpr(id, { textScale: 22 / 14 }, ['fontSize']), state);
    assert.equal(state.result.native, true);
    assert.equal(state.result.cleared.length, 1);
    assert.equal(state.result.converged, true);
    // the app path carried the style patch…
    assert.deepEqual(state.svcCalls, [{ id, patch: { textScale: 22 / 14 } }]);
    // …and the raw heal removed the alien field
    const f = state.objectsList()[0].fields;
    assert.equal(f.fontSize, undefined);
    assert.equal(f.textScale, 22 / 14);
  });

  test('nativeStyleUpdate without extras only heals (no service call)', async () => {
    let state = await runExpr(buildBatchCreationExpr([{
      kind: 'simple-text', ref: 't', x: 0, y: 0, hasDocument: true, text: 'x',
    }]));
    const id = state.byIndex()[0].id;
    state = await runExpr(buildStyleFieldsExpr(id, { fontSize: 22 }), state);
    state.svcCalls.length = 0;
    state = await runExpr(buildNativeStyleUpdateExpr(id, {}, ['fontSize']), state);
    assert.equal(state.result.native, true);
    assert.equal(state.svcCalls.length, 0);
    assert.equal(state.objectsList()[0].fields.fontSize, undefined);
  });

  test('nativeStyleUpdate reports native:false when the app service is unavailable', async () => {
    const state = await runExpr(buildBatchCreationExpr([{
      kind: 'simple-text', ref: 't', x: 0, y: 0, hasDocument: true, text: 'x',
    }]));
    const id = state.byIndex()[0].id;
    delete state.window.ds.store.objectBuilder.getApp;
    await runExpr(buildNativeStyleUpdateExpr(id, { textScale: 1.5 }), state);
    assert.deepEqual(state.result, { native: false });
  });

  test('nativeStyleUpdate waits for debounced yDoc persistence (app save lag)', async () => {
    const state = await runExpr(buildBatchCreationExpr([{
      kind: 'simple-text', ref: 't', x: 0, y: 0, hasDocument: true, text: 'x',
    }]));
    const id = state.byIndex()[0].id;
    const yobj = state.window.ds.yPersistence.yDoc.getMap('objects').get(id);
    // mimic the real app: svc resolves immediately, the yDoc save lands 300ms later
    state.window.ds.store.objectBuilder.getApp = () => ({ objectsService: {
      update: async (id2, patch) => {
        setTimeout(() => { for (const k of Object.keys(patch)) yobj.set(k, patch[k]); }, 300);
      },
    } });
    const t0 = Date.now();
    await runExpr(buildNativeStyleUpdateExpr(id, { textScale: 1.5 }), state);
    assert.equal(state.result.converged, true);
    assert.ok(Date.now() - t0 >= 290, 'must actually wait for persistence');
    assert.equal(state.objectsList()[0].fields.textScale, 1.5);
  });
});
