import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { CloudRain } from 'lucide-react';
import { toast } from 'sonner';

type Risk = { date: string; count: number; jobs: Array<{ id: number; title: string; probability: number }> };

function nextClearDay(date: string): string {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

export function RainRiskBanner({ date, enabled }: { date: string; enabled: boolean }) {
  const qc = useQueryClient();
  const [moved, setMoved] = useState(false);
  const query = useQuery({
    queryKey: ['rain-risk', date],
    enabled,
    queryFn: () => customFetch<Risk>(`/api/schedule/rain-risk?date=${date}`),
  });
  const reschedule = useMutation({
    mutationFn: (jobIds: number[]) => customFetch<{ moved: number[] }>('/api/schedule/rain-risk/reschedule', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobIds, toDate: nextClearDay(date) }),
    }),
    onSuccess: (result) => {
      setMoved(true);
      qc.invalidateQueries({ queryKey: ['rain-risk', date] });
      toast.success(`Moved ${result.moved.length} chemical ${result.moved.length === 1 ? 'job' : 'jobs'} to the next day`);
    },
    onError: () => toast.error('Those jobs were not moved'),
  });
  const jobs = query.data?.jobs ?? [];
  if (!enabled || jobs.length === 0 || moved) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-sky-300 bg-sky-50 px-4 py-3 text-sm" data-testid="banner-rain-risk">
      <p className="flex items-center gap-2"><CloudRain className="h-4 w-4" /> Warning: {jobs.length} chemical application {jobs.length === 1 ? 'service' : 'services'} scheduled today {jobs.length === 1 ? 'has' : 'have'} a high probability of rain.</p>
      <Button size="sm" variant="outline" disabled={reschedule.isPending} onClick={() => reschedule.mutate(jobs.map(job => job.id))}>Move to next day</Button>
    </div>
  );
}

export function useRainRiskJobIds(date: string, enabled: boolean): Set<number> {
  const query = useQuery({
    queryKey: ['rain-risk', date],
    enabled,
    queryFn: () => customFetch<Risk>(`/api/schedule/rain-risk?date=${date}`),
  });
  return new Set((query.data?.jobs ?? []).map(job => job.id));
}
