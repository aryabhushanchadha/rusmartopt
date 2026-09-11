import { prisma } from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { HttpError } from "../../middleware/errorHandler.js";
import { uniqueSlug } from "../../utils/slug.js";
import { ensureSlug, getOwnCompany } from "../companies/service.js";
import { hasActiveMarketplaceSubscription } from "../billing/service.js";
import type { SessionData } from "../auth/session.js";

/**
 * All access here is scoped by companyId from the session, never a
 * client-supplied value — mirrors modules/orders/service.ts exactly. Fetching
 * a listing that exists but belongs to another company returns 404 (not
 * 403), so the endpoint never confirms whether a given id exists for a
 * seller who can't access it.
 */

function requireSupplier(user: SessionData): string {
  if (user.role !== "supplier" || !user.companyId) {
    throw new HttpError(403, "Только поставщик может управлять товарами");
  }
  return user.companyId;
}

export async function listOwnListings(user: SessionData) {
  const companyId = requireSupplier(user);
  return prisma.listing.findMany({ where: { companyId }, orderBy: { updatedAt: "desc" } });
}

export async function getOwnListing(user: SessionData, id: string) {
  const companyId = requireSupplier(user);
  const listing = await prisma.listing.findFirst({ where: { id, companyId } });
  if (!listing) throw new HttpError(404, "Товар не найден");
  return listing;
}

export async function createListing(user: SessionData, input: {
  title: string; description?: string; category?: string; price?: number;
  unit?: string; minOrderQty?: number; imageUrl?: string;
}) {
  const companyId = requireSupplier(user);
  const slug = await uniqueSlug(input.title, async (candidate) => {
    const existing = await prisma.listing.findUnique({ where: { companyId_slug: { companyId, slug: candidate } } });
    return Boolean(existing);
  });
  return prisma.listing.create({ data: { ...input, companyId, slug } });
}

export async function updateListing(user: SessionData, id: string, input: Partial<{
  title: string; description?: string; category?: string; price?: number;
  unit?: string; minOrderQty?: number; imageUrl?: string;
}>) {
  await getOwnListing(user, id); // 404s if not accessible to this tenant
  // Slug intentionally does NOT follow title edits — see schema.prisma /
  // companies/service.ts comment on Company.slug: once a listing is
  // published its URL should stay stable rather than silently 404ing.
  return prisma.listing.update({ where: { id }, data: input });
}

export async function deleteListing(user: SessionData, id: string) {
  await getOwnListing(user, id);
  // Conversation.listingId is a restrict-on-delete FK (message history has
  // value even after a listing is gone) — steer toward unpublish instead of
  // a raw DB constraint error reaching the user as an unhandled 500.
  const conversationCount = await prisma.conversation.count({ where: { listingId: id } });
  if (conversationCount > 0) {
    throw new HttpError(409, "Нельзя удалить товар с историей переписки — сначала снимите его с публикации");
  }
  await prisma.listing.delete({ where: { id } });
}

export async function setPublished(user: SessionData, id: string, published: boolean) {
  const listing = await getOwnListing(user, id);
  if (published) {
    // Publishing is also the first point a seller's public company profile
    // needs a slug, if they haven't set one via /api/companies/me yet.
    const company = await getOwnCompany(listing.companyId);
    await ensureSlug(listing.companyId, company.name);

    // Paywall gate — see plan §5. Off by default (PAYWALL_ENFORCEMENT_ENABLED),
    // and the ONLY call site of this check anywhere in the codebase. Create/
    // edit/unpublish/delete are never gated, regardless of the flag.
    if (env.PAYWALL_ENFORCEMENT_ENABLED) {
      const active = await hasActiveMarketplaceSubscription(listing.companyId);
      if (!active) {
        throw new HttpError(402, "Требуется активная подписка «Маркетплейс + ПО» для публикации товаров");
      }
    }
  }
  return prisma.listing.update({ where: { id }, data: { published } });
}
