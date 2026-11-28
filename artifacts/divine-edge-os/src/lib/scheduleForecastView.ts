import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { toast } from 'sonner';

export type ScheduleForecastView = {
  startHour: number;
  endHour: number;
  hourlyMinimized: boolean;
  minimizedDays: string[];
};

export const DEFAULT_FORECAST_VIEW: ScheduleForecastView = {
  startHour: 0,
  endHour: 23,
  hourlyMinimized: false,
  minimizedDays: [],
};

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeForecastView(input: unknown): ScheduleForecastView | null {
  if (!input || typeof input !== 'object') return null;
  const body = input as { startHour?: unknown; endHour?: unknown; hourlyMinimized?: unknown; minimizedDays?: unknown };
  if (!Number.isInteger(body.startHour) || (body.startHour as number) < 0 || (body.startHour as number) > 23) return null;
  if (!Number.isInteger(body.endHour) || (body.endHour as number) < 0 || (body.endHour as number) > 23) return null;
  if ((body.startHour as number) > (body.endHour as number)) return null;
  if (typeof body.hourlyMinimized !== 'boolean') return null;
  if (!Array.isArray(body.minimizedDays)) return null;
  const minimizedDays: string[] = [];
  for (const day of body.minimizedDays) {
    if (typeof day !== 'string' || !DATE_KEY.test(day)) return null;
    if (!minimizedDays.includes(day)) minimizedDays.push(day);
  }
  if (body.minimizedDays.length > 400) return null;
  return {
    startHour: body.startHour as number,
    endHour: body.endHour as number,
    hourlyMinimized: body.hourlyMinimized,
    minimizedDays,
  };
}

function storageKey(userId: number): string {
  return `schedule-forecast-view:${userId}`;
}

export function readStoredForecastView(userId: number): ScheduleForecastView | null {
  try {
    const raw = sessionStorage.getItem(storageKey(userId));
    return raw ? normalizeForecastView(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeStoredForecastView(userId: number, view: ScheduleForecastView) {
  sessionStorage.setItem(storageKey(userId), JSON.stringify(view));
}

export function useScheduleForecastView(userId: number | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ['schedule-forecast-view', userId ?? 'signed-out'];
  const stored = userId != null ? readStoredForecastView(userId) : null;
  const query = useQuery({
    queryKey,
    enabled: userId != null,
    placeholderData: stored ?? undefined,
    queryFn: async () => {
      const body = await customFetch<unknown>('/api/schedule/forecast-view');
      return normalizeForecastView(body) ?? DEFAULT_FORECAST_VIEW;
    },
  });
  useEffect(() => {
    if (userId != null && query.data) writeStoredForecastView(userId, query.data);
  }, [userId, query.data]);

  const save = useMutation({
    mutationFn: async (view: ScheduleForecastView) => {
      const body = await customFetch<unknown>('/api/schedule/forecast-view', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(view),
      });
      const saved = normalizeForecastView(body);
      if (!saved) throw new Error('The schedule forecast view was not saved');
      return saved;
    },
    onSuccess: saved => {
      queryClient.setQueryData(queryKey, saved);
      if (userId != null) writeStoredForecastView(userId, saved);
    },
    onError: () => {
      toast.error('The schedule forecast view was not saved');
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const view = query.data ?? stored ?? DEFAULT_FORECAST_VIEW;
  const update = (patch: Partial<ScheduleForecastView>) => {
    if (userId == null) return;
    const current = queryClient.getQueryData<ScheduleForecastView>(queryKey) ?? view;
    const next = { ...current, ...patch };
    queryClient.setQueryData(queryKey, next);
    writeStoredForecastView(userId, next);
    save.mutate(next);
  };
  return { view, update };
}
