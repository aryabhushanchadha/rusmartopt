import { prisma } from "../../db/prisma.js";
import { env } from "../../config/env.js";

const DAY_MS = 86400000;
// Russia has used a single fixed UTC+3 offset nationwide (no DST) since 2014
// — safe to hardcode rather than pull in a full IANA timezone library for
// one admin page. Bucketing "today"/the 30-day chart by UTC midnight instead
// (the original implementation) silently misattributed any signup or
// payment between 00:00–03:00 Moscow time to the previous day.
const MOSCOW_OFFSET_MS = 3 * 3600000;

/** The UTC instant corresponding to Moscow-local midnight on the day containing `d`. */
function moscowDayStart(d: Date): Date {
  const shifted = new Date(d.getTime() + MOSCOW_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - MOSCOW_OFFSET_MS);
}

/** Moscow-calendar-date key (YYYY-MM-DD) for bucketing — a row at 01:00 UTC is already the next Moscow day. */
function moscowDayKey(d: Date): string {
  return new Date(d.getTime() + MOSCOW_OFFSET_MS).toISOString().slice(0, 10);
}

/** Buckets a list of {createdAt} rows into per-day counts over the last `days` Moscow-calendar days, oldest first. Zero-fills days with no activity — a real gap in signups should show as a real zero, not a missing bar. */
function bucketByDay<T extends { createdAt: Date }>(rows: T[], days: number, now: Date): { date: string; count: number }[] {
  const buckets = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * DAY_MS);
    buckets.set(moscowDayKey(d), 0);
  }
  for (const row of rows) {
    const key = moscowDayKey(row.createdAt);
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return Array.from(buckets.entries()).map(([date, count]) => ({ date, count }));
}

export async function getDashboardMetrics(now: Date = new Date()) {
  const todayStart = moscowDayStart(now);
  const windowStart = new Date(todayStart.getTime() - 29 * DAY_MS);
  const weekStart = new Date(todayStart.getTime() - 6 * DAY_MS);

  // A single 18-way Promise.all here would burst to 18 simultaneous pooled
  // connections on every dashboard load — comfortably over Prisma's default
  // pool size (num_cpus*2+1) under any concurrent load, which is exactly
  // what caused intermittent 500s under the test suite's own concurrent
  // billing tests. Batching bounds the peak to this module's own batch size
  // while still running each batch in parallel — a $transaction array would
  // bound it to 1, but its type inference doesn't cope with a heterogeneous
  // mix including groupBy() in one array, so plain batched Promise.all wins
  // on both correctness and simplicity here.
  const [totalSuppliers, totalBuyers, recentCompanies, industryGroups, suppliersWithListing, suppliersWithPublishedListing] = await Promise.all([
    prisma.company.count({ where: { type: "supplier" } }),
    prisma.company.count({ where: { type: "buyer" } }),
    prisma.company.findMany({ where: { createdAt: { gte: windowStart } }, select: { createdAt: true, type: true } }),
    prisma.company.groupBy({ by: ["industry"], where: { type: "supplier" }, _count: { _all: true }, orderBy: { industry: "asc" } }),
    prisma.company.count({ where: { type: "supplier", listings: { some: {} } } }),
    prisma.company.count({ where: { type: "supplier", listings: { some: { published: true } } } }),
  ]);

  const [suppliersWithActiveSubscription, subscriptionsByStatus, subscriptionsByPlan, promoClaimed, revenueAgg, paymentsToday] = await Promise.all([
    prisma.company.count({ where: { type: "supplier", subscription: { status: "active" } } }),
    prisma.subscription.groupBy({ by: ["status"], _count: { _all: true }, orderBy: { status: "asc" } }),
    prisma.subscription.groupBy({ by: ["plan"], where: { status: "active" }, _count: { _all: true }, orderBy: { plan: "asc" } }),
    prisma.subscription.count({ where: { plan: "marketplace_full", isPromoPrice: true } }),
    prisma.payment.aggregate({ where: { status: "succeeded" }, _sum: { amountRub: true } }),
    prisma.payment.count({ where: { status: "succeeded", paidAt: { gte: todayStart } } }),
  ]);

  const [totalListings, publishedListings, totalConversations, messagesToday, messagesThisWeek, recentSignups] = await Promise.all([
    prisma.listing.count(),
    prisma.listing.count({ where: { published: true } }),
    prisma.conversation.count(),
    prisma.message.count({ where: { createdAt: { gte: todayStart } } }),
    prisma.message.count({ where: { createdAt: { gte: weekStart } } }),
    prisma.company.findMany({ orderBy: { createdAt: "desc" }, take: 20, select: { id: true, name: true, type: true, industry: true, city: true, createdAt: true } }),
  ]);

  const supplierSignups = recentCompanies.filter((c) => c.type === "supplier");
  const buyerSignups = recentCompanies.filter((c) => c.type === "buyer");
  const dailySuppliers = bucketByDay(supplierSignups, 30, now);
  const dailyBuyers = bucketByDay(buyerSignups, 30, now);
  const dailyTotals = dailySuppliers.map((d, i) => ({ date: d.date, count: d.count + dailyBuyers[i].count }));

  return {
    generatedAt: now,
    companies: {
      totalSuppliers,
      totalBuyers,
      total: totalSuppliers + totalBuyers,
      dailySuppliers,
      dailyBuyers,
      dailyTotals,
      maxDaily: Math.max(1, ...dailyTotals.map((d) => d.count)),
      industries: industryGroups
        .map((g) => ({ industry: g.industry ?? "Не указано", count: g._count._all }))
        .sort((a, b) => b.count - a.count),
    },
    sellerFunnel: {
      totalSuppliers,
      withListing: suppliersWithListing,
      withPublishedListing: suppliersWithPublishedListing,
      withActiveSubscription: suppliersWithActiveSubscription,
    },
    billing: {
      byStatus: Object.fromEntries(subscriptionsByStatus.map((s) => [s.status, s._count._all])),
      byPlan: Object.fromEntries(subscriptionsByPlan.map((s) => [s.plan, s._count._all])),
      promoClaimed,
      promoTotal: env.PROMO_SLOTS,
      revenueRub: revenueAgg._sum.amountRub ?? 0,
      paymentsToday,
    },
    marketplace: {
      totalListings,
      publishedListings,
      totalConversations,
      messagesToday,
      messagesThisWeek,
    },
    recentSignups,
  };
}

export type DashboardMetrics = Awaited<ReturnType<typeof getDashboardMetrics>>;
