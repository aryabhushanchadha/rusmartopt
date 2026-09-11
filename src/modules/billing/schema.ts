import { z } from "zod";

export const checkoutSchema = z.object({
  plan: z.enum(["software", "marketplace_full"]),
});
