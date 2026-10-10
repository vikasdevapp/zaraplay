-- New game-automation providers. Cash Frenzy-style (Bearer token) and MilkyWay-style (ws/sign).
ALTER TYPE "GameAutomationProvider" ADD VALUE IF NOT EXISTS 'NOBLE';
ALTER TYPE "GameAutomationProvider" ADD VALUE IF NOT EXISTS 'GAMEROOM';
ALTER TYPE "GameAutomationProvider" ADD VALUE IF NOT EXISTS 'MAFIA';
ALTER TYPE "GameAutomationProvider" ADD VALUE IF NOT EXISTS 'VEGASROLL';
ALTER TYPE "GameAutomationProvider" ADD VALUE IF NOT EXISTS 'CASHMACHINE';
ALTER TYPE "GameAutomationProvider" ADD VALUE IF NOT EXISTS 'MRALLINONE';
ALTER TYPE "GameAutomationProvider" ADD VALUE IF NOT EXISTS 'MILKYWAY';
ALTER TYPE "GameAutomationProvider" ADD VALUE IF NOT EXISTS 'ORIONSTARS';
