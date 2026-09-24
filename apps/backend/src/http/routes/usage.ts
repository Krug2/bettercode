import type { Hono } from "hono"
import type { AppState } from "../../appState"
import { UsageService } from "../../services/usage/service"
import { HttpError } from "../errors"

export function registerUsageRoutes(api: Hono, state: AppState): void {
  let service: UsageService | undefined
  api.get("/usage", (c) => {
    const timeZone = c.req.query("timeZone") ?? "UTC"
    try {
      if (timeZone.length > 100) throw new Error()
      new Intl.DateTimeFormat("en", { timeZone }).format(0)
    } catch {
      throw new HttpError(400, "Invalid time zone", "invalid_time_zone")
    }
    service ??= new UsageService(state.db)
    c.header("Cache-Control", "no-store")
    return c.json(service.dashboard(timeZone))
  })
}
