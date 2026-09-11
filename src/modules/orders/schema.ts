import { z } from "zod";

export const STAGE_MIN = 0;
export const STAGE_MAX = 7; // 7 = shipped
export const SHIP_STAGE_MIN = 0;
export const SHIP_STAGE_MAX = 4;

export const createOrderSchema = z.object({
  buyerCompanyName: z.string().min(1).max(200),
  product: z.string().min(1).max(300),
  qty: z.number().int().positive(),
  price: z.number().int().nonnegative(),
  city: z.string().min(1).max(120),
  phone: z.string().min(5).max(30),
  notifyChannel: z.enum(["telegram", "sms"]),
  dueDate: z.coerce.date(),
});

export const updateOrderSchema = createOrderSchema.partial();

export const advanceStageSchema = z.object({
  note: z.string().max(500).optional(),
});

export const shipSchema = z.object({
  trackingNumber: z.string().max(60).optional(),
});

export const updateShipStageSchema = z.object({
  shipStage: z.number().int().min(SHIP_STAGE_MIN).max(SHIP_STAGE_MAX),
});
