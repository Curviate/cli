/**
 * Unit tests for the shared adaptive poll-cadence function used by the
 * mobile-app-approval wait loops (interactive link/reconnect sub-loop and
 * the checkpoint poll wait loop).
 */
import { describe, it, expect } from "vitest";
import {
  CHECKPOINT_POLL_FAST_WINDOW_MS,
  CHECKPOINT_POLL_FAST_INTERVAL_MS,
  CHECKPOINT_POLL_SLOW_INTERVAL_MS,
  nextCheckpointPollDelayMs,
} from "../../src/lib/checkpoint-cadence.js";

describe("nextCheckpointPollDelayMs", () => {
  it("returns the fast interval before the fast window elapses", () => {
    expect(nextCheckpointPollDelayMs(0)).toBe(CHECKPOINT_POLL_FAST_INTERVAL_MS);
    expect(nextCheckpointPollDelayMs(CHECKPOINT_POLL_FAST_WINDOW_MS - 1)).toBe(CHECKPOINT_POLL_FAST_INTERVAL_MS);
  });

  it("returns the slow interval once the fast window has elapsed", () => {
    expect(nextCheckpointPollDelayMs(CHECKPOINT_POLL_FAST_WINDOW_MS)).toBe(CHECKPOINT_POLL_SLOW_INTERVAL_MS);
    expect(nextCheckpointPollDelayMs(CHECKPOINT_POLL_FAST_WINDOW_MS + 60_000)).toBe(CHECKPOINT_POLL_SLOW_INTERVAL_MS);
  });
});
