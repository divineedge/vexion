import { usePortalGetSummary, usePortalListJobs, usePortalListInvoices, PortalJob, PortalInvoice } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatDate } from "@/lib/format";
import { ArrowRight, Bell, CalendarClock, Briefcase, FileText, MapPin, CheckCircle2, Clock } from "lucide-react";

export default function Home() {
  const { data: summary, isLoading: isSummaryLoading } = usePortalGetSummary();
  const { data: jobs, isLoading: isJobsLoading } = usePortalListJobs();
  const { data: invoices, isLoading: isInvoicesLoading } = usePortalListInvoices();

  const getJobStatusBadge = (status: string) => {
    switch (status) {
      case "scheduled": return <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"><CalendarClock className="w-3 h-3 mr-1"/> Scheduled</Badge>;
      case "in_progress": return <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"><Clock className="w-3 h-3 mr-1"/> In Progress</Badge>;
      case "completed": return <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"><CheckCircle2 className="w-3 h-3 mr-1"/> Completed</Badge>;
      case "cancelled": return <Badge variant="destructive">Cancelled</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getInvoiceStatusBadge = (status: string) => {
    switch (status) {
      case "draft": return <Badge variant="outline">Draft</Badge>;
      case "sent": return <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">Pending</Badge>;
      case "paid": return <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"><CheckCircle2 className="w-3 h-3 mr-1"/> Paid</Badge>;
      case "overdue": return <Badge variant="destructive">Overdue</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const upcomingJobs = jobs?.filter(j => j.status === 'scheduled' || j.status === 'in_progress').slice(0, 3) || [];
  const recentInvoices = invoices?.slice(0, 3) || [];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Welcome back</h1>
          <p className="text-muted-foreground mt-1">Here's a summary of your properties and upcoming services.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/service-requests" className="w-full sm:w-auto">
            <Button className="w-full sm:w-auto shadow-sm">
              Request Service
            </Button>
          </Link>
        </div>
      </div>

      {summary?.unreadAlertCount ? (
        <Card className="border-destructive/20 bg-destructive/5 shadow-sm">
          <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-destructive/10 rounded-full text-destructive">
                <Bell className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Action Required</h3>
                <p className="text-sm text-muted-foreground">You have {summary.unreadAlertCount} unread alert{summary.unreadAlertCount > 1 ? 's' : ''} from our technicians.</p>
              </div>
            </div>
            <Link href="/alerts">
              <Button variant="outline" className="border-destructive/20 hover:bg-destructive/10">
                View Alerts
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Card className="shadow-sm hover-elevate transition-all">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-medium flex items-center gap-2 text-muted-foreground">
              <Briefcase className="w-4 h-4" />
              Upcoming Jobs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-foreground">
              {isSummaryLoading ? <Skeleton className="h-10 w-16" /> : summary?.upcomingJobs?.length ?? 0}
            </div>
          </CardContent>
        </Card>
        
        <Card className="shadow-sm hover-elevate transition-all">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-medium flex items-center gap-2 text-muted-foreground">
              <FileText className="w-4 h-4" />
              Pending Invoices
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-foreground">
              {isSummaryLoading ? <Skeleton className="h-10 w-16" /> : invoices?.filter(i => i.status === 'sent' || i.status === 'overdue').length || 0}
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm hover-elevate transition-all">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-medium flex items-center gap-2 text-muted-foreground">
              <MapPin className="w-4 h-4" />
              Properties
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-foreground">
              {/* Note: summary doesn't have property count, we would need to fetch properties or rely on what's available. For now, hardcode or show something else */}
              <Link href="/properties" className="text-primary hover:underline text-sm font-normal">View your properties</Link>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Upcoming Jobs List */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold tracking-tight">Next Appointments</h2>
            <Link href="/jobs" className="text-sm font-medium text-primary hover:underline flex items-center gap-1">
              View All <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          
          <div className="space-y-4">
            {isJobsLoading ? (
              Array(2).fill(0).map((_, i) => (
                <Card key={i} className="shadow-sm">
                  <CardContent className="p-5 flex gap-4 items-center">
                    <Skeleton className="w-12 h-12 rounded-lg" />
                    <div className="space-y-2 flex-1">
                      <Skeleton className="h-5 w-1/2" />
                      <Skeleton className="h-4 w-3/4" />
                    </div>
                  </CardContent>
                </Card>
              ))
            ) : upcomingJobs.length > 0 ? (
              upcomingJobs.map((job) => (
                <Card key={job.id} className="shadow-sm hover:border-primary/30 transition-colors">
                  <CardContent className="p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <h3 className="font-semibold text-foreground">{job.title}</h3>
                        {getJobStatusBadge(job.status)}
                      </div>
                      <div className="flex items-center text-sm text-muted-foreground gap-1 mb-1">
                        <CalendarClock className="w-3.5 h-3.5" />
                        <span>{formatDate(job.scheduledAt)}</span>
                      </div>
                      <div className="flex items-center text-sm text-muted-foreground gap-1">
                        <MapPin className="w-3.5 h-3.5" />
                        <span className="truncate">{job.propertyAddress}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            ) : (
              <Card className="border-dashed shadow-none bg-muted/50">
                <CardContent className="p-8 text-center">
                  <Briefcase className="w-8 h-8 text-muted-foreground mx-auto mb-3 opacity-50" />
                  <h3 className="font-medium text-foreground mb-1">No upcoming appointments</h3>
                  <p className="text-sm text-muted-foreground mb-4">You have no scheduled services at the moment.</p>
                  <Link href="/service-requests">
                    <Button variant="outline" size="sm">Request a Service</Button>
                  </Link>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Recent Invoices List */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold tracking-tight">Recent Invoices</h2>
            <Link href="/invoices" className="text-sm font-medium text-primary hover:underline flex items-center gap-1">
              View All <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          
          <div className="space-y-4">
            {isInvoicesLoading ? (
              Array(2).fill(0).map((_, i) => (
                <Card key={i} className="shadow-sm">
                  <CardContent className="p-5 flex gap-4 items-center">
                    <Skeleton className="w-10 h-10 rounded-full" />
                    <div className="space-y-2 flex-1">
                      <Skeleton className="h-5 w-1/3" />
                      <Skeleton className="h-4 w-1/4" />
                    </div>
                  </CardContent>
                </Card>
              ))
            ) : recentInvoices.length > 0 ? (
              recentInvoices.map((invoice) => (
                <Card key={invoice.id} className="shadow-sm hover:border-primary/30 transition-colors">
                  <CardContent className="p-5 flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-foreground flex items-center gap-2">
                        {invoice.invoiceNumber}
                        {getInvoiceStatusBadge(invoice.status)}
                      </h3>
                      <p className="text-sm text-muted-foreground mt-1">
                        Due {formatDate(invoice.dueDate)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-lg text-foreground">{formatCurrency(invoice.total)}</p>
                      {invoice.status === 'sent' || invoice.status === 'overdue' ? (
                        <Button size="sm" className="mt-2 h-8">Pay Now</Button>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              ))
            ) : (
              <Card className="border-dashed shadow-none bg-muted/50">
                <CardContent className="p-8 text-center">
                  <FileText className="w-8 h-8 text-muted-foreground mx-auto mb-3 opacity-50" />
                  <h3 className="font-medium text-foreground mb-1">No invoices found</h3>
                  <p className="text-sm text-muted-foreground">You don't have any recent invoices to display.</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
