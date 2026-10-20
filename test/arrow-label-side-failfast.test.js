import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Issue #61: labelSide ≠ 'on' without label text must FAIL FAST at the
// validation layer, before any board work. These tests call addArrow end to
// end down to its validation block. Safety guard for the RED state (gate
// missing): dead debug port + auto-start off make the CDP fallback fail with
// a plain Error, so the call can never reach the real app or launch it.
process.env.HOLST_DEBUG_PORT = '1';
process.env.HOLST_AUTO_START = '0';

const { addArrow } = await import('../src/holst.js');
const { ValidationError } = await import('../src/validate.js');

const BOARD = '00000000-0000-4000-8000-000000000000';
const GEO = { start: { x: 0, y: 0 }, end: { x: 0, y: 100 } };

describe('addArrow: labelSide without text fails fast (#61)', () => {
  test("labelSide 'left' without text → ValidationError, no board work", async () => {
    await assert.rejects(
      () => addArrow(BOARD, { ...GEO, labelSide: 'left' }),
      (e) => e instanceof ValidationError && /labelSide "left" requires label text/.test(e.message)
    );
  });

  test("labelSide 'right' with text: '' → same ValidationError (empty counts as missing)", async () => {
    await assert.rejects(
      () => addArrow(BOARD, { ...GEO, text: '', labelSide: 'right' }),
      (e) => e instanceof ValidationError && /labelSide "right" requires label text/.test(e.message)
    );
  });

  test("control: labelSide 'on' without text passes the gate (proceeds to CDP, non-ValidationError)", async () => {
    // 'on' is the documented no-op default: it must NOT be blocked. Past the
    // gate the call reaches connection setup and fails with the env-guarded
    // CDP error — proving the rejection above comes from the gate, not from
    // the connection setup shared by every invalid-input test.
    await assert.rejects(
      () => addArrow(BOARD, { ...GEO, labelSide: 'on' }),
      (e) => !(e instanceof ValidationError)
    );
  });
});
