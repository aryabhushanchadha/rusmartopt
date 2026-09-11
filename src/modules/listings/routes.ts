import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import * as listingsService from "./service.js";
import { createListingSchema, updateListingSchema } from "./schema.js";

export const listingsRouter = Router();

listingsRouter.use(requireAuth, requireRole("supplier"));

listingsRouter.get("/", async (req, res, next) => {
  try {
    res.json(await listingsService.listOwnListings(req.user!));
  } catch (err) { next(err); }
});

listingsRouter.post("/", async (req, res, next) => {
  try {
    const input = createListingSchema.parse(req.body);
    res.status(201).json(await listingsService.createListing(req.user!, input));
  } catch (err) { next(err); }
});

listingsRouter.get("/:id", async (req, res, next) => {
  try {
    res.json(await listingsService.getOwnListing(req.user!, req.params.id));
  } catch (err) { next(err); }
});

listingsRouter.patch("/:id", async (req, res, next) => {
  try {
    const input = updateListingSchema.parse(req.body);
    res.json(await listingsService.updateListing(req.user!, req.params.id, input));
  } catch (err) { next(err); }
});

listingsRouter.delete("/:id", async (req, res, next) => {
  try {
    await listingsService.deleteListing(req.user!, req.params.id);
    res.status(204).send();
  } catch (err) { next(err); }
});

listingsRouter.post("/:id/publish", async (req, res, next) => {
  try {
    res.json(await listingsService.setPublished(req.user!, req.params.id, true));
  } catch (err) { next(err); }
});

listingsRouter.post("/:id/unpublish", async (req, res, next) => {
  try {
    res.json(await listingsService.setPublished(req.user!, req.params.id, false));
  } catch (err) { next(err); }
});
