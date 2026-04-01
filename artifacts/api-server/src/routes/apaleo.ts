import { Router } from "express";
import { apaleoFetch, buildQueryString } from "../lib/apaleo";

const router = Router();

// ─── Properties ───────────────────────────────────────────────────────────────

router.get("/apaleo/properties", async (_req, res) => {
  try {
    const data = await apaleoFetch<{ properties: ApaleoProperty[] }>("/inventory/v1/properties");
    res.json(data.properties ?? []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/apaleo/properties/:propertyId", async (req, res) => {
  try {
    const data = await apaleoFetch<ApaleoProperty>(`/inventory/v1/properties/${req.params.propertyId}`);
    res.json(data);
  } catch (err: any) {
    const status = err.message.includes("404") ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// ─── Aggregated Property Stats ────────────────────────────────────────────────

router.get("/apaleo/properties/:propertyId/stats", async (req, res) => {
  const { propertyId } = req.params;
  const today = new Date().toISOString().split("T")[0];
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().split("T")[0];

  try {
    const [arrivalsData, departuresData, inHouseData, foliosData, maintenancesData] = await Promise.allSettled([
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
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Reservations ─────────────────────────────────────────────────────────────

router.get("/apaleo/reservations", async (req, res) => {
  try {
    const {
      propertyId, status, dateFrom, dateTo,
      pageNumber = "1", pageSize = "20",
    } = req.query as Record<string, string>;

    const qs = buildQueryString({
      propertyId,
      status,
      dateFrom,
      dateTo,
      pageNumber,
      pageSize,
      expand: "property,unitGroup,ratePlan,unit",
    });

    const data = await apaleoFetch<ApaleoReservationList>(`/booking/v1/reservations${qs}`);
    res.json({
      reservations: data.reservations ?? [],
      count: data.count ?? 0,
      pageNumber: Number(pageNumber),
      pageSize: Number(pageSize),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/apaleo/reservations/:id", async (req, res) => {
  try {
    const data = await apaleoFetch<ApaleoReservation>(
      `/booking/v1/reservations/${req.params.id}?expand=property,unitGroup,ratePlan,unit,booker,primaryGuest`
    );
    res.json(data);
  } catch (err: any) {
    const status = err.message.includes("404") ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// ─── Folios ───────────────────────────────────────────────────────────────────

router.get("/apaleo/folios", async (req, res) => {
  try {
    const { propertyId, reservationId, status, pageNumber = "1", pageSize = "20" } = req.query as Record<string, string>;
    const qs = buildQueryString({ propertyId, reservationId, status, pageNumber, pageSize });
    const data = await apaleoFetch<ApaleoFolioList>(`/finance/v1/folios${qs}`);
    res.json({ folios: data.folios ?? [], count: data.count ?? 0 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/apaleo/folios/:id", async (req, res) => {
  try {
    const data = await apaleoFetch<ApaleoFolio>(`/finance/v1/folios/${req.params.id}`);
    res.json(data);
  } catch (err: any) {
    const status = err.message.includes("404") ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// ─── Unit Groups ──────────────────────────────────────────────────────────────

router.get("/apaleo/unit-groups", async (req, res) => {
  try {
    const { propertyId } = req.query as Record<string, string>;
    const qs = buildQueryString({ propertyId });
    const data = await apaleoFetch<{ unitGroups: ApaleoUnitGroup[] }>(`/inventory/v1/unit-groups${qs}`);
    res.json(data.unitGroups ?? []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Rate Plans ───────────────────────────────────────────────────────────────

router.get("/apaleo/rate-plans", async (req, res) => {
  try {
    const { propertyId } = req.query as Record<string, string>;
    const qs = buildQueryString({ propertyId });
    const data = await apaleoFetch<{ ratePlans: ApaleoRatePlan[] }>(`/rateplan/v1/rate-plans${qs}`);
    res.json(data.ratePlans ?? []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Operations / Maintenance (Housekeeping) ─────────────────────────────────

router.get("/apaleo/maintenances", async (req, res) => {
  try {
    const { propertyId, type, status, pageNumber = "1", pageSize = "20" } = req.query as Record<string, string>;
    const qs = buildQueryString({ propertyId, type, status, pageNumber, pageSize });
    const data = await apaleoFetch<ApaleoMaintenanceList>(`/operations/v1/maintenances${qs}`);
    res.json({ maintenances: data.maintenances ?? [], count: data.count ?? 0 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Units ────────────────────────────────────────────────────────────────────

router.get("/apaleo/units", async (req, res) => {
  try {
    const { propertyId, unitGroupId, condition } = req.query as Record<string, string>;
    const qs = buildQueryString({ propertyId, unitGroupId, condition });
    const data = await apaleoFetch<{ units: ApaleoUnit[] }>(`/inventory/v1/units${qs}`);
    res.json(data.units ?? []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Availability ─────────────────────────────────────────────────────────────

router.get("/apaleo/availability/unit-groups", async (req, res) => {
  try {
    const { propertyId, arrival, departure, adults } = req.query as Record<string, string>;
    const qs = buildQueryString({ propertyId, arrival, departure, adults });
    const data = await apaleoFetch<{ unitGroups: unknown[] }>(`/availability/v1/unit-groups${qs}`);
    res.json(data.unitGroups ?? []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Type Stubs ───────────────────────────────────────────────────────────────

interface ApaleoProperty {
  id: string;
  code: string;
  name: { en: string; [lang: string]: string };
  location?: { addressLine1?: string; city?: string; countryCode?: string };
  timeZone?: string;
  unitCount?: number;
}

interface ApaleoReservation {
  id: string;
  status: string;
  arrival: string;
  departure: string;
  primaryGuest?: { firstName?: string; lastName?: string; email?: string };
  booker?: { firstName?: string; lastName?: string };
  unitGroup?: { id: string; name?: { en: string } };
  ratePlan?: { id: string; name?: { en: string } };
  unit?: { id: string; name?: string };
  property?: { id: string; name?: { en: string } };
  totalGrossAmount?: { amount: number; currency: string };
  channelCode?: string;
  source?: string;
}

interface ApaleoReservationList {
  reservations: ApaleoReservation[];
  count: number;
}

interface ApaleoFolio {
  id: string;
  status: string;
  reservationId?: string;
  charges?: { amount: { amount: number; currency: string }; serviceType?: string; name?: string }[];
  payments?: { amount: { amount: number; currency: string }; method?: string }[];
  balance?: { amount: number; currency: string };
}

interface ApaleoFolioList {
  folios: ApaleoFolio[];
  count: number;
}

interface ApaleoUnitGroup {
  id: string;
  name: { en: string; [lang: string]: string };
  type?: string;
  unitCount?: number;
}

interface ApaleoRatePlan {
  id: string;
  name: { en: string; [lang: string]: string };
  isPublic?: boolean;
  channelCode?: string;
}

interface ApaleoMaintenance {
  id: string;
  unitId: string;
  type?: string;
  description?: string;
  from?: string;
  to?: string;
  isActive?: boolean;
}

interface ApaleoMaintenanceList {
  maintenances: ApaleoMaintenance[];
  count: number;
}

interface ApaleoUnit {
  id: string;
  name?: string;
  unitGroupId?: string;
  condition?: string;
  status?: string;
}

export default router;
