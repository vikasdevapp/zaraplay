-- AlterTable
ALTER TABLE "UserGame" ADD COLUMN     "loadDeposit" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "loadTotal" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "GameRequest" ADD COLUMN     "loadDeposit" DECIMAL(12,2);

