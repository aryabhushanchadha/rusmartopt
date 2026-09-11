import { z } from "zod";

export const updateCompanySchema = z.object({
  // Set at registration but not editable there afterward until now — a real
  // gap: a seller mistyping their industry/city/INN at signup had no way to
  // fix it. name is deliberately excluded: it seeds the public URL slug
  // (see companies/service.ts ensureSlug), and slugs are immutable once
  // assigned so existing shared links never break.
  //
  // Every field below is .nullable(): omitting a key means "leave
  // unchanged" (the usual PATCH semantics), but explicitly sending `null`
  // clears it — all these columns are already nullable in the DB, so this
  // was a validation-layer gap, not a schema one. Without it, a seller who
  // set a website/logo/phone once had no way to unset it again.
  industry: z.string().max(60).nullable().optional(),
  city: z.string().min(1).max(120).nullable().optional(),
  inn: z.string().max(20).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  logoUrl: z.string().url().startsWith("https://").nullable().optional(),
  website: z.string().url().startsWith("https://").nullable().optional(),
  notifyPhone: z.string().min(5).max(30).nullable().optional(),
  notifyChannel: z.enum(["telegram", "sms"]).nullable().optional(),
  // Language for SMS/Telegram notifications sent to this company — separate
  // from each User's own interface language (see auth/schema.ts). Always
  // has a sensible default (ru), so clearing it isn't a supported concept.
  notifyLanguage: z.enum(["ru", "en", "zh", "vi"]).optional(),
});
