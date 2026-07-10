import { usePortalListJobs } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { CalendarClock, MapPin, Briefcase, Clock, CheckCircle2, FileText } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function Jobs() {
  const { data: jobs, isLoading } = usePortalListJobs();

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "scheduled": return <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"><CalendarClock className="w-3 h-3 mr-1"/> Scheduled</Badge>;
      case "in_progress": return <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"><Clock className="w-3 h-3 mr-1"/> In Progress</Badge>;
      case "completed": return <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"><CheckCircle2 className="w-3 h-3 mr-1"/> Completed</Badge>;
      case "cancelled": return <Badge variant="destructive">Cancelled</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const upcomingJobs = jobs?.filter(j => j.status === 'scheduled' || j.status === 'in_progress') || [];
  const pastJobs = jobs?.filter(j => j.status === 'completed' || j.status === 'cancelled') || [];

  const JobCard = ({ job }: { job: any }) => (
    <Card className="shadow-sm overflow-hidden group">
      <div className="h-2 w-full bg-secondary"></div>
      <CardContent className="p-6">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h3 className="text-xl font-bold text-foreground">{job.title}</h3>
              {getStatusBadge(job.status)}
            </div>
            {job.description && (
              <p className="text-sm text-muted-foreground mb-4">{job.description}</p>
            )}
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 gap-x-6">
              <div className="flex items-start gap-2">
                <CalendarClock className="w-4 h-4 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">SCHEDULED</p>
                  <p className="text-sm text-foreground">{formatDateTime(job.scheduledAt)}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <MapPin className="w-4 h-4 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">LOCATION</p>
                  <p className="text-sm text-foreground">{job.propertyAddress}</p>
                </div>
              </div>
              {job.completedAt && (
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">COMPLETED</p>
                    <p className="text-sm text-foreground">{formatDateTime(job.completedAt)}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
          
          <div className="md:text-right bg-muted/30 p-4 rounded-lg border border-border/50 min-w-[150px]">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">TOTAL</p>
            <p className="text-2xl font-bold text-foreground">
              {formatCurrency(job.totalAmount)}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Service History</h1>
        <p className="text-muted-foreground mt-1">View your scheduled and past appointments.</p>
      </div>

      <Tabs defaultValue="upcoming" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="upcoming">Upcoming & Active</TabsTrigger>
          <TabsTrigger value="past">Past Services</TabsTrigger>
        </TabsList>
        
        <TabsContent value="upcoming" className="mt-6 space-y-4">
          {isLoading ? (
            Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-xl" />)
          ) : upcomingJobs.length > 0 ? (
            upcomingJobs.map(job => <JobCard key={job.id} job={job} />)
          ) : (
            <Card className="border-dashed shadow-none bg-muted/20">
              <CardContent className="p-12 text-center">
                <Briefcase className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                <h3 className="text-lg font-medium text-foreground mb-2">No upcoming services</h3>
                <p className="text-muted-foreground">You don't have any jobs scheduled at the moment.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
        
        <TabsContent value="past" className="mt-6 space-y-4">
          {isLoading ? (
            Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-xl" />)
          ) : pastJobs.length > 0 ? (
            pastJobs.map(job => <JobCard key={job.id} job={job} />)
          ) : (
            <Card className="border-dashed shadow-none bg-muted/20">
              <CardContent className="p-12 text-center">
                <CheckCircle2 className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                <h3 className="text-lg font-medium text-foreground mb-2">No past services</h3>
                <p className="text-muted-foreground">You haven't had any services completed yet.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
