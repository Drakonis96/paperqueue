// Reading statistics computed entirely client-side, mirroring the app's
// StatsService: papers read per day, streaks, per-week buckets, pages.

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function dayKey(d) {
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Monday-anchored start of the week containing `d`. */
function weekStart(d) {
  const x = startOfDay(d);
  const dow = (x.getDay() + 6) % 7; // 0 = Monday
  x.setDate(x.getDate() - dow);
  return x;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function computeStats(papers, { goal = 1, now = new Date(), weeks = 8 } = {}) {
  const read = papers.filter((p) => p.readStatus === "read");
  const pending = papers.filter((p) => p.isPending);

  const counts = {}; // dayKey → papers read
  const pagesByDay = {};
  let pagesTotal = 0;
  for (const p of read) {
    const date = p.readDate ? new Date(p.readDate) : new Date();
    const k = dayKey(date);
    counts[k] = (counts[k] || 0) + 1;
    const pc = p.pageCount || 0;
    pagesTotal += pc;
    pagesByDay[k] = (pagesByDay[k] || 0) + pc;
  }

  const todayKey = dayKey(now);
  const readToday = counts[todayKey] || 0;
  const pagesToday = pagesByDay[todayKey] || 0;

  const weekStartDate = weekStart(now);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  let readThisWeek = 0,
    readThisMonth = 0,
    pagesThisWeek = 0,
    pagesThisMonth = 0;
  for (const p of read) {
    const date = startOfDay(p.readDate ? new Date(p.readDate) : new Date());
    const pc = p.pageCount || 0;
    if (date >= weekStartDate) {
      readThisWeek++;
      pagesThisWeek += pc;
    }
    if (date >= monthStart) {
      readThisMonth++;
      pagesThisMonth += pc;
    }
  }

  // First tracked day (anchors the calendar's judged range).
  let firstActiveDay = null;
  for (const p of read) {
    const d = startOfDay(p.readDate ? new Date(p.readDate) : new Date());
    if (!firstActiveDay || d < firstActiveDay) firstActiveDay = d;
  }

  // Current streak: consecutive goal-met days ending today or yesterday.
  const met = (d) => (counts[dayKey(d)] || 0) >= goal;
  let currentStreak = 0;
  let cursor = startOfDay(now);
  if (!met(cursor)) cursor = addDays(cursor, -1);
  while (met(cursor)) {
    currentStreak++;
    cursor = addDays(cursor, -1);
  }

  // Longest streak ever.
  const metDays = Object.keys(counts)
    .filter((k) => counts[k] >= goal)
    .sort();
  let longest = 0,
    run = 0,
    prev = null;
  for (const k of metDays) {
    const d = new Date(k + "T00:00:00");
    if (prev && dayKey(addDays(prev, 1)) === k) run++;
    else run = 1;
    longest = Math.max(longest, run);
    prev = d;
  }

  const activeDays = Object.keys(counts).length;
  const bestDay = Object.values(counts).reduce((a, b) => Math.max(a, b), 0);
  const avg = activeDays ? read.length / activeDays : 0;
  const avgPages = activeDays ? pagesTotal / activeDays : 0;

  // Per-week buckets for the last `weeks` weeks.
  const order = [];
  const buckets = {};
  const pageBuckets = {};
  let wc = weekStartDate;
  for (let i = 0; i < weeks; i++) {
    const k = dayKey(wc);
    buckets[k] = 0;
    pageBuckets[k] = 0;
    order.push(k);
    wc = addDays(wc, -7);
  }
  for (const p of read) {
    const k = dayKey(weekStart(p.readDate ? new Date(p.readDate) : new Date()));
    if (buckets[k] != null) {
      buckets[k]++;
      pageBuckets[k] += p.pageCount || 0;
    }
  }
  const perWeek = order
    .sort()
    .map((k) => ({ weekStart: k, papersRead: buckets[k], pagesRead: pageBuckets[k] }));

  return {
    dailyGoal: goal,
    readToday,
    readThisWeek,
    readThisMonth,
    papersReadTotal: read.length,
    pendingCount: pending.length,
    libraryCount: papers.length,
    currentStreakDays: currentStreak,
    longestStreakDays: longest,
    bestDayCount: bestDay,
    activeDaysCount: activeDays,
    averagePerActiveDay: avg,
    pagesReadTotal: pagesTotal,
    pagesToday,
    pagesThisWeek,
    pagesThisMonth,
    averagePagesPerActiveDay: avgPages,
    perWeek,
    countsByDay: counts,
    firstActiveDay,
    goalMetToday: readToday >= goal,
    todayProgress: goal > 0 ? Math.min(readToday / goal, 1) : 1,
  };
}

/** Classifies a calendar day for colouring (mirrors StatsService.status). */
export function dayStatus(date, { countsByDay, goal, firstActiveDay, now = new Date() }) {
  const day = startOfDay(date);
  const today = startOfDay(now);
  if (day > today) return "future";
  const count = countsByDay[dayKey(day)] || 0;
  if (day.getTime() === today.getTime()) {
    if (count >= goal) return "met";
    return count > 0 ? "partial" : "today";
  }
  if (!firstActiveDay || day < startOfDay(firstActiveDay)) return "untracked";
  if (count >= goal) return "met";
  return count > 0 ? "partial" : "missed";
}

export { dayKey, startOfDay };
