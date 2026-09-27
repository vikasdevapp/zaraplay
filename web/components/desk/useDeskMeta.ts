"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/context/AuthContext";
import type { DeskGame, DeskStaff } from "@/lib/desk";

/** Games and staff for the Agent Desk's forms and filters. */
export function useDeskMeta() {
  const api = useApi();
  const [games, setGames] = useState<DeskGame[]>([]);
  const [staff, setStaff] = useState<DeskStaff[]>([]);
  useEffect(() => {
    api<{ games: DeskGame[]; staff: DeskStaff[] }>("/api/agent/desk/meta")
      .then((r) => {
        setGames(r.games);
        setStaff(r.staff);
      })
      .catch(() => {});
  }, [api]);
  return { games, staff };
}
