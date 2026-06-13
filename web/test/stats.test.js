// Unit tests for the pure stats module — focused on the weekly "comeback"
// metric (extra reading on strong days making up for earlier slow days) and the
// new "exceeded" calendar-day status.
import { test } from "node:test";
import assert from "node:assert/strict";

import { computeStats, dayStatus, dayKey } from "../public/js/stats.js";

// June 10 2026 is a Wednesday; its Monday-anchored week starts June 8.
const NOW = new Date(2026, 5, 10, 12, 0, 0);
const MONDAY = new Date(2026, 5, 8, 9, 0, 0);
const TUESDAY = new Date(2026, 5, 9, 9, 0, 0);
const WEDNESDAY = new Date(2026, 5, 10, 9, 0, 0);

/** Builds `n` read papers dated on `day`. */
function reads(day, n) {
  return Array.from({ length: n }, (_, i) => ({
    key: `${dayKey(day)}-${i}`,
    readStatus: "read",
    readDate: new Date(day),
    isPending: false,
    pageCount: 0,
  }));
}

test("comeback: surplus offsets an earlier missed day (still behind for the week)", () => {
  // goal 2/day. Mon: 0 (missed), Tue: 4 (surplus 2), Wed/today: 1.
  const papers = [...reads(MONDAY, 0), ...reads(TUESDAY, 4), ...reads(WEDNESDAY, 1)];
  const { comeback } = computeStats(papers, { goal: 2, now: NOW });

  assert.equal(comeback.active, true);
  assert.equal(comeback.missedDays, 1); // only Monday (today isn't "missed" yet)
  assert.equal(comeback.weekDeficit, 3); // 2 (Mon) + 1 (Wed)
  assert.equal(comeback.weekSurplus, 2); // 2 (Tue)
  assert.equal(comeback.recovered, 2); // min(surplus, deficit)
  assert.equal(comeback.weekReadElapsed, 5);
  assert.equal(comeback.weekGoalElapsed, 6); // goal 2 × 3 days
  assert.equal(comeback.behind, 1);
  assert.equal(comeback.onTrack, false);
});

test("comeback: a big day puts the whole week back on track", () => {
  // Mon: 0, Tue: 5 (surplus 3), Wed/today: 2.
  const papers = [...reads(MONDAY, 0), ...reads(TUESDAY, 5), ...reads(WEDNESDAY, 2)];
  const { comeback } = computeStats(papers, { goal: 2, now: NOW });

  assert.equal(comeback.active, true);
  assert.equal(comeback.onTrack, true); // 7 read ≥ 6 target
  assert.equal(comeback.behind, 0);
  assert.equal(comeback.missedDays, 1);
  assert.equal(comeback.recovered, 2);
});

test("comeback: no deficit means no comeback to surface", () => {
  // Every day at goal — nothing to recover.
  const papers = [...reads(MONDAY, 2), ...reads(TUESDAY, 2), ...reads(WEDNESDAY, 2)];
  const { comeback } = computeStats(papers, { goal: 2, now: NOW });
  assert.equal(comeback.active, false);
  assert.equal(comeback.weekDeficit, 0);
});

test("dayStatus distinguishes exceeded from met", () => {
  const countsByDay = {
    [dayKey(MONDAY)]: 3, // over goal
    [dayKey(TUESDAY)]: 2, // exactly goal
    [dayKey(WEDNESDAY)]: 1, // partial (today)
  };
  const opts = { countsByDay, goal: 2, firstActiveDay: MONDAY, now: NOW };
  assert.equal(dayStatus(MONDAY, opts), "exceeded");
  assert.equal(dayStatus(TUESDAY, opts), "met");
  assert.equal(dayStatus(WEDNESDAY, opts), "partial");
});
