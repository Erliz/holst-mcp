import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runExpr } from './helpers/fake-holst.js';
import {
  buildBatchCreationExpr,
  buildBatchArrowsExpr,
  buildBatchTextWriteExpr,
  buildBoardContentExpr,
  buildStyleFieldsExpr,
  buildKindExpr,
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
});
