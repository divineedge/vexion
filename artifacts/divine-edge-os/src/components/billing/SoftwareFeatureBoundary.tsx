import type { ReactNode } from "react";
import { Link,useLocation } from "wouter";
import { useGetSoftwareFeatures,getGetSoftwareFeaturesQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";
import { Card,CardContent,CardHeader,CardTitle } from "@/components/ui/card";

/** Presentation only; the private API independently enforces the price policy. */
export function SoftwareFeatureBoundary({children}:{children:ReactNode}){
  const {user,isOwner}=useAuth();
  const [path]=useLocation();
  const query=useGetSoftwareFeatures({query:{
    queryKey:[...getGetSoftwareFeaturesQueryKey(),{tenantId:user?.tenantId}],
    enabled:!!user,staleTime:60000,refetchInterval:60000,retry:1,
  }});
  // Do not make unrelated core screens unavailable on a status-request failure.
  // An unavailable status endpoint never bypasses the server-side module guard.
  if(!query.data || query.data.featureKeys===null)return <>{children}</>;
  const feature=query.data.featureCatalog.find(feature=>feature.appPaths.some(prefix=>path===prefix || path.startsWith(prefix+"/")));
  if(!feature || query.data.featureKeys.includes(feature.key))return <>{children}</>;
  return <div className="p-6 max-w-2xl mx-auto" data-testid="software-feature-locked">
    <Card><CardHeader><CardTitle>{feature.label} is not included</CardTitle></CardHeader>
      <CardContent className="space-y-3"><p className="text-sm text-muted-foreground">This business's current software subscription does not include this feature. Your existing records have not been deleted.</p>
        {isOwner?<Link href="/software-billing" className="text-primary underline">Review software plans</Link>:<p className="text-sm">Ask your business owner about changing the software plan.</p>}
      </CardContent>
    </Card>
  </div>;
}
