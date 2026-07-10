import { usePortalListProperties } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { MapPin, Home, Building2, TreeDeciduous } from "lucide-react";

export default function Properties() {
  const { data: properties, isLoading } = usePortalListProperties();

  const getPropertyIcon = (type?: string | null) => {
    switch (type?.toLowerCase()) {
      case "residential": return <Home className="w-6 h-6 text-primary" />;
      case "commercial": return <Building2 className="w-6 h-6 text-primary" />;
      default: return <TreeDeciduous className="w-6 h-6 text-primary" />;
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Service Locations</h1>
        <p className="text-muted-foreground mt-1">Properties we actively manage for you.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isLoading ? (
          Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-48 w-full rounded-xl" />)
        ) : properties && properties.length > 0 ? (
          properties.map(property => (
            <Card key={property.id} className="shadow-sm hover-elevate transition-all overflow-hidden border-border/50">
              <div className="h-24 bg-muted relative">
                {/* Fallback pattern for map/property image */}
                <div className="absolute inset-0 opacity-[0.03] bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-foreground to-transparent bg-[length:16px_16px]"></div>
                <div className="absolute -bottom-6 left-6 p-3 bg-card border rounded-xl shadow-sm">
                  {getPropertyIcon(property.type)}
                </div>
              </div>
              <CardHeader className="pt-10 pb-4">
                <CardTitle className="text-lg line-clamp-1">{property.address}</CardTitle>
                <CardDescription className="flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5" />
                  {[property.city, property.state, property.zip].filter(Boolean).join(', ')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2 mt-2">
                  <Badge variant="secondary" className="bg-secondary/50">
                    {property.type || "Standard"} Property
                  </Badge>
                </div>
                {property.notes && (
                  <p className="text-sm text-muted-foreground mt-4 line-clamp-2">
                    <span className="font-medium block text-foreground mb-1">Notes:</span>
                    {property.notes}
                  </p>
                )}
              </CardContent>
            </Card>
          ))
        ) : (
          <div className="col-span-full">
            <Card className="border-dashed shadow-none bg-muted/20">
              <CardContent className="p-12 text-center">
                <MapPin className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                <h3 className="text-lg font-medium text-foreground mb-2">No properties found</h3>
                <p className="text-muted-foreground">There are no service locations associated with your account.</p>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
