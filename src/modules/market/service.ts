import { prisma } from "../../db/prisma.js";

/**
 * Public marketplace queries — every one of these filters on published:true
 * (and, for company pages, "has at least one published listing") so drafts
 * never leak onto a public, unauthenticated, crawlable page or the sitemap.
 */

const PAGE_SIZE = 24;

export async function listPublishedListings(page: number) {
  const skip = Math.max(0, page - 1) * PAGE_SIZE;
  const [items, total] = await Promise.all([
    prisma.listing.findMany({
      where: { published: true, company: { slug: { not: null } } },
      include: { company: true },
      orderBy: { updatedAt: "desc" },
      skip,
      take: PAGE_SIZE,
    }),
    prisma.listing.count({ where: { published: true, company: { slug: { not: null } } } }),
  ]);
  return { items, total, page, pageSize: PAGE_SIZE, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export async function getPublicCompanyProfile(companySlug: string) {
  const company = await prisma.company.findUnique({
    where: { slug: companySlug },
    include: { listings: { where: { published: true }, orderBy: { updatedAt: "desc" } } },
  });
  if (!company || company.listings.length === 0) return null; // avoid thin-content pages
  return company;
}

export async function getPublicListing(companySlug: string, listingSlug: string) {
  const company = await prisma.company.findUnique({ where: { slug: companySlug } });
  if (!company) return null;
  const listing = await prisma.listing.findUnique({
    where: { companyId_slug: { companyId: company.id, slug: listingSlug } },
  });
  if (!listing || !listing.published) return null;
  return { listing, company };
}

export async function getSitemapEntries() {
  const companies = await prisma.company.findMany({
    where: { slug: { not: null }, listings: { some: { published: true } } },
    select: { slug: true, listings: { where: { published: true }, select: { slug: true, updatedAt: true } } },
  });
  return companies;
}
