import { z } from "zod";

export const startConversationSchema = z.object({
  listingId: z.string().uuid(),
  message: z.string().min(1).max(2000),
});

export const sendMessageSchema = z.object({
  message: z.string().min(1).max(2000),
});
