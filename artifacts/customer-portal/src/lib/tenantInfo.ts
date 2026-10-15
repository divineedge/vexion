import { useQuery } from "@tanstack/react-query";

export interface PortalTenantInfo {
  tenantId: number; slug: string | null; name: string; logoUrl: string | null;
  /** Missing on older servers: treat as allowed (backward compatible). */
  portalShowMeasurements?: boolean;
  customerReferralsEnabled?: boolean;
}

/** Shared tenant-info query. Same key as the app shell so it is fetched once per token. */
export function usePortalTenantInfo() {
  const token = typeof window !== "undefined" ? localStorage.getItem("portal_token") : null;
  return useQuery<PortalTenantInfo>({
    queryKey: ["portalBusiness", token],
    enabled: !!token,
    queryFn: async () => {
      const response = await fetch("/api/portal/tenant-info", { headers: { "x-portal-token": token! } });
      if (!response.ok) throw new Error("Cannot verify portal business");
      return response.json();
    },
  });
}
