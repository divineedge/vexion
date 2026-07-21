import { usePortalListServiceRequests } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { formatDate } from "@/lib/format";
import {
  CalendarClock,
  CheckCircle2,
  Clock,
  ClipboardList,
  MapPin,
  Plus,
  Hourglass,
} from "lucide-react";

function getStatusBadge(status: string) {
  switch (status) {
    case "pending":
      return (
        <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
          <Hourglass className="w-3 h-3 mr-1" /> Pending Review
        </Badge>
      );
    case "scheduled":
      return (
        <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
          <CalendarClock className="w-3 h-3 mr-1" /> Scheduled
        </Badge>
      );
    case "in_progress":
      return (
        <Badge variant="secondary" className="bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300">
          <Clock className="w-3 h-3 mr-1" /> In Progress
        </Badge>
      );
    case "completed":
      return (
        <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
          <CheckCircle2 className="w-3 h-3 mr-1" /> Completed
        </Badge>
      );
    case "cancelled":
      return <Badge variant="destructive">Cancelled</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export default function MyRequests() {
  const { data: requests, isLoading } = usePortalListServiceRequests();

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-in fade-in duration-500">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">My Requests</h1>
          <p className="text-muted-foreground mt-1">
            Track the status of service requests you've submitted.
          </p>
        </div>
        <Link href="/service-requests">
          <Button className="shrink-0">
            <Plus className="w-4 h-4 mr-2" />
            New Request
          </Button>
        </Link>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="shadow-sm">
              <CardContent className="p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-6 w-24 rounded-full" />
                </div>
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : requests && requests.length > 0 ? (
        <div className="space-y-4">
          {requests.map((req) => (
            <Card key={req.id} className="shadow-sm hover:border-primary/30 transition-colors">
              <CardContent className="p-5 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <h3 className="font-semibold text-foreground">{req.title}</h3>
                  {getStatusBadge(req.status)}
                </div>

                {req.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2">{req.description}</p>
                )}

                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {req.propertyAddress && (
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {req.propertyAddress}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <CalendarClock className="w-3 h-3" />
                    {req.status === "completed" && req.completedAt
                      ? `Completed ${formatDate(req.completedAt)}`
                      : req.status === "scheduled"
                      ? `Scheduled for ${formatDate(req.scheduledAt)}`
                      : `Submitted ${formatDate(req.scheduledAt)}`}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="border-dashed shadow-none bg-muted/50">
          <CardContent className="p-12 text-center">
            <ClipboardList className="w-10 h-10 text-muted-foreground mx-auto mb-4 opacity-40" />
            <h3 className="font-medium text-foreground mb-1">No requests yet</h3>
            <p className="text-sm text-muted-foreground mb-5">
              Submit a service request and you'll see it tracked here.
            </p>
            <Link href="/service-requests">
              <Button variant="outline" size="sm">
                <Plus className="w-4 h-4 mr-2" />
                Submit a Request
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
