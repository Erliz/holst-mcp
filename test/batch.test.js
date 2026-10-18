import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ValidationError, buildBatchPlan } from '../src/batch.js';

const base = { kind: 'shape', ref: 'a', text: 'A', x: 1, y: 2 };

describe('buildBatchPlan: structure', () => {
  test('splits creations and arrows, arrows last', () => {
    const plan = buildBatchPlan([
      { kind: 'arrow', from: { ref: 'b' }, to: { ref: 'a' } },
      base,
      { kind: 'sticker', ref: 'b', text: 'B', x: 3, y: 4 },
    ]);
    assert.equal(plan.creations.length, 2);
    assert.equal(plan.arrows.length, 1);
    assert.deepEqual(plan.creations.map((c) => c.ref), ['a', 'b']);
  });

  test('auto-refs assigned to unnamed objects', () => {
    const plan = buildBatchPlan([
      { kind: 'simple-text', text: 'hi', x: 0, y: 0 },
      { kind: 'sticker', text: 'x', x: 1, y: 1 },
    ]);
    assert.deepEqual(plan.creations.map((c) => c.ref), ['obj1', 'obj2']);
  });

  test('rejects non-array and empty array', () => {
    assert.throws(() => buildBatchPlan('nope'), ValidationError);
    assert.throws(() => buildBatchPlan([]), ValidationError);
  });

  test('rejects unknown kind and non-object entries', () => {
    assert.throws(() => buildBatchPlan([{ kind: 'ufo', ref: 'a', x: 1, y: 1 }]), ValidationError);
    assert.throws(() => buildBatchPlan([null]), ValidationError);
  });

  test('caps batch size at 200', () => {
    const many = Array.from({ length: 201 }, (_, i) => ({ kind: 'sticker', ref: 's' + i, text: 't', x: 0, y: 0 }));
    assert.throws(() => buildBatchPlan(many), /200/);
  });

  test('rejects duplicate refs', () => {
    assert.throws(
      () => buildBatchPlan([base, { ...base, x: 9 }]),
      /duplicate ref/
    );
  });

  test('rejects bad ref charset', () => {
    assert.throws(() => buildBatchPlan([{ ...base, ref: '1bad ref!' }]), ValidationError);
  });
});

describe('buildBatchPlan: per-kind validation (reuses validators)', () => {
  test('shape: coords required, NaN rejected, tokens whitelisted', () => {
    assert.throws(() => buildBatchPlan([{ kind: 'shape', ref: 'a', x: NaN, y: 1 }]), ValidationError);
    assert.throws(() => buildBatchPlan([{ kind: 'shape', ref: 'a', x: 1 }]), ValidationError);
    assert.throws(
      () => buildBatchPlan([{ ...base, fillColor: "white'};evil()" }]),
      ValidationError
    );
  });

  test('sticker and simple-text require text', () => {
    assert.throws(() => buildBatchPlan([{ kind: 'sticker', ref: 'a', x: 1, y: 1 }]), ValidationError);
    assert.throws(() => buildBatchPlan([{ kind: 'simple-text', ref: 'a', x: 1, y: 1 }]), ValidationError);
  });

  test('frame defaults labelText, stamp caps text length', () => {
    const plan = buildBatchPlan([
      { kind: 'frame', ref: 'f', x: 0, y: 0 },
      { kind: 'stamp', ref: 's', text: '🔥', x: 1, y: 1 },
    ]);
    assert.equal(plan.creations[0].labelText, 'Frame');
    assert.throws(
      () => buildBatchPlan([{ kind: 'stamp', ref: 's', text: 'x'.repeat(1001), x: 1, y: 1 }]),
      ValidationError
    );
  });

  test('normalized numeric fields come back sanitized', () => {
    const plan = buildBatchPlan([{ ...base, width: 260, height: 56, strokeWidth: 2 }]);
    const c = plan.creations[0];
    assert.equal(c.width, 260);
    assert.equal(c.height, 56);
    assert.equal(c.strokeWidth, 2);
    assert.equal(c.shapeType, 'square'); // default applied
  });
});

