import { Router, type IRouter } from "express";
import { apaleoFetch, buildQueryString } from "../lib/apaleo";
import { getTokenExpiry } from "../lib/apaleo-auth";
import { isMcpConfigured, listMcpTools, callMcpTool } from "../lib/apaleo-mcp";
import { withCache } from "../lib/apaleo-cache";
import type { ReservationStatus } from "../lib/apaleo-types";

const router: IRouter = Router();

const TTL = {
  properties: 5 * 60_000,
  reservations: 60_000,
  guests: 60_000,
  folios: 60_000,
  ratePlans: 10 * 60_000,
  revenueReport: 10 * 60_000,
  unitGroups: 5 * 60_000,
  units: 5 * 60_000,
};

// ─── Status ───────────────────────────────────────────────────────────────────

router.get("/apaleo/status", async (req, res) => {
  const clientId = process.env.APALEO_CLIENT_ID;
  const clientSecret = process.env.APALEO_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    res.status(503).json({
      connected: false,
      error: "Missing APALEO_CLIENT_ID or APALEO_CLIENT_SECRET environment variables",
      mcpConfigured: isMcpConfigured(),
    });
    return;
  }

  try {
    const result = await apaleoFetch<{ properties: { id: string }[]; count?: number }>(
      "/inventory/v1/properties?pageSize=100"
    );
    const propertyIds = (result.properties ?? []).map((p) => p.id);
    res.json({
      connected: true,
      propertyCount: result.count ?? propertyIds.length,
      propertiesReachable: propertyIds,
      tokenExpiry: getTokenExpiry(),
      mcpConfigured: isMcpConfigured(),
    });
  } catch (err: unknown) {
    req.log.error({ err }, "Apaleo status check failed");
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(503).json({ connected: false, error: message, mcpConfigured: isMcpConfigured() });
  }
});

// ─── Properties ───────────────────────────────────────────────────────────────

router.get("/apaleo/properties", async (req, res) => {
  try {
    const data = await withCache("properties", TTL.properties, () =>
      apaleoFetch<{ properties: unknown[]; count?: number }>("/inventory/v1/properties?pageSize=100")
    );
    res.json(data);
  } catch (err: unknown) {
    req.log.error({ err }, "Failed to fetch Apaleo properties");
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(502).json({ error: { message } });
  }
});

router.get("/apaleo/properties/:propertyId", async (req, res) => {
  try {
    const data = await apaleoFetch(`/inventory/v1/properties/${req.params.propertyId}`);
    res.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message.includes("404") ? 404 : 502;
    res.status(status).json({ error: { message } });
  }
});

// ─── Aggregated Property Stats ────────────────────────────────────────────────

