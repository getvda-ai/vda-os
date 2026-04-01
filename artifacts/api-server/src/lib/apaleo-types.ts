export interface ApaleoProperty {
  id: string;
  code: string;
  name: string;
  description?: string;
  currencyCode: string;
  location?: {
    addressLine1?: string;
    addressLine2?: string;
    postalCode?: string;
    city?: string;
    countryCode?: string;
    latitude?: number;
    longitude?: number;
  };
  timeZone?: string;
  created?: string;
  modified?: string;
}

export interface ApaleoPropertyList {
  properties: ApaleoProperty[];
  count: number;
}

export type ReservationStatus =
  | "Confirmed"
  | "InHouse"
  | "CheckedOut"
  | "Canceled"
  | "NoShow"
  | "Waitlisted";

export interface ApaleoGuest {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  title?: string;
  gender?: string;
  nationality?: string;
  birthDate?: string;
  address?: {
    addressLine1?: string;
    addressLine2?: string;
    postalCode?: string;
    city?: string;
    countryCode?: string;
  };
}

export interface ApaleoReservation {
  id: string;
  status: ReservationStatus;
  propertyId: string;
  arrival: string;
  departure: string;
  created?: string;
  modified?: string;
  adults?: number;
  childrenAges?: number[];
  primaryGuest?: ApaleoGuest;
  booker?: ApaleoGuest;
  ratePlanId?: string;
  unitGroupId?: string;
  unitId?: string;
  totalGrossAmount?: {
    amount: number;
    currency: string;
  };
  balance?: {
    amount: number;
    currency: string;
  };
  channelCode?: string;
  source?: string;
  groupId?: string;
  bookingId?: string;
}

export interface ApaleoReservationList {
  reservations: ApaleoReservation[];
  count: number;
}

export interface ApaleoFolioCharge {
  id?: string;
  name?: string;
  amount: {
    grossAmount: number;
    netAmount?: number;
    vatType?: string;
    vatPercent?: number;
    currency: string;
  };
  quantity?: number;
  serviceDate?: string;
  transactionDate?: string;
  receipt?: string;
}

export interface ApaleoFolio {
  id: string;
  status?: string;
  propertyId?: string;
  reservationId?: string;
  guestId?: string;
  created?: string;
  modified?: string;
  totalAmount?: {
    amount: number;
    currency: string;
  };
  outstandingAmount?: {
    amount: number;
    currency: string;
  };
  charges?: ApaleoFolioCharge[];
  allowances?: ApaleoFolioCharge[];
  payments?: ApaleoFolioCharge[];
}

export interface ApaleoFolioList {
  folios: ApaleoFolio[];
  count: number;
}

export interface ApaleoRatePlan {
  id: string;
  code: string;
  name: string;
  description?: string;
  propertyId?: string;
  unitGroupId?: string;
  isArchived?: boolean;
  priceCalculationMode?: string;
  channelCodes?: string[];
  restrictions?: {
    minLengthOfStay?: number;
    maxLengthOfStay?: number;
    minAdvanceBookingOffset?: string;
    maxAdvanceBookingOffset?: string;
    closed?: boolean;
    closedOnArrival?: boolean;
    closedOnDeparture?: boolean;
  };
  created?: string;
  modified?: string;
}

export interface ApaleoRatePlanList {
  ratePlans: ApaleoRatePlan[];
  count: number;
}

export interface ApaleoRevenueReport {
  property?: string;
  fromDate?: string;
  toDate?: string;
  rows?: Array<{
    date?: string;
    category?: string;
    amount?: {
      grossAmount: number;
      netAmount?: number;
      currency: string;
    };
    count?: number;
  }>;
  totalGrossRevenue?: {
    amount: number;
    currency: string;
  };
}

export interface ApaleoTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

export interface ApaleoConnectionStatus {
  connected: boolean;
  propertiesReachable?: string[];
  propertyCount?: number;
  error?: string;
  tokenExpiry?: string;
  mcpConfigured?: boolean;
}
