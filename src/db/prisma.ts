import { PrismaClient, Prisma } from "@prisma/client";

export const prisma = new PrismaClient();

/**
 * Runs `fn` inside a transaction with Postgres session variable app.company_id
 * set for the duration of the transaction, so Row-Level Security policies on
 * orders / order_stage_log can enforce tenant isolation at the database layer
 * even if an application-layer filter is ever missed or buggy.
 *
 * Uses set_config(), not `SET LOCAL '${companyId}'` string interpolation —
 * Postgres' SET command doesn't accept bind parameters at all, but set_config()
 * is a regular function call that does, via Prisma's $executeRaw tagged
 * template (real parameter binding, unlike $executeRawUnsafe). Flagged in
 * review as a SQL-injection shape waiting to be copy-pasted verbatim once
 * wired in — fixed now, before anything calls it, rather than after.
 *
 * Currently unused: no RLS policies exist yet (see README "Known follow-up
 * work"). Wire this in once they do.
 */
export async function withCompanyScope<T>(
  companyId: string,
  fn: (tx: Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SELECT set_config('app.company_id', ${companyId}, true)`);
    return fn(tx);
  });
}
