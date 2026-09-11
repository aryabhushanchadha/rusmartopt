import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { env } from "../../config/env.js";
import { getSession } from "../auth/session.js";
import * as authService from "../auth/service.js";
import { loginSchema } from "../auth/schema.js";
import { checkAndIncrRateLimit, clientIp } from "../../middleware/rateLimit.js";
import { HttpError } from "../../middleware/errorHandler.js";
import { getDashboardMetrics } from "./service.js";

export const adminRouter = Router();

/**
 * A browser-facing gate, deliberately separate from requireAuth/requireRole
 * (which return raw JSON 401/403 — correct for the API, wrong for a page a
 * human navigates to). No session -> redirect to the login form; wrong role
 * -> a plain HTML 403, not a login loop, since re-authenticating wouldn't help.
 */
async function requireAdminPage(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[env.SESSION_COOKIE_NAME];
  const session = token ? await getSession(token) : null;
  if (!session) {
    res.redirect(302, "/admin/login");
    return;
  }
  if (session.role !== "admin") {
    res.status(403).render("admin/forbidden", { title: "Доступ запрещён — RuSmartOpt" });
    return;
  }
  req.user = session;
  next();
}

adminRouter.get("/admin/login", (req, res) => {
  res.render("admin/login", { title: "Вход для администратора — RuSmartOpt", error: null });
});

// Plain HTML form POST, not a fetch() call — can't carry the SPA's CSRF
// header, so this is (like the JSON login API) rate-limited instead. A
// login-CSRF here can at most log an attacker's own account into the
// victim's browser, and doing anything useful still requires knowing real
// admin credentials, so this matches the existing login route's threat model.
//
// Rate limiting is inlined here (not the shared ipRateLimit middleware)
// specifically so a throttled or malformed request re-renders the login
// page with a real error message instead of leaking a raw JSON body to a
// browser — this route's whole reason to exist separately from the JSON
// API is browser-appropriate responses; a bare 429/400 JSON blob defeats that.
adminRouter.post("/admin/login", async (req, res, next) => {
  const title = "Вход для администратора — RuSmartOpt";
  try {
    const { allowed } = await checkAndIncrRateLimit(`ip:/admin/login:${clientIp(req)}`, 20, 900);
    if (!allowed) {
      res.status(429).render("admin/login", { title, error: "Слишком много попыток. Попробуйте позже." });
      return;
    }
    const input = loginSchema.parse(req.body);
    const { token, user } = await authService.login(input);
    if (user.role !== "admin") {
      await authService.logout(token);
      res.status(403).render("admin/login", { title, error: "Доступ только для администраторов" });
      return;
    }
    res.cookie(env.SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: env.SESSION_TTL_SECONDS * 1000,
      path: "/",
    });
    res.redirect(302, "/admin");
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) {
      res.status(401).render("admin/login", { title, error: "Неверная почта или пароль" });
      return;
    }
    if (err instanceof ZodError) {
      res.status(400).render("admin/login", { title, error: "Проверьте правильность введённых данных" });
      return;
    }
    next(err);
  }
});

adminRouter.get("/admin", requireAdminPage, async (req, res, next) => {
  try {
    const metrics = await getDashboardMetrics();
    res.render("admin/dashboard", { title: "Метрики — RuSmartOpt", metrics });
  } catch (err) {
    next(err);
  }
});
