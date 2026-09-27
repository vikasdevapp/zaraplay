-- Uploaded game images were saved with the host they were uploaded through
-- (e.g. http://75.101.203.116/uploads/...), which broke once the site moved to
-- https://zaraplays.com. Keep only the site-relative path.
UPDATE "Game"
SET "imageUrl" = regexp_replace("imageUrl", '^https?://[^/]+(/uploads/)', '\1')
WHERE "imageUrl" ~ '^https?://[^/]+/uploads/';
