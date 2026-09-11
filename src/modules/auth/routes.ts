import { Router } from "express";
import * as authService from "./service.js";
import { registerSchema, loginSchema, updateLanguageSchema } from "./schema.js";
import { requireAuth } from "../../middleware/auth.js";
import { env } from "../../config/env.js";
import { ipRateLimit } from "../../middleware/rateLimit.js";

export const authRouter = Router();

const cookieOpts = () => ({
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: env.SESSION_TTL_SECONDS * 1000,
  path: "/",
});

authRouter.post("/register", ipRateLimit(20, 3600), async (req, res, next) => {
  try {
    const input = registerSchema.parse(req.body);
    const { token, user, company } = await authService.register(input);
    res.cookie(env.SESSION_COOKIE_NAME, token, cookieOpts());
    res.status(201).json({ user, company });
  } catch (err) {
    next(err);
  }
});

// Login is rate-limited per-IP to slow credential stuffing; it does not need
// the phone-verification-style protection the public tracking endpoint needs,
// because it's protected by a real (hashed, secret) password, not a 4-digit value.
authRouter.post("/login", ipRateLimit(20, 900), async (req, res, next) => {
  try {
    const input = loginSchema.parse(req.body);
    const { token, user } = await authService.login(input);
    res.cookie(env.SESSION_COOKIE_NAME, token, cookieOpts());
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout", requireAuth, async (req, res, next) => {
  try {
    const token = req.cookies?.[env.SESSION_COOKIE_NAME];
    if (token) await authService.logout(token);
    res.clearCookie(env.SESSION_COOKIE_NAME, { path: "/" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

authRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    const result = await authService.getMe(req.user!.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

authRouter.patch("/language", requireAuth, async (req, res, next) => {
  try {
    const input = updateLanguageSchema.parse(req.body);
    const user = await authService.updateLanguage(req.user!.userId, input);
    res.json({ user });
  } catch (err) {
    next(err);
  }
});
