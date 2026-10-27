import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListReviewRequests, getListReviewRequestsQueryKey,
  useGetReviewsSummary, getGetReviewsSummaryQueryKey,
  useUpdateReviewRequest,
} from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { Star, MessageSquare, TrendingUp, Users, AlertTriangle } from 'lucide-react';
import { AuthedImage } from '@/components/experience/ImagePicker';
import { format } from 'date-fns';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

type ReviewStatus = 'new' | 'reviewed' | 'action_taken' | 'resolved';

const REVIEW_STATUS_COLORS: Record<ReviewStatus, string> = {
  new: 'bg-blue-50 text-blue-700 border-blue-200',
  reviewed: 'bg-amber-50 text-amber-700 border-amber-200',
  action_taken: 'bg-orange-50 text-orange-700 border-orange-200',
  resolved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

function StarDisplay({ rating }: { rating: number | null }) {
  if (rating === null) return <span className="text-muted-foreground text-sm italic">Pending</span>;
  return (
    <span className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(s => (
        <Star
          key={s}
          className={`w-3.5 h-3.5 ${s <= rating ? 'text-amber-400 fill-amber-400' : 'text-muted-foreground/30'}`}
        />
      ))}
    </span>
  );
}

export default function ReviewsPage() {
  const qc = useQueryClient();
  const [filterStatus, setFilterStatus] = useState<string>('__all__');
  const [filterRating, setFilterRating] = useState<string>('__all__');

  // Dialog state for updating a review
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editStatus, setEditStatus] = useState<ReviewStatus>('new');
  const [editNote, setEditNote] = useState('');

  const listParams = {
    ...(filterStatus !== '__all__' ? { status: filterStatus as ReviewStatus } : {}),
    ...(filterRating !== '__all__' ? { rating: parseInt(filterRating, 10) } : {}),
  };

  const { data: reviews, isLoading } = useListReviewRequests(
    Object.keys(listParams).length ? listParams : undefined,
    { query: { queryKey: getListReviewRequestsQueryKey(Object.keys(listParams).length ? listParams : undefined) } },
  );

  const { data: summary } = useGetReviewsSummary({
    query: { queryKey: getGetReviewsSummaryQueryKey() },
  });

  const updateMutation = useUpdateReviewRequest({
    mutation: {
      onSuccess: () => {
        toast.success('Review updated');
        qc.invalidateQueries({ queryKey: ['/api/reviews'] });
        qc.invalidateQueries({ queryKey: ['/api/reviews/summary'] });
        setDialogOpen(false);
        setSelectedId(null);
        setEditNote('');
      },
      onError: () => toast.error('Failed to update review'),
    },
  });

  function openDialog(id: number, currentStatus: ReviewStatus, currentNote: string | null) {
    setSelectedId(id);
    setEditStatus(currentStatus);
    setEditNote(currentNote ?? '');
    setDialogOpen(true);
  }

  function handleUpdate() {
    if (!selectedId) return;
    updateMutation.mutate({ id: selectedId, data: { reviewStatus: editStatus, reviewNote: editNote || undefined } });
  }

  const trendData = (summary?.trend ?? []).map(t => ({
    period: t.period,
    rating: typeof t.averageRating === 'number' ? parseFloat(t.averageRating.toFixed(2)) : null,
  }));

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Reviews</h1>
        <p className="text-muted-foreground mt-1">Customer satisfaction — track ratings, feedback, and follow-up actions.</p>
      </div>

      {(() => {
        const low = (reviews ?? []).filter(r => r.rating != null && r.rating <= 3 && (r.reviewStatus ?? 'new') === 'new');
        if (low.length === 0) return null;
        return (
          <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900" data-testid="alert-low-ratings">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="flex-1">
              <p className="font-semibold">{low.length} low rating{low.length === 1 ? '' : 's'} need acknowledgement</p>
              <p className="text-xs">Open each one, mark it reviewed, and add a note on how the issue was handled. These stay private to your business.</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => openDialog(low[0].id, (low[0].reviewStatus ?? 'new') as ReviewStatus, low[0].reviewNote ?? null)} data-testid="button-acknowledge-low">Acknowledge</Button>
          </div>
        );
      })()}

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
              <Star className="w-5 h-5 fill-amber-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">{summary?.averageRating != null ? Number(summary.averageRating).toFixed(1) : '—'}</p>
              <p className="text-xs text-muted-foreground">Average Rating</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <p className="text-2xl font-bold">{summary?.totalResponses ?? '—'}</p>
              <p className="text-xs text-muted-foreground">Total Responses</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground mb-1">Rating Trend</p>
              {trendData.length > 1 ? (
                <ResponsiveContainer width="100%" height={36}>
                  <LineChart data={trendData} margin={{ top: 2, right: 2, left: -30, bottom: 2 }}>
                    <Line type="monotone" dataKey="rating" stroke="#10B981" dot={false} strokeWidth={2} />
                    <YAxis domain={[1, 5]} hide />
                    <Tooltip formatter={(v: number) => [v.toFixed(1), 'Avg Rating']} labelFormatter={l => String(l)} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-muted-foreground">Not enough data</p>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
              <MessageSquare className="w-3.5 h-3.5" /> Top Issues
            </p>
            {(summary?.topChecklistIssues ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No issues recorded</p>
            ) : (
              <ul className="space-y-1">
                {(summary?.topChecklistIssues ?? []).slice(0, 4).map(issue => (
                  <li key={issue.label} className="flex items-center justify-between text-xs">
                    <span className="truncate mr-2">{issue.label}</span>
                    <Badge variant="outline" className="text-xs shrink-0">{issue.count}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Rating distribution */}
      {summary?.distribution && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Rating Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {[5, 4, 3, 2, 1].map(star => {
                const count = (summary.distribution as Record<string, number>)[String(star)] ?? 0;
                const total = summary.totalResponses || 1;
                const pct = Math.round((count / total) * 100);
                return (
                  <div key={star} className="flex items-center gap-2 text-xs">
                    <span className="w-6 text-right shrink-0">{star}★</span>
                    <div className="flex-1 bg-muted rounded-full h-2">
                      <div
                        className="bg-amber-400 h-2 rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-8 text-right text-muted-foreground shrink-0">{count}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters + list */}
      <Card>
        <CardContent className="p-0">
          <div className="p-4 border-b flex items-center gap-3 flex-wrap">
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All statuses</SelectItem>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="reviewed">Reviewed</SelectItem>
                <SelectItem value="action_taken">Action Taken</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterRating} onValueChange={setFilterRating}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All ratings</SelectItem>
                <SelectItem value="5">5 stars</SelectItem>
                <SelectItem value="4">4 stars</SelectItem>
                <SelectItem value="3">3 stars</SelectItem>
                <SelectItem value="2">2 stars</SelectItem>
                <SelectItem value="1">1 star</SelectItem>
              </SelectContent>
            </Select>
            {(filterStatus !== '__all__' || filterRating !== '__all__') && (
              <Button variant="ghost" size="sm" onClick={() => { setFilterStatus('__all__'); setFilterRating('__all__'); }}>
                Clear filters
              </Button>
            )}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Rating</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Sent</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Photos</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Loading...</TableCell>
                </TableRow>
              ) : (reviews ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    <Star className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No reviews found.
                  </TableCell>
                </TableRow>
              ) : (
                (reviews ?? []).map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.customerName}</TableCell>
                    <TableCell><StarDisplay rating={r.rating ?? null} /></TableCell>
                    <TableCell className="capitalize text-sm text-muted-foreground">{r.channel}</TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {r.sentAt ? format(new Date(r.sentAt), 'MMM d, yyyy') : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={REVIEW_STATUS_COLORS[(r.reviewStatus ?? 'new') as ReviewStatus] ?? ''}>
                        {(r.reviewStatus ?? 'new').replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {((r as { photos?: { id: string; name: string }[] }).photos ?? []).slice(0, 3).map(ph => (
                          <AuthedImage key={ph.id} url={`/api/reviews/${r.id}/photos/${encodeURIComponent(ph.id)}`} alt={ph.name} className="h-9 w-9 rounded border" />
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => openDialog(r.id, r.reviewStatus as ReviewStatus, r.reviewNote ?? null)}
                      >
                        Update
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Update dialog */}
      <Dialog open={dialogOpen} onOpenChange={open => { if (!open) { setDialogOpen(false); setSelectedId(null); setEditNote(''); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Update Review Status</DialogTitle>
            <DialogDescription>Change the workflow status and add an internal note for this review.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Status</label>
              <Select value={editStatus} onValueChange={v => setEditStatus(v as ReviewStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">New</SelectItem>
                  <SelectItem value="reviewed">Reviewed</SelectItem>
                  <SelectItem value="action_taken">Action Taken</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Internal Note (optional)</label>
              <Textarea
                placeholder="e.g. 'Called customer, issue resolved — crew retrained'"
                rows={3}
                value={editNote}
                onChange={e => setEditNote(e.target.value)}
              />
            </div>
          </div>
          <Separator />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleUpdate} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
