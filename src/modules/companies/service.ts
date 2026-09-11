import { prisma } from "../../db/prisma.js";
import { HttpError } from "../../middleware/errorHandler.js";
import { uniqueSlug } from "../../utils/slug.js";
import type { CompanyType } from "@prisma/client";

export async function createCompany(input: { name: string; type: CompanyType; industry?: string; city?: string; inn?: string }) {
  return prisma.company.create({ data: input });
}

export async function getOwnCompany(companyId: string) {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) throw new HttpError(404, "Компания не найдена");
  return company;
}

/**
 * Assigns a slug if the company doesn't have one yet — called lazily on
 * first profile save or first listing publish, never re-derived afterward
 * (see schema.prisma comment on Company.slug: immutable once set, so shared
 * links never break).
 */
export async function ensureSlug(companyId: string, name: string): Promise<string> {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) throw new HttpError(404, "Компания не найдена");
  if (company.slug) return company.slug;

  const slug = await uniqueSlug(name, async (candidate) => {
    const existing = await prisma.company.findUnique({ where: { slug: candidate } });
    return Boolean(existing);
  });
  await prisma.company.update({ where: { id: companyId }, data: { slug } });
  return slug;
}

export async function updateOwnCompany(
  companyId: string,
  input: {
    industry?: string | null; city?: string | null; inn?: string | null;
    description?: string | null; logoUrl?: string | null; website?: string | null;
    notifyPhone?: string | null; notifyChannel?: "telegram" | "sms" | null;
    notifyLanguage?: "ru" | "en" | "zh" | "vi";
  }
) {
  await ensureSlug(companyId, (await getOwnCompany(companyId)).name);
  return prisma.company.update({ where: { id: companyId }, data: input });
}

export async function getPublicCompanyBySlug(slug: string) {
  return prisma.company.findUnique({ where: { slug } });
}
