-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "description" TEXT,
ADD COLUMN     "logo_url" TEXT,
ADD COLUMN     "slug" TEXT,
ADD COLUMN     "website" TEXT;

-- CreateTable
CREATE TABLE "listings" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "price" INTEGER,
    "unit" TEXT,
    "min_order_qty" INTEGER,
    "image_url" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "listings_company_id_idx" ON "listings"("company_id");

-- CreateIndex
CREATE INDEX "listings_published_updated_at_idx" ON "listings"("published", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "listings_company_id_slug_key" ON "listings"("company_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "companies_slug_key" ON "companies"("slug");

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

