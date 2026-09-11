import { z } from "zod";

export const trackLookupSchema = z.object({
  orderCode: z.string().min(1).max(30),
  phoneLast4: z.string().regex(/^\d{4}$/, "Введите последние 4 цифры телефона"),
});
