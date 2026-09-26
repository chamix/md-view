import { describe, it, expect } from 'vitest';
import { createDocumentSlot } from '../../src/main/documentSlot';

// Task 44 (functional_domain.md Step 0 "Pure transformation logic"): the
// document slot is a pure epoch + occupancy pair. These tests pin the Step 0
// semantics exactly, including "close while empty changes nothing, epoch
// included" (#150).
describe('createDocumentSlot (Task 44 pure domain)', () => {
  it('starts empty', () => {
    const slot = createDocumentSlot();
    expect(slot.isOccupied()).toBe(false);
  });

  it('delivers a current token and reports the empty -> occupied change exactly once', () => {
    const slot = createDocumentSlot();

    const first = slot.tryDeliver(slot.beginRender());
    expect(first).toEqual({ deliver: true, occupancyChanged: true });
    expect(slot.isOccupied()).toBe(true);

    const second = slot.tryDeliver(slot.beginRender());
    expect(second).toEqual({ deliver: true, occupancyChanged: false });
    expect(slot.isOccupied()).toBe(true);
  });

  it('close while occupied acts, empties the slot', () => {
    const slot = createDocumentSlot();
    slot.tryDeliver(slot.beginRender());

    expect(slot.close()).toEqual({ acted: true });
    expect(slot.isOccupied()).toBe(false);
  });

  it('a token taken before an acting close is not delivered and the slot stays empty (#149)', () => {
    const slot = createDocumentSlot();
    slot.tryDeliver(slot.beginRender());
    const stale = slot.beginRender();

    slot.close();

    expect(slot.tryDeliver(stale)).toEqual({ deliver: false, occupancyChanged: false });
    expect(slot.isOccupied()).toBe(false);
  });

  it('a token taken after close is delivered and re-occupies the slot', () => {
    const slot = createDocumentSlot();
    slot.tryDeliver(slot.beginRender());
    slot.close();

    const fresh = slot.beginRender();
    expect(slot.tryDeliver(fresh)).toEqual({ deliver: true, occupancyChanged: true });
    expect(slot.isOccupied()).toBe(true);
  });

  it('close while empty does not act and does not advance the epoch: a pre-close token still delivers (#150)', () => {
    const slot = createDocumentSlot();
    const inFlightFirstOpen = slot.beginRender();

    expect(slot.close()).toEqual({ acted: false });
    expect(slot.isOccupied()).toBe(false);

    expect(slot.tryDeliver(inFlightFirstOpen)).toEqual({ deliver: true, occupancyChanged: true });
  });

  it('repeated close is inert after the first acting close', () => {
    const slot = createDocumentSlot();
    slot.tryDeliver(slot.beginRender());
    slot.close();
    const afterFirstClose = slot.beginRender();

    expect(slot.close()).toEqual({ acted: false });
    // The epoch did not advance on the inert close.
    expect(slot.tryDeliver(afterFirstClose).deliver).toBe(true);
  });
});
