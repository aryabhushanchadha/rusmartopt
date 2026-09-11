import { z } from "zod";

export const createListingSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(3000).optional(),
  category: z.string().max(60).optional(),
  price: z.number().int().nonnegative().optional(),
  unit: z.string().max(30).optional(),
  minOrderQty: z.number().int().positive().optional(),
  imageUrl: z.string().url().startsWith("https://").optional(),
});

export const updateListingSchema = createListingSchema.partial();
