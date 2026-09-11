import argon2 from "argon2";
import { prisma } from "../../db/prisma.js";
import { createCompany } from "../companies/service.js";
import { createSession, destroySession } from "./session.js";
import { HttpError } from "../../middleware/errorHandler.js";
import type { registerSchema, loginSchema, updateLanguageSchema } from "./schema.js";
import type { z } from "zod";
import type { Language } from "@prisma/client";

export async function register(input: z.infer<typeof registerSchema>) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new HttpError(409, "Пользователь с такой почтой уже зарегистрирован");
  }

  const company = await createCompany({
    name: input.companyName,
    type: input.companyType,
    industry: input.industry,
    city: input.city,
    inn: input.inn,
  });

  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
  const user = await prisma.user.create({
    data: {
      companyId: company.id,
      email: input.email,
      passwordHash,
      fullName: input.fullName,
      role: input.companyType, // 'supplier' | 'buyer' — matches UserRole enum values
      language: input.language ?? "ru",
    },
  });

  if (input.companyType === "buyer") {
    // Backfill: link any orders a supplier already created for this buyer by
    // name before the buyer had an account (see orders/service.ts createOrder,
    // which links by name going forward for new orders).
    await prisma.order.updateMany({
      where: { buyerCompanyId: null, buyerCompanyName: { equals: input.companyName, mode: "insensitive" } },
      data: { buyerCompanyId: company.id },
    });
  }

  const token = await createSession({ userId: user.id, role: user.role, companyId: company.id });
  return { token, user: publicUser(user), company };
}

export async function login(input: z.infer<typeof loginSchema>) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  // Generic error for both "no such user" and "wrong password" — don't leak which one.
  const genericError = () => new HttpError(401, "Неверная почта или пароль");

  if (!user) throw genericError();

  const valid = await argon2.verify(user.passwordHash, input.password).catch(() => false);
  if (!valid) throw genericError();

  const token = await createSession({ userId: user.id, role: user.role, companyId: user.companyId });
  return { token, user: publicUser(user) };
}

export async function logout(token: string) {
  await destroySession(token);
}

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { company: true } });
  if (!user) throw new HttpError(401, "Не авторизован");
  return { user: publicUser(user), company: user.company };
}

/** Not stored in the Redis session (which caches role/companyId, not language) — the SPA just re-fetches via GET /api/auth/me after switching, so there's no session-cache invalidation to worry about here. */
export async function updateLanguage(userId: string, input: z.infer<typeof updateLanguageSchema>) {
  const user = await prisma.user.update({ where: { id: userId }, data: { language: input.language } });
  return publicUser(user);
}

function publicUser(user: { id: string; email: string; fullName: string; role: string; companyId: string | null; language: Language }) {
  return { id: user.id, email: user.email, fullName: user.fullName, role: user.role, companyId: user.companyId, language: user.language };
}
