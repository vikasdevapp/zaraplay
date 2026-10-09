-- Add the withdrawable (played-through, directly-cashable) portion of the wallet balance.
ALTER TABLE "Wallet" ADD COLUMN "withdrawable" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Grandfather existing real balances as withdrawable so current users aren't retroactively locked
-- out of cashing out what they already have. New credits follow the play-through rule.
UPDATE "Wallet" SET "withdrawable" = "balance";

-- Retire Free Play: fold any remaining Free Play into the real (playable) balance. Because this
-- happens after the grandfather step, converted Free Play is locked (not withdrawable) and must be
-- played through a game before it can be cashed out.
UPDATE "Wallet" SET "balance" = "balance" + "freePlay", "freePlay" = 0 WHERE "freePlay" <> 0;
