// Task 44 (functional_domain.md Step 0, guardrails #149/#150): the document
// slot. Pure domain, zero imports. Owns two session facts and nothing else:
//   - occupancy: is a document (ok or error) currently shown?
//   - the render epoch: a monotonic counter that an acting close advances, so
//     any render that started before that close can never be delivered.
// A boolean plus a counter is the honest shape (GoF State considered and
// rejected in initial_scaffold.md Task 44).

export interface DeliveryDecision {
  deliver: boolean;
  occupancyChanged: boolean;
}

export interface CloseResult {
  acted: boolean;
}

export interface DocumentSlot {
  beginRender(): number;
  tryDeliver(token: number): DeliveryDecision;
  close(): CloseResult;
  isOccupied(): boolean;
}

export function createDocumentSlot(): DocumentSlot {
  let epoch = 0;
  let occupied = false;

  return {
    beginRender(): number {
      return epoch;
    },

    tryDeliver(token: number): DeliveryDecision {
      if (token !== epoch) return { deliver: false, occupancyChanged: false };
      const occupancyChanged = !occupied;
      occupied = true;
      return { deliver: true, occupancyChanged };
    },

    // Close while empty changes nothing, epoch included (#150): it must never
    // cancel a first open that is still in flight.
    close(): CloseResult {
      if (!occupied) return { acted: false };
      occupied = false;
      epoch += 1;
      return { acted: true };
    },

    isOccupied(): boolean {
      return occupied;
    },
  };
}
