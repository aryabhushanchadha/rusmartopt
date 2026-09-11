import { env } from "../../config/env.js";
import type { Company, Listing } from "@prisma/client";

/** Truncates to ~155 chars on a word boundary for <meta name="description">. */
export function metaDescription(text: string | null | undefined, fallback: string): string {
  const source = (text || fallback).trim();
  if (source.length <= 155) return source;
  return source.slice(0, 155).replace(/\s+\S*$/, "") + "…";
}

export function absoluteUrl(path: string): string {
  return new URL(path, env.PUBLIC_BASE_URL).toString();
}

export function listingCanonical(companySlug: string, listingSlug: string): string {
  return absoluteUrl(`/postavshiki/${companySlug}/${listingSlug}`);
}

export function companyCanonical(companySlug: string): string {
  return absoluteUrl(`/postavshiki/${companySlug}`);
}

export function buildProductJsonLd(listing: Listing, company: Company) {
  const canonical = listingCanonical(company.slug!, listing.slug);
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: listing.title,
    description: listing.description || undefined,
    image: listing.imageUrl || undefined,
    sku: listing.id,
    category: listing.category || undefined,
    // Never fabricate a price — omit `offers` entirely when price is null,
    // rather than shipping a 0 or placeholder value into structured data.
    offers:
      listing.price != null
        ? {
            "@type": "Offer",
            priceCurrency: "RUB",
            price: listing.price,
            url: canonical,
            availability: "https://schema.org/InStock",
            seller: { "@type": "Organization", name: company.name },
          }
        : undefined,
  };
}

export function buildOrganizationJsonLd(company: Company) {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: company.name,
    url: companyCanonical(company.slug!),
    logo: company.logoUrl || undefined,
    description: company.description || undefined,
    address: company.city
      ? { "@type": "PostalAddress", addressLocality: company.city, addressCountry: "RU" }
      : undefined,
  };
}

export function buildBreadcrumbJsonLd(company: Company, listing: Listing) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Каталог", item: absoluteUrl("/postavshiki") },
      { "@type": "ListItem", position: 2, name: company.name, item: companyCanonical(company.slug!) },
      { "@type": "ListItem", position: 3, name: listing.title, item: listingCanonical(company.slug!, listing.slug) },
    ],
  };
}
