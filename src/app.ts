import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "node:path";
import { env } from "./config/env.js";
import { authRouter } from "./modules/auth/routes.js";
import { ordersRouter } from "./modules/orders/routes.js";
import { trackingRouter } from "./modules/tracking/routes.js";
import { companiesRouter } from "./modules/companies/routes.js";
import { listingsRouter } from "./modules/listings/routes.js";
import { marketPublicRouter } from "./modules/market/publicRoutes.js";
import { marketApiRouter } from "./modules/market/publicApiRoutes.js";
import { sitemapRouter } from "./modules/market/sitemap.js";
import { billingRouter } from "./modules/billing/routes.js";
import { billingWebhookRouter } from "./modules/billing/webhookRoutes.js";
import { messagingRouter } from "./modules/messaging/routes.js";
import { adminRouter } from "./modules/admin/routes.js";
import { requireCsrfHeader } from "./middleware/auth.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";

export function buildApp() {
  const app = express();

  // Views live at src/views regardless of whether this process is running
  // via tsx (dev) or the compiled dist/index.js (prod) — EJS templates
  // aren't TypeScript, so tsc never copies them into dist/. The Dockerfile
  // copies src/views alongside dist/ for the same reason.
  app.set("views", path.join(process.cwd(), "src/views"));
  app.set("view engine", "ejs");

  app.use(express.json({ limit: "1mb" }));
  // Only needed for the admin login page's plain HTML <form> POST — every
  // other write in this app goes through the SPA's fetch()-based JSON API.
  app.use(express.urlencoded({ extended: true, limit: "100kb" }));
  app.use(cookieParser());
  app.use(
    cors({
      origin: env.corsOrigins.length ? env.corsOrigins : false,
      credentials: true,
    })
  );

  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  // Public, server-rendered marketplace surface — real HTML per page for
  // search-engine indexing (Yandex in particular), not client-templated.
  app.use(sitemapRouter);
  app.use(marketPublicRouter);

  // Server-rendered admin dashboard — its own cookie-session gate
  // (requireAdminPage in admin/routes.ts), separate from requireAuth/
  // requireRole, since a browsed HTML page should redirect/render an error
  // page rather than return raw JSON. No admin registration path exists
  // anywhere (registerSchema only allows supplier/buyer); admin accounts are
  // created directly in the DB.
  app.use(adminRouter);

  // CSRF header check applies to authenticated, state-changing routes only —
  // the public tracking/auth-login endpoints are protected by rate limiting
  // and generic error responses instead, since they're meant to be reachable
  // without an existing session.
  app.use("/api/orders", requireCsrfHeader, ordersRouter);
  app.use("/api/auth", requireCsrfHeader, authRouter);
  app.use("/api/track", trackingRouter);
  // JSON counterpart to the EJS marketplace pages above, for the mobile app
  // (no public-webpage concept there) — same read-only/unauthenticated
  // pattern as /api/track, so no requireCsrfHeader.
  app.use("/api/market", marketApiRouter);
  app.use("/api/companies", requireCsrfHeader, companiesRouter);
  app.use("/api/listings", requireCsrfHeader, listingsRouter);
  app.use("/api/conversations", requireCsrfHeader, messagingRouter);
  // Webhook is server-to-server (no session, no CSRF token to check) — must
  // be mounted WITHOUT requireCsrfHeader, unlike every other billing route.
  app.use("/api/billing", billingWebhookRouter);
  app.use("/api/billing", requireCsrfHeader, billingRouter);

  // The authenticated SPA (frontend/index.html + api.js) — previously run as
  // a separate static-file process on its own port (`npx serve -l 5173`),
  // which meant a real deployment needed two origins, extra CORS
  // configuration, and cross-origin cookie handling for no real benefit.
  // Served by this same process now: one origin, one TLS cert, and the
  // session cookie's existing `sameSite: "lax"` just works without any
  // cross-site cookie complications. Mounted last, after every real route —
  // express.static falls through to notFoundHandler below for anything that
  // isn't a literal file under frontend/, so it can never shadow /api,
  // /postavshiki, /admin, /sitemap.xml, or /robots.txt above. Requesting the
  // bare "/" serves frontend/index.html (express.static's own default),
  // which is the public landing page for a logged-out visitor and the app
  // shell once authenticated — this SPA doesn't use client-side routing
  // (no History API paths), so no catch-all rewrite to index.html is needed
  // beyond that default.
  app.use(express.static(path.join(process.cwd(), "frontend")));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
