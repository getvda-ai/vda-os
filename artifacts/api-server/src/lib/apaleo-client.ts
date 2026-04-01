import { getApaleoToken } from "./apaleo-auth.js";
import { withCache } from "./apaleo-cache.js";
import type {
  ApaleoPropertyList,
  ApaleoReservationList,
  ApaleoFolioList,
  ApaleoRatePlanList,
  ApaleoRevenueReport,
  ReservationStatus,
  ApaleoGuest,
} from "./apaleo-types.js";

const APALEO_API_BASE = "https://api.apaleo.com";

const TTL = {
  properties: 5 * 60_000,
  reservations: 60_000,
  guests: 60_000,
  folios: 60_000,
  ratePlans: 10 * 60_000,
  revenueReport: 10 * 60_000,
};

async function apaleoFetch<T>(
  path: string,
  params?: Record<string, string | number | boolean>
): Promise<T> {
  const token = await getApaleoToken();

  const url = new URL(`${APALEO_API_BASE}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Apaleo API error ${response.status} ${response.statusText}: ${text}`
    );
  }

  return response.json() as Promise<T>;
}

export async function fetchProperties(bust = false): Promise<ApaleoPropertyList> {
  const key = "properties";
  if (bust) {
    const { cacheDelete } = await import("./apaleo-cache.js");
    cacheDelete(key);
  }
  return withCache(key, TTL.properties, () =>
    apaleoFetch<ApaleoPropertyList>("/inventory/v1/properties", { pageSize: 100 })
  );
}

export async function fetchReservations(params?: {
  propertyId?: string;
  status?: ReservationStatus;
  dateFilter?: string;
  from?: string;
  to?: string;
  pageSize?: number;
  pageNumber?: number;
}): Promise<ApaleoReservationList> {
  const query: Record<string, string | number | boolean> = {
    pageSize: params?.pageSize ?? 100,
    pageNumber: params?.pageNumber ?? 1,
  };
  if (params?.propertyId) query["propertyIds"] = params.propertyId;
  if (params?.status) query["status"] = params.status;
  if (params?.dateFilter) query["dateFilter"] = params.dateFilter;
  if (params?.from) query["from"] = params.from;
  if (params?.to) query["to"] = params.to;

  const key = `reservations:${JSON.stringify(query)}`;
  return withCache(key, TTL.reservations, () =>
    apaleoFetch<ApaleoReservationList>("/booking/v1/reservations", query)
  );
}

export async function fetchGuests(params?: {
  propertyId?: string;
  status?: ReservationStatus;
  pageSize?: number;
  pageNumber?: number;
}): Promise<{ guests: ApaleoGuest[]; count: number; derivedFrom: string }> {
  const reservationParams = {
    propertyId: params?.propertyId,
    status: params?.status,
    pageSize: params?.pageSize ?? 100,
    pageNumber: params?.pageNumber ?? 1,
  };
  const key = `guests:${JSON.stringify(reservationParams)}`;
  return withCache(key, TTL.guests, async () => {
    const data = await fetchReservations(reservationParams);
    const seen = new Set<string>();
    const guests: ApaleoGuest[] = [];
    for (const r of data.reservations ?? []) {
      for (const g of [r.primaryGuest, r.booker]) {
        if (g && g.id && !seen.has(g.id)) {
          seen.add(g.id);
          guests.push(g);
        }
      }
    }
    return {
      guests,
      count: guests.length,
      derivedFrom: `reservations page ${reservationParams.pageNumber} (${data.reservations?.length ?? 0} records)`,
    };
  });
}

export async function fetchFolios(params?: {
  reservationId?: string;
  propertyId?: string;
  pageSize?: number;
  pageNumber?: number;
}): Promise<ApaleoFolioList> {
  const query: Record<string, string | number | boolean> = {
    pageSize: params?.pageSize ?? 100,
    pageNumber: params?.pageNumber ?? 1,
  };
  if (params?.reservationId) query["reservationId"] = params.reservationId;
  if (params?.propertyId) query["propertyId"] = params.propertyId;

  const key = `folios:${JSON.stringify(query)}`;
  return withCache(key, TTL.folios, () =>
    apaleoFetch<ApaleoFolioList>("/finance/v1/folios", query)
  );
}

export async function fetchRatePlans(params?: {
  propertyId?: string;
  unitGroupId?: string;
  channelCode?: string;
  isArchived?: boolean;
  pageSize?: number;
  pageNumber?: number;
}): Promise<ApaleoRatePlanList> {
  const query: Record<string, string | number | boolean> = {
    pageSize: params?.pageSize ?? 100,
    pageNumber: params?.pageNumber ?? 1,
  };
  if (params?.propertyId) query["propertyId"] = params.propertyId;
  if (params?.unitGroupId) query["unitGroupId"] = params.unitGroupId;
  if (params?.channelCode) query["channelCode"] = params.channelCode;
  if (params?.isArchived !== undefined)
    query["isArchived"] = params.isArchived;

  const key = `rate-plans:${JSON.stringify(query)}`;
  return withCache(key, TTL.ratePlans, () =>
    apaleoFetch<ApaleoRatePlanList>("/rateplan/v1/rate-plans", query)
  );
}

export async function fetchRevenueReport(params?: {
  propertyId?: string;
  from?: string;
  to?: string;
}): Promise<ApaleoRevenueReport> {
  const query: Record<string, string | number | boolean> = {};
  if (params?.propertyId) query["propertyId"] = params.propertyId;
  if (params?.from) query["from"] = params.from;
  if (params?.to) query["to"] = params.to;

  const key = `revenue-report:${JSON.stringify(query)}`;
  return withCache(key, TTL.revenueReport, () =>
    apaleoFetch<ApaleoRevenueReport>("/reports/v1/reports/revenue", query)
  );
}
