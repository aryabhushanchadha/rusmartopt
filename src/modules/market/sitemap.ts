import { Router } from "express";
import * as marketService from "./service.js";
import { absoluteUrl } from "./seo.js";

export const sitemapRouter = Router();

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

sitemapRouter.get("/sitemap.xml", async (_req, res, next) => {
  try {
    const companies = await marketService.getSitemapEntries();
    const urls: { loc: string; lastmod?: string }[] = [
      { loc: absoluteUrl("/postavshiki") },
    ];
    for (const c of companies) {
      urls.push({ loc: absoluteUrl(`/postavshiki/${c.slug}`) });
      for (const l of c.listings) {
        urls.push({ loc: absoluteUrl(`/postavshiki/${c.slug}/${l.slug}`), lastmod: l.updatedAt.toISOString() });
      }
    }
    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      urls.map((u) => `  <url><loc>${xmlEscape(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`).join("\n") +
      `\n</urlset>\n`;
    res.type("application/xml").send(xml);
  } catch (err) { next(err); }
});

sitemapRouter.get("/robots.txt", (_req, res) => {
  const body =
    `User-agent: *\n` +
    `Allow: /\n` +
    `Allow: /postavshiki\n` +
    `Disallow: /api/\n` +
    `Sitemap: ${absoluteUrl("/sitemap.xml")}\n`;
  res.type("text/plain").send(body);
});