describe('buildBatchPlan: arrows', () => {
  test('ref endpoints resolved against created refs', () => {
    const plan = buildBatchPlan([
      base,
      { kind: 'sticker', ref: 'b', text: 'B', x: 3, y: 4 },
      { kind: 'arrow', from: { ref: 'a', relativePoint: { x: 0.5, y: 1 } }, to: { ref: 'b', relativePoint: { x: 0.5, y: 0 } } },
    ]);
    const a = plan.arrows[0];
    assert.equal(a.from.refIndex, 0);
    assert.equal(a.to.refIndex, 1);
    assert.deepEqual(a.from.relativePoint, { x: 0.5, y: 1 });
  });

  test('free-point endpoints allowed', () => {
    const plan = buildBatchPlan([
      base,
      { kind: 'arrow', from: { x: 10, y: 20 }, to: { ref: 'a' } },
    ]);
    assert.deepEqual(plan.arrows[0].from.point, { x: 10, y: 20 });
  });

  test('unknown ref endpoint rejected', () => {
    assert.throws(
      () => buildBatchPlan([base, { kind: 'arrow', from: { ref: 'ghost' }, to: { ref: 'a' } }]),
      /ghost/
    );
  });

  test('endpoint must be object with ref or x/y', () => {
    assert.throws(() => buildBatchPlan([base, { kind: 'arrow', from: 'x', to: { ref: 'a' } }]), ValidationError);
    assert.throws(() => buildBatchPlan([base, { kind: 'arrow', from: { x: 1 }, to: { ref: 'a' } }]), ValidationError);
  });

  test('arrowType and strokeColor whitelisted', () => {
    assert.throws(
      () => buildBatchPlan([base, { kind: 'arrow', from: { ref: 'a' }, to: { ref: 'a' }, arrowType: 'zigzag!' }]),
      ValidationError
    );
  });

  test('arrow text, textPosition, strokeStyle pass through validated', () => {
    const plan = buildBatchPlan([
      base,
      { kind: 'arrow', from: { ref: 'a' }, to: { x: 10, y: 20 }, text: 'yes', textPosition: 0.25, strokeStyle: 'dotted' },
    ]);
    const a = plan.arrows[0];
    assert.equal(a.text, 'yes');
    assert.equal(a.textPosition, 0.25);
    assert.equal(a.strokeStyle, 'dotted');
  });

  test('arrow defaults: no text, position 0.5, solid', () => {
    const plan = buildBatchPlan([base, { kind: 'arrow', from: { ref: 'a' }, to: { x: 1, y: 2 } }]);
    const a = plan.arrows[0];
    assert.equal(a.text, undefined);
    assert.equal(a.textPosition, 0.5);
    assert.equal(a.strokeStyle, 'solid');
  });

  test('arrow rejects bad text, textPosition and strokeStyle', () => {
    const arrow = (extra) => [base, { kind: 'arrow', from: { ref: 'a' }, to: { x: 1, y: 2 }, ...extra }];
    assert.throws(() => buildBatchPlan(arrow({ strokeStyle: 'wavy' })), ValidationError);
    assert.throws(() => buildBatchPlan(arrow({ textPosition: 2 })), ValidationError);
    assert.throws(() => buildBatchPlan(arrow({ text: 42 })), ValidationError);
  });

  test('arrow: arrowheads, strokeWidth, fontSize, textColor pass through', () => {
    const plan = buildBatchPlan([
      base,
      { kind: 'arrow', from: { ref: 'a' }, to: { x: 1, y: 2 }, arrowheadStart: 'miro', arrowheadEnd: 'none', strokeWidth: 17, fontSize: 24, textColor: '#f20606' },
    ]);
    const a = plan.arrows[0];
    assert.equal(a.arrowheadStart, 'miro');
    assert.equal(a.arrowheadEnd, 'none');
    assert.equal(a.strokeWidth, 17);
    assert.equal(a.fontSize, 24);
    assert.deepEqual(a.textColor, { color: 15861254, opacity: 1 });
  });

  test('shape: fontSize, textColor, bold, italic, horizontalAlign pass through', () => {
    const plan = buildBatchPlan([
      { ...base, fontSize: 36, textColor: 'red10', bold: true, italic: true, horizontalAlign: 'center' },
    ]);
    const c = plan.creations[0];
    assert.equal(c.fontSize, 36);
    assert.deepEqual(c.textColor, { color: 'red10', opacity: 1 });
    assert.equal(c.bold, true);
    assert.equal(c.italic, true);
    assert.equal(c.horizontalAlign, 'center');
  });

  test('simple-text: fontSize converts to textScale (base 14)', () => {
    const plan = buildBatchPlan([
      { kind: 'simple-text', ref: 't', text: 'hi', x: 0, y: 0, fontSize: 28 },
    ]);
    assert.equal(plan.creations[0].textScale, 2);
  });

  test('sticker: raw textScale allowed, fontSize rejected (no verified base)', () => {
    const plan = buildBatchPlan([
      { kind: 'sticker', ref: 's', text: 'x', x: 0, y: 0, textScale: 0.9 },
    ]);
    assert.equal(plan.creations[0].textScale, 0.9);
    assert.throws(
      () => buildBatchPlan([{ kind: 'sticker', ref: 's', text: 'x', x: 0, y: 0, fontSize: 20 }]),
      ValidationError
    );
  });

  test('bad style values rejected', () => {
    assert.throws(() => buildBatchPlan([{ ...base, fontSize: 3 }]), ValidationError);
    assert.throws(() => buildBatchPlan([{ ...base, fontSize: 6000 }]), ValidationError);
    assert.throws(() => buildBatchPlan([{ ...base, horizontalAlign: 'sideways' }]), ValidationError);
    assert.throws(() => buildBatchPlan([{ ...base, textColor: 'not a color!' }]), ValidationError);
    assert.throws(
      () => buildBatchPlan([base, { kind: 'arrow', from: { ref: 'a' }, to: { x: 1, y: 2 }, arrowheadEnd: 'pike' }]),
      ValidationError
    );
  });

  test('markdown in text rejected with helpful error', () => {
    assert.throws(() => buildBatchPlan([{ ...base, text: '**важно**' }]), /bold/);
    assert.throws(
      () => buildBatchPlan([base, { kind: 'arrow', from: { ref: 'a' }, to: { x: 1, y: 2 }, text: '*курсив*' }]),
      /italic/
    );
  });

  test('hex fillColor/strokeColor accepted for shapes and arrows (v0.4)', () => {
    const plan = buildBatchPlan([
      { ...base, fillColor: '#bf4520', strokeColor: '#2e5aa8' },
      { kind: 'arrow', from: { ref: 'a' }, to: { x: 1, y: 2 }, strokeColor: '#2e5aa8' },
    ]);
    assert.deepEqual(plan.creations[0].fillColor, { color: 0xbf4520, opacity: 1 });
    assert.deepEqual(plan.creations[0].strokeColor, { color: 0x2e5aa8, opacity: 1 });
    assert.equal(plan.arrows[0].strokeColor, 0x2e5aa8);
  });

  test('palette tokens still pass through batch colors', () => {
    const plan = buildBatchPlan([{ ...base, fillColor: 'tomato8', strokeColor: 'gray12' }]);
    assert.deepEqual(plan.creations[0].fillColor, { color: 'tomato8', opacity: 1 });
    assert.deepEqual(plan.creations[0].strokeColor, { color: 'gray12', opacity: 1 });
  });

  test('batch textOpacity requires textColor', () => {
    assert.throws(() => buildBatchPlan([{ ...base, textOpacity: 0.06 }]), ValidationError);
    const plan = buildBatchPlan([{ ...base, textColor: '#bf4520', textOpacity: 0.06 }]);
    assert.deepEqual(plan.creations[0].textColor, { color: 0xbf4520, opacity: 0.06 });
  });

  test('batch verticalAlign and letterSpacing pass through', () => {
    const plan = buildBatchPlan([
      { kind: 'simple-text', ref: 't', text: 'hi', x: 0, y: 0, verticalAlign: 'top', letterSpacing: 2 },
    ]);
    assert.equal(plan.creations[0].verticalAlign, 'top');
    assert.equal(plan.creations[0].letterSpacing, 2);
  });

  test('batch fillOpacity/strokeOpacity ride inside color objects (v0.4)', () => {
    const plan = buildBatchPlan([
      { ...base, fillColor: '#2d3142', fillOpacity: 0.02, strokeColor: '#bf4520', strokeOpacity: 0.5 },
    ]);
    const c = plan.creations[0];
    assert.deepEqual(c.fillColor, { color: 0x2d3142, opacity: 0.02 });
    assert.deepEqual(c.strokeColor, { color: 0xbf4520, opacity: 0.5 });
  });

  test('batch opacity out of range rejected', () => {
    assert.throws(() => buildBatchPlan([{ ...base, fillOpacity: 1.5 }]), ValidationError);
  });

  test('unknown shapeType rejected with valid list (rhombus does not exist)', () => {
    assert.throws(() => buildBatchPlan([{ ...base, shapeType: 'rhombus' }]), /diamond/);
    const ok = buildBatchPlan([{ ...base, shapeType: 'diamond' }]);
    assert.equal(ok.creations[0].shapeType, 'diamond');
  });

  test('frame fillColor accepts hex (parity with shapes)', () => {
    const plan = buildBatchPlan([{ kind: 'frame', ref: 'f', x: 0, y: 0, fillColor: '#bf4520' }]);
    assert.deepEqual(plan.creations[0].fillColor, { color: 0xbf4520, opacity: 1 });
  });

  test('unknown arrowType rejected', () => {
    assert.throws(() => buildBatchPlan([base, { kind: 'arrow', from: { ref: 'a' }, to: { x: 1, y: 2 }, arrowType: 'wavy' }]), /straight, elbow, curved/);
  });

  test('arrow endpoint may target an existing objectId (not just ref/x,y)', () => {
    const plan = buildBatchPlan([
      base,
      { kind: 'arrow', from: { objectId: 'existing-id-123', relativePoint: { x: 0.5, y: 1 } }, to: { x: 1, y: 2 } },
    ]);
    assert.deepEqual(plan.arrows[0].from, { objectId: 'existing-id-123', relativePoint: { x: 0.5, y: 1 } });
  });

  test('bad arrow objectId rejected', () => {
    assert.throws(() => buildBatchPlan([
      base,
      { kind: 'arrow', from: { objectId: "bad'; id" }, to: { x: 1, y: 2 } },
    ]), ValidationError);
  });

  test('arrow entries keep explicit ref and get auto-refs otherwise', () => {
    const plan = buildBatchPlan([
      base,
      { kind: 'arrow', ref: 'link-a', from: { ref: 'a' }, to: { x: 1, y: 2 } },
      { kind: 'arrow', from: { ref: 'a' }, to: { x: 3, y: 4 } },
    ]);
    assert.equal(plan.arrows[0].ref, 'link-a');
    assert.ok(/^arrow\d+$/.test(plan.arrows[1].ref), 'auto-ref: ' + plan.arrows[1].ref);
    assert.notEqual(plan.arrows[0].ref, plan.arrows[1].ref);
  });

  test('arrow ref must not collide with creation refs', () => {
    assert.throws(() => buildBatchPlan([
      base,
      { kind: 'arrow', ref: 'a', from: { ref: 'a' }, to: { x: 1, y: 2 } },
    ]), /duplicate ref/);
  });

  test('per-object zIndex passes through (shapes and arrows)', () => {
    const plan = buildBatchPlan([
      { ...base, zIndex: -500 },
      { kind: 'arrow', ref: 'z', from: { ref: 'a' }, to: { x: 1, y: 2 }, zIndex: 9999 },
    ]);
    assert.equal(plan.creations[0].zIndex, -500);
    assert.equal(plan.arrows[0].zIndex, 9999);
  });

  test('non-finite zIndex rejected', () => {
    assert.throws(() => buildBatchPlan([{ ...base, zIndex: Infinity }]), ValidationError);
  });

  test('simple-text width passes through (parity with add_simple_text)', () => {
    const plan = buildBatchPlan([
      { kind: 'simple-text', ref: 't', text: 'centered label', x: 0, y: 0, width: 260 },
    ]);
    assert.equal(plan.creations[0].width, 260);
  });
});
