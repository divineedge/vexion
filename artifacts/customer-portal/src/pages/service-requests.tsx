import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { usePortalListProperties, usePortalCreateServiceRequest, usePortalListJobs } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Send, Calendar as CalendarIcon, MapPin, Sparkles, Clock, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";

const requestSchema = z.object({
  propertyId: z.coerce.number<number>({
    error: "Please select a property",
  }).min(1, "Please select a property"),
  description: z.string().min(10, "Please provide more details about what you need done."),
  preferredDateStart: z.string().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
});

import React, { useState } from "react";

export default function ServiceRequests() {
  const [, setLocation] = useLocation();
  const { data: properties, isLoading: isLoadingProperties } = usePortalListProperties();
  const createRequest = usePortalCreateServiceRequest();
  const { data: allJobs } = usePortalListJobs();
  const openRequests = allJobs?.filter(j => j.status !== 'completed' && j.status !== 'cancelled') ?? [];
  const [requestSearch, setRequestSearch] = useState('');

  const form = useForm<z.infer<typeof requestSchema>>({
    resolver: zodResolver(requestSchema),
    defaultValues: {
      description: "",
      preferredDateStart: "",
    },
  });

  const onSubmit = (values: z.infer<typeof requestSchema>) => {
    createRequest.mutate(
      { data: values },
      {
        onSuccess: () => {
          toast.success("Request submitted successfully!", {
            description: "Our team will review it and get back to you shortly."
          });
          setLocation("/home");
        },
        onError: () => {
          toast.error("Failed to submit request.", {
            description: "Please try again or contact support."
          });
        }
      }
    );
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Request Service</h1>
        <p className="text-muted-foreground mt-1">Let us know what you need and we'll schedule a visit or provide a quote.</p>
      </div>

      {openRequests.length > 0 && (
        <div className="rounded-xl border bg-muted/30 p-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold text-foreground flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" /> Active Requests
            </h2>
            {openRequests.length > 3 && (
              <div className="flex-1 max-w-xs">
                <Input placeholder="Search…" value={requestSearch} onChange={e => setRequestSearch(e.target.value)} className="h-8 text-sm" />
              </div>
            )}
          </div>
          <div className="divide-y rounded-lg border bg-background overflow-hidden">
            {openRequests.filter(j => !requestSearch || j.title.toLowerCase().includes(requestSearch.toLowerCase()) || j.status.includes(requestSearch.toLowerCase())).map(j => (
              <div key={j.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{j.title}</p>
                  {j.scheduledAt && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      <CalendarIcon className="w-3 h-3" />{formatDate(j.scheduledAt)}
                    </p>
                  )}
                </div>
                <Badge variant="secondary" className="capitalize shrink-0">{j.status.replace('_', ' ')}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      <Card className="shadow-lg border-border/50">
        <div className="h-2 w-full bg-primary rounded-t-xl"></div>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            New Request
          </CardTitle>
          <CardDescription>Fill out the details below and our team will get in touch.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="propertyId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Service Location</FormLabel>
                    <Select 
                      disabled={isLoadingProperties || properties?.length === 0}
                      onValueChange={field.onChange} 
                      defaultValue={field.value?.toString()}
                    >
                      <FormControl>
                        <SelectTrigger className="h-12">
                          <div className="flex items-center gap-2">
                            <MapPin className="w-4 h-4 text-muted-foreground" />
                            <SelectValue placeholder="Select a property" />
                          </div>
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {properties?.map((property) => (
                          <SelectItem key={property.id} value={property.id.toString()}>
                            {property.address}{property.city ? `, ${property.city}` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {properties?.length === 0 && (
                      <p className="text-xs text-destructive mt-1">No properties found on your account. Please contact support.</p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>What do you need done?</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="e.g. The sprinkler head in the front yard is broken and needs replacement. Also interested in a quote for fall cleanup." 
                        className="min-h-[120px] resize-none"
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="priority"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Priority (Optional)</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger className="h-12">
                          <SelectValue placeholder="How urgent is this?" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="low">Low — no rush</SelectItem>
                        <SelectItem value="normal">Normal — within a few weeks</SelectItem>
                        <SelectItem value="high">High — within the week</SelectItem>
                        <SelectItem value="urgent">Urgent — as soon as possible</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="preferredDateStart"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Preferred Date (Optional)</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <CalendarIcon className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
                        <Input 
                          type="date" 
                          className="pl-10 h-12"
                          {...field} 
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="pt-4 border-t border-border/50">
                <Button 
                  type="submit" 
                  className="w-full h-12 text-md"
                  disabled={createRequest.isPending || properties?.length === 0}
                >
                  {createRequest.isPending ? "Submitting..." : "Submit Request"}
                  {!createRequest.isPending && <Send className="ml-2 w-4 h-4" />}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
