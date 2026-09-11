import { z } from "zod";

// Illustrative starting list, not exhaustive — "other" exists precisely because
// the product is meant to support any manufacturing industry, not just these.
export const INDUSTRIES = [
  "Мебель", "Металлообработка", "Упаковка", "Текстиль", "Пластик",
  "Электроника", "Пищевое производство", "Другое",
] as const;

export const LANGUAGES = ["ru", "en", "zh", "vi"] as const;

export const registerSchema = z.object({
  companyName: z.string().min(2).max(200),
  companyType: z.enum(["supplier", "buyer"]),
  industry: z.string().max(60).optional(),
  city: z.string().min(1).max(120).optional(),
  inn: z.string().max(20).optional(),
  fullName: z.string().min(2).max(200),
  email: z.string().email(),
  password: z.string().min(8).max(200),
  // Interface language — the person picks it on the login/register screen
  // before an account even exists, so it has to be settable at signup, not
  // just afterward.
  language: z.enum(LANGUAGES).optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

export const updateLanguageSchema = z.object({
  language: z.enum(LANGUAGES),
});
