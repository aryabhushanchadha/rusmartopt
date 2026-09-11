import type { Request, Response, NextFunction } from "express";
import { getSession, type SessionData } from "../modules/auth/session.js";
import { env } from "../config/env.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionData;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[env.SESSION_COOKIE_NAME];
  if (!token) {
    res.status(401).json({ error: "Не авторизован" });
    return;
  }
  const session = await getSession(token);
  if (!session) {
    res.status(401).json({ error: "Сессия истекла, войдите снова" });
    return;
  }
  req.user = session;
  next();
}

export function requireRole(...roles: SessionData["role"][]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: "Недостаточно прав" });
      return;
    }
    next();
  };
}

/**
 * CSRF mitigation for cookie-based sessions: state-changing requests must carry
 * a custom header. A cross-site <form> POST cannot set custom headers, but the
 * frontend's fetch() calls do (see frontend/api.js), so this is transparent to
 * legitimate same-app traffic while blocking classic CSRF form submissions.
 */
export function requireCsrfHeader(req: Request, res: Response, next: NextFunction) {
  if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) {
    if (req.get("X-Requested-With") !== "rso-frontend") {
      res.status(403).json({ error: "Недопустимый запрос" });
      return;
    }
  }
  next();
}
