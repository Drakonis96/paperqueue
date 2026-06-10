import type { DB } from "../db/client.js";
import { sessionsRepo } from "../repositories/sessions.repo.js";
import { papersRepo } from "../repositories/papers.repo.js";

export type WeekBucket = { weekStart: string; papersRead: number };

export type Stats = {
  papersReadTotal: number;
  pendingCount: number;
  totalReadingSeconds: number;
  sessionsCount: number;
  currentStreakDays: number;
  perWeek: WeekBucket[];
};

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

/** Monday-based week start (UTC), as a YYYY-MM-DD string. */
function weekStartKey(d: Date): string {
  const date = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const day = (date.getUTCDay() + 6) % 7; // 0 = Monday
  date.setUTCDate(date.getUTCDate() - day);
  return dayKey(date);
}

export async function computeStats(
  db: DB,
  now: Date,
  weeks = 8,
): Promise<Stats> {
  const sessions = await sessionsRepo.all(db);
  const allPapers = await papersRepo.all(db);

  const read = allPapers.filter((p) => p.readStatus === "read");
  const pending = allPapers.filter((p) => p.readStatus === "unread");

  const totalReadingSeconds = sessions.reduce(
    (sum, s) => sum + (s.durationSeconds ?? 0),
    0,
  );

  // Active days = a reading session started OR a paper was marked read.
  const activeDays = new Set<string>();
  for (const s of sessions) activeDays.add(dayKey(s.startedAt));
  for (const p of read) activeDays.add(dayKey(p.updatedAt));

  // Streak: consecutive days with activity, ending today (or yesterday).
  let streak = 0;
  const cursor = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  if (!activeDays.has(dayKey(cursor))) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  while (activeDays.has(dayKey(cursor))) {
    streak++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  // Per-week papers-read counts for the last `weeks` weeks.
  const buckets = new Map<string, number>();
  const weekCursor = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  for (let i = 0; i < weeks; i++) {
    buckets.set(weekStartKey(weekCursor), 0);
    weekCursor.setUTCDate(weekCursor.getUTCDate() - 7);
  }
  for (const p of read) {
    const key = weekStartKey(p.updatedAt);
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  const perWeek: WeekBucket[] = [...buckets.entries()]
    .map(([weekStart, papersRead]) => ({ weekStart, papersRead }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  return {
    papersReadTotal: read.length,
    pendingCount: pending.length,
    totalReadingSeconds,
    sessionsCount: sessions.length,
    currentStreakDays: streak,
    perWeek,
  };
}
