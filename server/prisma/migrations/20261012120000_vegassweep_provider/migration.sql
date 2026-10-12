-- Vegas Sweep: Juwa-style (agent_id + secret, MD5-signed) provider, same API as Game Vault.
ALTER TYPE "GameAutomationProvider" ADD VALUE IF NOT EXISTS 'VEGASSWEEP';
