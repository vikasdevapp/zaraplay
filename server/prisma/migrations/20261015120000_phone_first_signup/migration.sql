-- Phone-first signup: email becomes optional, phone becomes unique.
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;

-- Unique phone (Postgres allows multiple NULLs under a unique index).
CREATE UNIQUE INDEX IF NOT EXISTS "User_phone_key" ON "User"("phone");
