import { Router } from "express";
import * as marketService from "./service.js";

/**
 * JSON counterpart to publicRoutes.ts's server-rendered EJS pages — built for
 * the mobile app (which has no concept of a "public webpage" to browse), not
 * a replacement for the SEO-critical HTML routes. Reuses the exact same
 * service-layer queries as the HTML routes so the two surfaces can never
 * silently diverge (e.g. one leaking a draft listing the other correctly
 * hides). Read-only and unauthenticated, matching /api/track's pattern —
 * mounted without requireCsrfHeader in app.ts.
 */
export const marketApiRouter = Router();

marketApiRouter.get("/", async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
    const { items, total, pageSize, totalPages } = await marketService.listPublishedListings(page);
    res.json({
      items: items.map((listing) => ({
        id: listing.id,
        slug: listing.slug,
        title: listing.title,
        description: listing.description,
        category: listing.category,
        price: listing.price,
        unit: listing.unit,
        minOrderQty: listing.minOrderQty,
        imageUrl: listing.imageUrl,
        updatedAt: listing.updatedAt,
        company: { name: listing.company.name, slug: listing.company.slug, city: listing.company.city },
      })),
      total,
      page,
      pageSize,
      totalPages,
    });
  } catch (err) { next(err); }
});

marketApiRouter.get("/companies/:companySlug", async (req, res, next) => {
  try {
    const company = await marketService.getPublicCompanyProfile(req.params.companySlug);
    // Same "not found" response for a nonexistent slug and a slug with zero
    // published listings (thin-content rule) — mirrors publicRoutes.ts
    // exactly, so a caller can never distinguish "no such company" from
    // "company exists but has nothing published yet."
    if (!company) { res.status(404).json({ error: "Не найдено" }); return; }
    res.json({
      name: company.name,
      slug: company.slug,
      city: company.city,
      industry: company.industry,
      description: company.description,
      logoUrl: company.logoUrl,
      website: company.website,
      listings: company.listings.map((l) => ({
        id: l.id, slug: l.slug, title: l.title, price: l.price, unit: l.unit, imageUrl: l.imageUrl,
      })),
    });
  } catch (err) { next(err); }
});

marketApiRouter.get("/companies/:companySlug/listings/:listingSlug", async (req, res, next) => {
  try {
    const result = await marketService.getPublicListing(req.params.companySlug, req.params.listingSlug);
    if (!result) { res.status(404).json({ error: "Не найдено" }); return; }
    const { listing, company } = result;
    res.json({
      listing: {
        id: listing.id,
        slug: listing.slug,
        title: listing.title,
        description: listing.description,
        category: listing.category,
        price: listing.price,
        unit: listing.unit,
        minOrderQty: listing.minOrderQty,
        imageUrl: listing.imageUrl,
        updatedAt: listing.updatedAt,
      },
      company: {
        name: company.name,
        slug: company.slug,
        city: company.city,
        website: company.website,
      },
    });
  } catch (err) { next(err); }
});
