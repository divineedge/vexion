import { useState } from "react";
import { usePortalListAlerts, usePortalRespondToAlert } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { formatDate } from "@/lib/format";
import { Bell, AlertTriangle, TrendingUp, CheckCircle2, XCircle, ArrowRight } from "lucide-react";

export default function Alerts() {
  const queryClient = useQueryClient();
  const { data: alerts, isLoading } = usePortalListAlerts();
  const respondMutation = usePortalRespondToAlert();
  
  const [responseNotes, setResponseNotes] = useState<Record<number, string>>({});

  const handleRespond = (id: number, action: 'accept' | 'decline') => {
    respondMutation.mutate(
      { 
        id, 
        data: { 
          action, 
          customerResponse: responseNotes[id] 
        } 
      },
      {
        onSuccess: () => {
          toast.success(action === 'accept' ? 'Alert accepted' : 'Alert declined');
          // Invalidate alerts and summary to update badges
          queryClient.invalidateQueries({ queryKey: ["usePortalListAlerts"] });
          queryClient.invalidateQueries({ queryKey: ["usePortalGetSummary"] });
        },
        onError: () => {
          toast.error("Failed to update response. Please try again.");
        }
      }
    );
  };

  const getAlertIcon = (type: string) => {
    if (type === 'issue') return <AlertTriangle className="w-5 h-5 text-amber-500" />;
    if (type === 'upsell') return <TrendingUp className="w-5 h-5 text-blue-500" />;
    return <Bell className="w-5 h-5 text-primary" />;
  };

  const pendingAlerts = alerts?.filter(a => a.status === 'pending') || [];
  const pastAlerts = alerts?.filter(a => a.status !== 'pending') || [];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Technician Alerts</h1>
        <p className="text-muted-foreground mt-1">Recommendations and notes left by our team during service visits.</p>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold border-b pb-2">Requires Your Attention</h2>
        {isLoading ? (
          Array(2).fill(0).map((_, i) => <Skeleton key={i} className="h-48 w-full rounded-xl" />)
        ) : pendingAlerts.length > 0 ? (
          pendingAlerts.map(alert => (
            <Card key={alert.id} className="shadow-sm border-l-4 border-l-amber-500">
              <CardContent className="p-6">
                <div className="flex gap-4">
                  <div className="mt-1 bg-amber-100 dark:bg-amber-900/30 p-2 rounded-full h-fit">
                    {getAlertIcon(alert.type)}
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="uppercase tracking-wider text-[10px]">
                            {alert.type}
                          </Badge>
                          <span className="text-xs text-muted-foreground">{formatDate(alert.createdAt)}</span>
                        </div>
                        <h3 className="text-lg font-bold text-foreground">Regarding: {alert.jobTitle}</h3>
                      </div>
                    </div>
                    
                    <div className="bg-muted/50 p-4 rounded-lg my-4 text-foreground text-sm border border-border/50 leading-relaxed">
                      {alert.message}
                    </div>

                    <div className="space-y-3 mt-4">
                      <p className="text-sm font-medium text-foreground">Optional Response Note:</p>
                      <Textarea 
                        placeholder="Add any instructions or questions for our team..."
                        value={responseNotes[alert.id] || ""}
                        onChange={(e) => setResponseNotes({...responseNotes, [alert.id]: e.target.value})}
                        className="resize-none h-20"
                      />
                      
                      <div className="flex flex-wrap gap-3 pt-2">
                        <Button 
                          onClick={() => handleRespond(alert.id, 'accept')}
                          disabled={respondMutation.isPending}
                          className="bg-green-600 hover:bg-green-700 text-white"
                        >
                          <CheckCircle2 className="w-4 h-4 mr-2" /> Approve Recommendation
                        </Button>
                        <Button 
                          variant="outline"
                          onClick={() => handleRespond(alert.id, 'decline')}
                          disabled={respondMutation.isPending}
                          className="text-muted-foreground"
                        >
                          <XCircle className="w-4 h-4 mr-2" /> Decline
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <Card className="border-dashed shadow-none bg-muted/20">
            <CardContent className="p-8 text-center">
              <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 text-green-600 rounded-full flex items-center justify-center mx-auto mb-3">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <p className="font-medium text-foreground">You're all caught up!</p>
              <p className="text-sm text-muted-foreground mt-1">No pending alerts require your attention.</p>
            </CardContent>
          </Card>
        )}
      </div>

      {pastAlerts.length > 0 && (
        <div className="space-y-4 pt-8">
          <h2 className="text-xl font-semibold border-b pb-2">Past Responses</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {pastAlerts.map(alert => (
              <Card key={alert.id} className="bg-muted/10 border-border/50 shadow-none">
                <CardContent className="p-5">
                  <div className="flex justify-between items-start mb-3">
                    <Badge variant={alert.status === 'accepted' ? 'secondary' : 'outline'} className={
                      alert.status === 'accepted' 
                        ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' 
                        : ''
                    }>
                      {alert.status === 'accepted' ? 'Approved' : 'Declined'}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{formatDate(alert.createdAt)}</span>
                  </div>
                  <h4 className="font-medium text-sm mb-2">Job: {alert.jobTitle}</h4>
                  <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{alert.message}</p>
                  
                  {alert.customerResponse && (
                    <div className="mt-3 pt-3 border-t border-border/50">
                      <p className="text-xs font-medium text-muted-foreground mb-1">Your Note:</p>
                      <p className="text-sm italic">"{alert.customerResponse}"</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
