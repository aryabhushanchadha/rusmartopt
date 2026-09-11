-- CreateEnum
CREATE TYPE "CompanyType" AS ENUM ('supplier', 'buyer');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('supplier', 'buyer', 'admin');

-- CreateEnum
CREATE TYPE "NotifyChannel" AS ENUM ('telegram', 'sms');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('pending', 'sent', 'failed');

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CompanyType" NOT NULL,
    "inn" TEXT,
    "city" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "company_id" TEXT,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "order_code" TEXT NOT NULL,
    "public_tracking_token" TEXT NOT NULL,
    "seller_company_id" TEXT NOT NULL,
    "buyer_company_id" TEXT,
    "buyer_company_name" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "city" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "notify_channel" "NotifyChannel" NOT NULL,
    "due_date" TIMESTAMP(3) NOT NULL,
    "stage" INTEGER NOT NULL DEFAULT 0,
    "ship_stage" INTEGER,
    "tracking_number" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_stage_log" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "from_stage" INTEGER,
    "to_stage" INTEGER NOT NULL,
    "actor_user_id" TEXT,
    "actor_name" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_stage_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracking_lookup_attempts" (
    "id" TEXT NOT NULL,
    "order_code_attempted" TEXT NOT NULL,
    "ip_address" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracking_lookup_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "channel" "NotifyChannel" NOT NULL,
    "recipient" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'pending',
    "provider_response" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_links" (
    "id" TEXT NOT NULL,
    "order_id" TEXT,
    "company_id" TEXT,
    "chat_id" TEXT NOT NULL,
    "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_company_id_idx" ON "users"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_code_key" ON "orders"("order_code");

-- CreateIndex
CREATE UNIQUE INDEX "orders_public_tracking_token_key" ON "orders"("public_tracking_token");

-- CreateIndex
CREATE INDEX "orders_seller_company_id_idx" ON "orders"("seller_company_id");

-- CreateIndex
CREATE INDEX "orders_buyer_company_id_idx" ON "orders"("buyer_company_id");

-- CreateIndex
CREATE INDEX "order_stage_log_order_id_idx" ON "order_stage_log"("order_id");

-- CreateIndex
CREATE INDEX "tracking_lookup_attempts_order_code_attempted_created_at_idx" ON "tracking_lookup_attempts"("order_code_attempted", "created_at");

-- CreateIndex
CREATE INDEX "tracking_lookup_attempts_ip_address_created_at_idx" ON "tracking_lookup_attempts"("ip_address", "created_at");

-- CreateIndex
CREATE INDEX "notifications_order_id_idx" ON "notifications"("order_id");

-- CreateIndex
CREATE INDEX "telegram_links_order_id_idx" ON "telegram_links"("order_id");

-- CreateIndex
CREATE INDEX "telegram_links_company_id_idx" ON "telegram_links"("company_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_seller_company_id_fkey" FOREIGN KEY ("seller_company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyer_company_id_fkey" FOREIGN KEY ("buyer_company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_stage_log" ADD CONSTRAINT "order_stage_log_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_stage_log" ADD CONSTRAINT "order_stage_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_links" ADD CONSTRAINT "telegram_links_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_links" ADD CONSTRAINT "telegram_links_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
