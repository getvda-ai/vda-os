import { useState, useEffect, useCallback } from "react";

const BASE = "/api";

export interface ApaleoProperty {
  id: string;
  code: string;
  name: { en: string; [lang: string]: string };
  location?: { addressLine1?: string; city?: string; countryCode?: string };
  timeZone?: string;
  unitCount?: number;
}

export interface ApaleoStats {
  propertyId: string;
  date: string;
  arrivalsToday: number;
  departuresToday: number;
  inHouseCount: number;
  openFolios: number;
  pendingMaintenance: number;
}

export interface ApaleoReservation {
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

async function apiFetch<T>(path: string): Promise<T> {
  const resp = await fetch(`${BASE}${path}`);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
    throw new Error(err.error || `HTTP ${resp.status}`);
  }
  return resp.json() as Promise<T>;
}

export function useApaleoProperties() {
  const [properties, setProperties] = useState<ApaleoProperty[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<ApaleoProperty[]>("/apaleo/properties");
      setProperties(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetch_(); }, [fetch_]);
  return { properties, loading, error, refetch: fetch_ };
}

export function useApaleoStats(propertyId: string | null) {
  const [stats, setStats] = useState<ApaleoStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<ApaleoStats>(`/apaleo/properties/${propertyId}/stats`);
      setStats(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => { fetch_(); }, [fetch_]);

  return { stats, loading, error, refetch: fetch_ };
}

export function useApaleoReservations(
  propertyId: string | null,
  options: { status?: string; pageSize?: number } = {}
) {
  const [reservations, setReservations] = useState<ApaleoReservation[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        propertyId,
        ...(options.status ? { status: options.status } : {}),
        pageSize: String(options.pageSize ?? 50),
      });
      const data = await apiFetch<{ reservations: ApaleoReservation[]; count: number }>(
        `/apaleo/reservations?${qs}`
      );
      setReservations(data.reservations);
      setCount(data.count);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [propertyId, options.status, options.pageSize]);

  useEffect(() => { fetch_(); }, [fetch_]);

  return { reservations, count, loading, error, refetch: fetch_ };
}

export function useApaleoProperty(propertyId: string | null) {
  const [property, setProperty] = useState<ApaleoProperty | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!propertyId) return;
    setLoading(true);
    apiFetch<ApaleoProperty>(`/apaleo/properties/${propertyId}`)
      .then(setProperty)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [propertyId]);

  return { property, loading, error };
}

export function guestDisplayName(r: ApaleoReservation): string {
  const g = r.primaryGuest;
  if (!g) return "Guest";
  const name = [g.firstName, g.lastName].filter(Boolean).join(" ");
  return name || "Guest";
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
