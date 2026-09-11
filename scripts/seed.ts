import argon2 from "argon2";
import { prisma } from "../src/db/prisma.js";
import { generateOrderCode, randomToken } from "../src/utils/tokens.js";
import { uniqueSlug } from "../src/utils/slug.js";

async function main() {
  console.log("Seeding RuSmartOpt dev database...");

  const passwordHash = await argon2.hash("password123", { type: argon2.argon2id });

  const supplier1 = await prisma.company.create({
    data: { name: "МебельГрад", type: "supplier", city: "Москва", inn: "7701234567" },
  });
  const supplier2 = await prisma.company.create({
    data: { name: "ПромСнаб", type: "supplier", city: "Подольск", inn: "5001234567" },
  });
  const buyer1 = await prisma.company.create({
    data: { name: "СтройДвор", type: "buyer", city: "Химки" },
  });

  const anna = await prisma.user.create({
    data: { companyId: supplier1.id, email: "anna@zavod.ru", passwordHash, fullName: "Анна Котова", role: "supplier" },
  });
  await prisma.user.create({
    data: { companyId: supplier2.id, email: "oleg@promsnab.ru", passwordHash, fullName: "Олег Смирнов", role: "supplier" },
  });
  const igor = await prisma.user.create({
    data: { companyId: buyer1.id, email: "igor@stroydvor.ru", passwordHash, fullName: "Игорь Соколов", role: "buyer" },
  });
  await prisma.user.create({
    data: { email: "admin@rusmartopt.ru", passwordHash, fullName: "Admin", role: "admin" },
  });

  const demoOrders = [
    { product: "Стеллаж торговый МГ-200", qty: 120, price: 864000, stage: 2, phone: "+7 916 402-8871" },
    { product: "Прилавок кассовый ПК-90", qty: 30, price: 415000, stage: 3, phone: "+7 916 402-3390" },
    { product: "Дверь противопожарная ДП-01", qty: 44, price: 748000, stage: 1, phone: "+7 968 330-5527" },
    { product: "Решётка вентиляционная РВ-2", qty: 300, price: 210000, stage: 6, phone: "+7 968 330-2201" },
    { product: "Профиль оконный ПВХ", qty: 1200, price: 684000, stage: 7, phone: "+7 968 330-8814" },
  ];

  for (const d of demoOrders) {
    const order = await prisma.order.create({
      data: {
        orderCode: generateOrderCode(),
        publicTrackingToken: randomToken(16),
        sellerCompanyId: supplier1.id,
        buyerCompanyId: buyer1.id,
        buyerCompanyName: buyer1.name,
        product: d.product,
        qty: d.qty,
        price: d.price,
        city: buyer1.city!,
        phone: d.phone,
        notifyChannel: "telegram",
        dueDate: new Date(Date.now() + 5 * 86400000),
        stage: d.stage,
        shipStage: d.stage === 7 ? 1 : null,
        trackingNumber: d.stage === 7 ? `ZH-${Math.floor(70000000 + Math.random() * 9999999)}` : null,
        createdById: anna.id,
      },
    });
    await prisma.orderStageLog.create({
      data: { orderId: order.id, toStage: d.stage, actorUserId: anna.id, actorName: anna.fullName },
    });
  }

  // Demo marketplace listings — mixed published/draft so later manual/automated
  // verification of the public marketplace pages has real data to check
  // against (published ones should render; the draft must not).
  const companySlug = await uniqueSlug(supplier1.name, async (c) => Boolean(await prisma.company.findUnique({ where: { slug: c } })));
  await prisma.company.update({ where: { id: supplier1.id }, data: { slug: companySlug, description: "Производство торговой и складской мебели с 2014 года.", website: "https://mebelgrad.example" } });

  const demoListings = [
    { title: "Стеллаж торговый МГ-200", description: "Металлический стеллаж для магазина, 5 полок.", category: "Мебель", price: 7200, unit: "шт", minOrderQty: 5, published: true },
    { title: "Прилавок кассовый ПК-90", description: "Кассовый прилавок с ящиком, ЛДСП 16мм.", category: "Мебель", price: 12500, unit: "шт", minOrderQty: 1, published: true },
    { title: "Витрина торговая ВТ-150", description: "Черновик — ещё не готов к публикации.", category: "Мебель", price: null, unit: undefined, minOrderQty: undefined, published: false },
  ];
  let firstListingId: string | null = null;
  for (const l of demoListings) {
    const slug = await uniqueSlug(l.title, async (c) =>
      Boolean(await prisma.listing.findUnique({ where: { companyId_slug: { companyId: supplier1.id, slug: c } } }))
    );
    const created = await prisma.listing.create({
      data: {
        companyId: supplier1.id,
        slug,
        title: l.title,
        description: l.description,
        category: l.category,
        price: l.price ?? undefined,
        unit: l.unit,
        minOrderQty: l.minOrderQty,
        published: l.published,
      },
    });
    if (!firstListingId) firstListingId = created.id;
  }

  // Demo billing: supplier1 has an active promo-priced marketplace subscription,
  // giving local dev/manual QA a populated "Подписка" view without needing a
  // real ЮKassa checkout.
  await prisma.subscription.create({
    data: {
      companyId: supplier1.id,
      plan: "marketplace_full",
      status: "active",
      priceRub: 15000,
      isPromoPrice: true,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
    },
  });

  // Demo messaging: buyer1 has already contacted supplier1 about the first
  // published listing, with a reply — populates both "Сообщения" inboxes.
  if (firstListingId) {
    const conversation = await prisma.conversation.create({
      data: { listingId: firstListingId, buyerCompanyId: buyer1.id, sellerCompanyId: supplier1.id },
    });
    await prisma.message.create({
      data: { conversationId: conversation.id, senderCompanyId: buyer1.id, senderUserId: igor.id, body: "Добрый день! Есть в наличии 50 штук, доставка в Химки?" },
    });
    await prisma.message.create({
      data: { conversationId: conversation.id, senderCompanyId: supplier1.id, senderUserId: anna.id, body: "Добрый день! Да, 50 штук есть в наличии, доставим в течение 3 дней.", readAt: new Date() },
    });
    await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });
  }

  console.log("Seed complete.");
  console.log(`Marketplace: http://localhost:3000/postavshiki/${companySlug}`);
  console.log("Supplier login: anna@zavod.ru / password123");
  console.log("Buyer login:    igor@stroydvor.ru / password123");
  console.log(`Buyer company id (for reference): ${buyer1.id}, user id: ${igor.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
