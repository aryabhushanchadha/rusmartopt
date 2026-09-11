-- CreateEnum
CREATE TYPE "Language" AS ENUM ('ru', 'en', 'zh', 'vi');

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "notify_language" "Language" NOT NULL DEFAULT 'ru';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "language" "Language" NOT NULL DEFAULT 'ru';

