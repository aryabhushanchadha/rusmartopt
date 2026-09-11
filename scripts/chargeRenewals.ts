import { prisma } from "../src/db/prisma.js";
import { chargeDueRenewals } from "../src/modules/billing/renewalService.js";

/**
 * Meant to be invoked on a schedule (daily cron / Yandex Cloud Function
 * trigger) — not run in-process by the server. `npm run charge-renewals`.
 */
async function main() {
  const result = await chargeDueRenewals();
  console.log("Renewal cycle complete:", result);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