router.get("/apaleo/properties/:propertyId/stats", async (req, res) => {
  const { propertyId } = req.params;
  const today = new Date().toISOString().split("T")[0];
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().split("T")[0];

  try {
    const [arrivalsData, departuresData, inHouseData, foliosData, maintenancesData] =
      await Promise.allSettled([
        apaleoFetch<{ count: number }>(
          `/booking/v1/reservations$count${buildQueryString({ propertyId, status: "Confirmed,InHouse", arrival: today })}`
        ),
        apaleoFetch<{ count: number }>(
          `/booking/v1/reservations$count${buildQueryString({ propertyId, status: "CheckedOut", departure: today })}`
        ),
        apaleoFetch<{ count: number }>(
          `/booking/v1/reservations$count${buildQueryString({ propertyId, status: "InHouse" })}`
        ),
        apaleoFetch<{ count: number }>(
          `/finance/v1/folios$count${buildQueryString({ propertyId, status: "Open" })}`
        ),
        apaleoFetch<{ count: number }>(
          `/operations/v1/maintenances$count${buildQueryString({ propertyId })}`
        ),
      ]);

    const safe = (result: PromiseSettledResult<{ count: number }>) =>
      result.status === "fulfilled" ? (result.value?.count ?? 0) : 0;

    res.json({
      propertyId,
      date: today,
      arrivalsToday: safe(arrivalsData),
      departuresToday: safe(departuresData),
      inHouseCount: safe(inHouseData),
      openFolios: safe(foliosData),
      pendingMaintenance: safe(maintenancesData),
      nextDay: tomorrow,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(502).json({ error: { message } });
  }
});

// ─── Reservations ─────────────────────────────────────────────────────────────

router.get("/apaleo/reservations", async (req, res) => {
  try {
    const {
      propertyId, status, dateFrom, dateTo, dateFilter, from, to,
      pageNumber = "1", pageSize = "20",
    } = req.query as Record<string, string>;

    const qs = buildQueryString({
      propertyIds: propertyId,
      status,
      dateFilter: dateFilter || dateFrom,
      from: from || dateTo,
      to,
      pageNumber,
      pageSize,
      expand: "property,unitGroup,ratePlan,unit",
    });

    const cacheKey = `reservations:${qs}`;
    const data = await withCache(cacheKey, TTL.reservations, () =>
      apaleoFetch<{ reservations: unknown[]; count?: number }>(`/booking/v1/reservations${qs}`)
    );

    res.json({
      reservations: (data as { reservations: unknown[] }).reservations ?? [],
      count: (data as { count?: number }).count ?? 0,
      pageNumber: Number(pageNumber),
      pageSize: Number(pageSize),
    });
  } catch (err: unknown) {
    req.log.error({ err }, "Failed to fetch Apaleo reservations");
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(502).json({ error: { message } });
  }
});

router.get("/apaleo/reservations/:id", async (req, res) => {
  try {
    const data = await apaleoFetch(
      `/booking/v1/reservations/${req.params.id}?expand=property,unitGroup,ratePlan,unit,booker,primaryGuest`
    );
    res.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message.includes("404") ? 404 : 502;
    res.status(status).json({ error: { message } });
  }
});

// ─── Guests (derived from reservations) ───────────────────────────────────────

router.get("/apaleo/guests", async (req, res) => {
  try {
    const { propertyId, status, pageSize = "100", pageNumber = "1" } = req.query as Record<string, string>;

    const qs = buildQueryString({ propertyIds: propertyId, status, pageSize, pageNumber });
    const cacheKey = `guests:${qs}`;

    const data = await withCache(cacheKey, TTL.guests, async () => {
      const result = await apaleoFetch<{ reservations: Array<{
        primaryGuest?: { id?: string };
        booker?: { id?: string };
      }>; count?: number }>(`/booking/v1/reservations${qs}`);

      const seen = new Set<string>();
      const guests: unknown[] = [];
      for (const r of result.reservations ?? []) {
        for (const g of [r.primaryGuest, r.booker]) {
          if (g && (g as { id?: string }).id && !seen.has((g as { id: string }).id)) {
            seen.add((g as { id: string }).id);
            guests.push(g);
          }
        }
      }
      return {
        guests,
        count: guests.length,
        derivedFrom: `reservations page ${pageNumber} (${result.reservations?.length ?? 0} records)`,
      };
    });

    res.json(data);
  } catch (err: unknown) {
    req.log.error({ err }, "Failed to fetch Apaleo guests");
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(502).json({ error: { message } });
  }
});

// ─── Folios ───────────────────────────────────────────────────────────────────

router.get("/apaleo/folios", async (req, res) => {
  try {
    const { propertyId, reservationId, status, pageNumber = "1", pageSize = "20" } =
      req.query as Record<string, string>;

    const qs = buildQueryString({ propertyId, reservationId, status, pageNumber, pageSize });
    const cacheKey = `folios:${qs}`;
    const data = await withCache(cacheKey, TTL.folios, () =>
      apaleoFetch<{ folios: unknown[]; count?: number }>(`/finance/v1/folios${qs}`)
    );

    res.json({
      folios: (data as { folios: unknown[] }).folios ?? [],
      count: (data as { count?: number }).count ?? 0,
    });
  } catch (err: unknown) {
    req.log.error({ err }, "Failed to fetch Apaleo folios");
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(502).json({ error: { message } });
  }
});

router.get("/apaleo/folios/:id", async (req, res) => {
  try {
    const data = await apaleoFetch(`/finance/v1/folios/${req.params.id}`);
    res.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message.includes("404") ? 404 : 502;
    res.status(status).json({ error: { message } });
  }
});

// ─── Unit Groups ──────────────────────────────────────────────────────────────

router.get("/apaleo/unit-groups", async (req, res) => {
  try {
    const { propertyId } = req.query as Record<string, string>;
    const qs = buildQueryString({ propertyId });
    const cacheKey = `unit-groups:${qs}`;
    const data = await withCache(cacheKey, TTL.unitGroups, () =>
      apaleoFetch<{ unitGroups: unknown[] }>(`/inventory/v1/unit-groups${qs}`)
    );
    res.json((data as { unitGroups: unknown[] }).unitGroups ?? []);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(502).json({ error: { message } });
  }
});

// ─── Rate Plans ───────────────────────────────────────────────────────────────

router.get("/apaleo/rate-plans", async (req, res) => {
  try {
    const { propertyId, unitGroupId, channelCode, isArchived, pageSize = "100", pageNumber = "1" } =
      req.query as Record<string, string>;

    const qs = buildQueryString({ propertyId, unitGroupId, channelCode, isArchived, pageSize, pageNumber });
    const cacheKey = `rate-plans:${qs}`;
    const data = await withCache(cacheKey, TTL.ratePlans, () =>
      apaleoFetch<{ ratePlans: unknown[]; count?: number }>(`/rateplan/v1/rate-plans${qs}`)
    );
    res.json(data);
  } catch (err: unknown) {
    req.log.error({ err }, "Failed to fetch Apaleo rate plans");
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(502).json({ error: { message } });
  }
});

// ─── Revenue Report ───────────────────────────────────────────────────────────

router.get("/apaleo/reports/revenue", async (req, res) => {
  try {
    const { propertyId, from, to } = req.query as Record<string, string>;
    const qs = buildQueryString({ propertyId, from, to });
    const cacheKey = `revenue-report:${qs}`;
    const data = await withCache(cacheKey, TTL.revenueReport, () =>
      apaleoFetch(`/reports/v1/reports/revenue${qs}`)
    );
    res.json(data);
  } catch (err: unknown) {
    req.log.error({ err }, "Failed to fetch Apaleo revenue report");
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(502).json({ error: { message } });
  }
});

// ─── Operations / Maintenance (Housekeeping) ─────────────────────────────────

router.get("/apaleo/maintenances", async (req, res) => {
  try {
    const { propertyId, type, status, pageNumber = "1", pageSize = "20" } =
      req.query as Record<string, string>;
    const qs = buildQueryString({ propertyId, type, status, pageNumber, pageSize });
    const data = await apaleoFetch<{ maintenances: unknown[]; count?: number }>(
      `/operations/v1/maintenances${qs}`
    );
    res.json({ maintenances: data.maintenances ?? [], count: data.count ?? 0 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(502).json({ error: { message } });
  }
});

// ─── Units ────────────────────────────────────────────────────────────────────

router.get("/apaleo/units", async (req, res) => {
  try {
    const { propertyId, unitGroupId, condition } = req.query as Record<string, string>;
    const qs = buildQueryString({ propertyId, unitGroupId, condition });
    const cacheKey = `units:${qs}`;
    const data = await withCache(cacheKey, TTL.units, () =>
      apaleoFetch<{ units: unknown[] }>(`/inventory/v1/units${qs}`)
    );
    res.json((data as { units: unknown[] }).units ?? []);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(502).json({ error: { message } });
  }
});

// ─── Availability ─────────────────────────────────────────────────────────────

router.get("/apaleo/availability/unit-groups", async (req, res) => {
  try {
    const { propertyId, arrival, departure, adults } = req.query as Record<string, string>;
    const qs = buildQueryString({ propertyId, arrival, departure, adults });
    const data = await apaleoFetch<{ unitGroups: unknown[] }>(
      `/availability/v1/unit-groups${qs}`
    );
    res.json((data as { unitGroups: unknown[] }).unitGroups ?? []);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(502).json({ error: { message } });
  }
});

// ─── MCP Tools ────────────────────────────────────────────────────────────────

router.get("/apaleo/mcp/tools", async (req, res) => {
  try {
    const tools = await listMcpTools();
    res.json({ tools, count: tools.length });
  } catch (err: unknown) {
    req.log.error({ err }, "Failed to list Apaleo MCP tools");
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(502).json({ error: { message } });
  }
});

router.post("/apaleo/mcp/tools/:toolName", async (req, res) => {
  try {
    const { toolName } = req.params;
    const toolArgs = (req.body ?? {}) as Record<string, unknown>;
    const result = await callMcpTool(toolName, toolArgs);
    res.json(result);
  } catch (err: unknown) {
    req.log.error({ err }, "Failed to call Apaleo MCP tool");
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(502).json({ error: { message } });
  }
});

export default router;
