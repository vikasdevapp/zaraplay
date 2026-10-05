-- The per-IP signup cap is now a lifetime limit (counted from User.signupIp), not per day.
-- Update the default message and the existing row's message if it's still the old default.
ALTER TABLE "PlatformSettings"
  ALTER COLUMN "ipBlockMessage" SET DEFAULT 'Only {max} accounts can be created per device/network. Please contact support if you need help.';

UPDATE "PlatformSettings"
SET "ipBlockMessage" = 'Only {max} accounts can be created per device/network. Please contact support if you need help.'
WHERE "id" = 'default'
  AND "ipBlockMessage" = 'Only {max} accounts can be created per device/network each day. Please try again tomorrow.';
