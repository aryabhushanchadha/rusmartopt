import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import * as companiesService from "./service.js";
import { updateCompanySchema } from "./schema.js";
import { HttpError } from "../../middleware/errorHandler.js";

export const companiesRouter = Router();

companiesRouter.use(requireAuth);

companiesRouter.get("/me", async (req, res, next) => {
  try {
    if (!req.user!.companyId) throw new HttpError(404, "Компания не найдена");
    res.json(await companiesService.getOwnCompany(req.user!.companyId));
  } catch (err) { next(err); }
});

companiesRouter.patch("/me", async (req, res, next) => {
  try {
    if (!req.user!.companyId) throw new HttpError(404, "Компания не найдена");
    const input = updateCompanySchema.parse(req.body);
    res.json(await companiesService.updateOwnCompany(req.user!.companyId, input));
  } catch (err) { next(err); }
});
