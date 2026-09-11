import { Router } from "express";
import { env } from "../../config/env.js";
import * as marketService from "./service.js";
import {
  metaDescription, absoluteUrl, listingCanonical, companyCanonical,
  buildProductJsonLd, buildOrganizationJsonLd, buildBreadcrumbJsonLd,
} from "./seo.js";

export const marketPublicRouter = Router();

marketPublicRouter.get("/postavshiki", async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
    const { items, totalPages } = await marketService.listPublishedListings(page);
    res.render("market/index", {
      title: "Каталог производителей — RuSmartOpt",
      description: "Реальные товары от поставщиков на RuSmartOpt — мебель, металлообработка, упаковка, текстиль, пластик, электроника и другие отрасли производства.",
      canonical: absoluteUrl(page > 1 ? `/postavshiki?page=${page}` : "/postavshiki"),
      listings: items,
      page,
      totalPages,
    });
  } catch (err) { next(err); }
});

marketPublicRouter.get("/postavshiki/:companySlug", async (req, res, next) => {
  try {
    const company = await marketService.getPublicCompanyProfile(req.params.companySlug);
    if (!company) { res.status(404).render("market/index", { title: "Не найдено — RuSmartOpt", description: "Страница не найдена", canonical: absoluteUrl("/postavshiki"), listings: [], page: 1, totalPages: 1 }); return; }
    res.render("market/company", {
      title: `${company.name} — RuSmartOpt`,
      description: metaDescription(company.description, `${company.name} — производитель на RuSmartOpt.`),
      canonical: companyCanonical(company.slug!),
      company,
      listings: company.listings,
      jsonLd: buildOrganizationJsonLd(company),
    });
  } catch (err) { next(err); }
});

marketPublicRouter.get("/postavshiki/:companySlug/:listingSlug", async (req, res, next) => {
  try {
    const result = await marketService.getPublicListing(req.params.companySlug, req.params.listingSlug);
    if (!result) { res.status(404).render("market/index", { title: "Не найдено — RuSmartOpt", description: "Страница не найдена", canonical: absoluteUrl("/postavshiki"), listings: [], page: 1, totalPages: 1 }); return; }
    const { listing, company } = result;
    res.render("market/listing", {
      title: `${listing.title} — ${company.name} | RuSmartOpt`,
      description: metaDescription(listing.description, `${listing.title} от ${company.name} на RuSmartOpt.`),
      canonical: listingCanonical(company.slug!, listing.slug),
      listing,
      company,
      frontendBaseUrl: env.FRONTEND_BASE_URL,
      jsonLdProduct: buildProductJsonLd(listing, company),
      jsonLdBreadcrumbs: buildBreadcrumbJsonLd(company, listing),
    });
  } catch (err) { next(err); }
});
