import { useMemo, useState } from 'react';
import {
  useGetScheduleWeather, getGetScheduleWeatherQueryKey,
  useListProperties, getListPropertiesQueryKey,
} from '@workspace/api-client-react';
import type { ScheduleForecastDay } from '@workspace/api-client-react';
import { CloudSun, MapPin, RefreshCw, AlertTriangle, ChevronDown, ChevronUp, Navigation } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  wmoDescription, compassDirection, fmtNum, isKnown, formatDateKey, hourLabel,
  pickDefaultPropertyId, todayKeyInZone, dateKeyToLocalDate, dateKeyOf,
} from '@/lib/scheduleWeather';

interface Props {
  tenantId: number | undefined;
  jobs: { propertyId?: number | null; scheduledAt: string }[];
  referenceDate: Date;
  onNavigateDate: (date: Date) => void;
}

const REFRESH_MS = 20 * 60 * 1000;

export function ScheduleWeather({ tenantId, jobs, referenceDate, onNavigateDate }: Props) {
  const [open, setOpen] = useState(true);
  const [manualPropertyId, setManualPropertyId] = useState<number | null>(null);

  const propsQuery = useListProperties(undefined, { query: { queryKey: getListPropertiesQueryKey() } });
  const pinned = useMemo(
    () => (propsQuery.data ?? []).filter(p => isKnown(p.lat) && isKnown(p.lng) && Math.abs(p.lat!) <= 90 && Math.abs(p.lng!) <= 180),
    [propsQuery.data],
  );
  const pinnedIds = useMemo(() => new Set(pinned.map(p => p.id)), [pinned]);
  const defaultId = useMemo(
    () => pickDefaultPropertyId(jobs, pinnedIds, referenceDate),
    [jobs, pinnedIds, referenceDate.getTime()],
  );
  const propertyId = manualPropertyId && pinnedIds.has(manualPropertyId) ? manualPropertyId : defaultId;
  const isDefault = propertyId !== null && propertyId === defaultId && manualPropertyId === null;

  const params = { propertyId: propertyId ?? 0 };
  const weather = useGetScheduleWeather(params, {
    query: {
      enabled: open && !!propertyId && tenantId !== undefined,
      queryKey: [...getGetScheduleWeatherQueryKey(params), { tenantId }],
      staleTime: REFRESH_MS,
      refetchInterval: REFRESH_MS,
    },
  });
  const fc = weather.data;

  const todayKey = fc ? todayKeyInZone(fc.timezone) : dateKeyOf(new Date());
  const days = fc?.daily ?? [];
  const refKey = dateKeyOf(referenceDate);
  const activeKey = days.some(d => d.date === refKey) ? refKey : days[0]?.date ?? null;
  const hours = useMemo(() => (fc?.hourly ?? []).filter(h => h.time.slice(0, 10) === activeKey), [fc, activeKey]);
  const outOfRange = days.length > 0 && (refKey < days[0].date || refKey > days[days.length - 1].date);

  const errStatus = (weather.error as { status?: number } | null)?.status;
  const selectDay = (d: ScheduleForecastDay) => onNavigateDate(dateKeyToLocalDate(d.date));

  return (
    <Card className="shrink-0 overflow-hidden" data-testid="panel-schedule-weather">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b bg-muted/20">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-2 text-sm font-semibold rounded px-1 -mx-1 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
          aria-expanded={open}
          data-testid="button-toggle-weather"
        >
          <CloudSun className="w-4 h-4 text-primary" /> 14-day planning forecast
          {open ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
        </button>
        {open && (
          <div className="flex w-full min-w-0 flex-wrap items-center gap-1.5 sm:ml-auto sm:w-auto">
            <label htmlFor="weather-location" className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="w-3 h-3" />Forecast location</label>
            <Select
              value={propertyId ? String(propertyId) : ''}
              onValueChange={v => setManualPropertyId(Number(v))}
              disabled={pinned.length === 0}
            >
              <SelectTrigger id="weather-location" className="h-8 text-xs min-w-0 flex-1 w-52 sm:flex-none sm:w-60" data-testid="select-weather-location">
                <SelectValue placeholder="Choose a pinned property" />
              </SelectTrigger>
              <SelectContent>
                {pinned.map(p => (
                  <SelectItem key={p.id} value={String(p.id)} className="text-xs">
                    {p.address}{p.id === defaultId ? ' (nearest scheduled job)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {manualPropertyId !== null && defaultId !== null && (
              <Button variant="ghost" size="sm" className="h-8 text-xs px-2" onClick={() => setManualPropertyId(null)} data-testid="button-weather-location-default">Use job default</Button>
            )}
          </div>
        )}
      </div>

      {open && (
        <div className="p-3 space-y-3">
          {propsQuery.isLoading ? (
            <SkeletonStrip />
          ) : propsQuery.isError ? (
            <ErrorRow message="Could not load company properties." onRetry={() => propsQuery.refetch()} />
          ) : pinned.length === 0 ? (
            <div className="text-xs text-muted-foreground rounded-md border border-dashed p-4" data-testid="text-weather-no-pins">
              No company property has a saved map pin. Add a pin on a property to see its forecast. Device location is never used.
            </div>
          ) : !propertyId ? (
            <div className="text-xs text-muted-foreground rounded-md border border-dashed p-4" data-testid="text-weather-choose">
              No scheduled job in view has a pinned property. Choose a forecast location above.
            </div>
          ) : weather.isLoading ? (
            <SkeletonStrip />
          ) : weather.isError ? (
            <ErrorRow
              message={errStatus === 422 ? 'This property has no valid saved map pin. Choose another location or update the property pin.'
                : errStatus === 503 ? 'The forecast provider is temporarily unavailable.'
                : 'Could not load the forecast.'}
              onRetry={() => weather.refetch()}
            />
          ) : !fc || days.length === 0 ? (
            <ErrorRow message="The provider returned no forecast days." onRetry={() => weather.refetch()} />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground" data-testid="text-weather-location">
                  {fc.location}{isDefault ? ' · default from scheduled jobs' : ''}
                </span>
                <span>{fc.latitude.toFixed(3)}, {fc.longitude.toFixed(3)} · {fc.timezone}</span>
                <span data-testid="text-weather-fetched">Updated {new Date(fc.fetchedAt).toLocaleString([], { timeZone: fc.timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                {weather.isFetching && <RefreshCw className="w-3 h-3 animate-spin" />}
                <span className="ml-auto">
                  Weather data by <a href="https://open-meteo.com/" target="_blank" rel="noreferrer" className="underline hover:text-foreground">Open-Meteo</a>{fc.source && !/open-?meteo/i.test(fc.source) ? ` (${fc.source})` : ''}
                </span>
              </div>
              {outOfRange && (
                <div className="text-[11px] rounded border border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200 px-2 py-1" data-testid="text-weather-out-of-range">
                  The schedule date in view ({formatDateKey(refKey).monthDay}) is outside the forecast range. No forecast is available for it.
                </div>
              )}
              <div className="overflow-x-auto -mx-1 px-1 pb-1">
                <div className="grid grid-flow-col auto-cols-[minmax(92px,1fr)] gap-1.5 min-w-max lg:min-w-0">
                  {days.map((d, i) => {
                    const { weekday, monthDay } = formatDateKey(d.date);
                    const extended = i >= 7;
                    const selected = d.date === activeKey;
                    const past = d.date < todayKey;
                    return (
                      <button
                        key={d.date}
                        type="button"
                        onClick={() => selectDay(d)}
                        aria-pressed={selected}
                        title={`${wmoDescription(d.weatherCode)}${extended ? ' · extended range, less certain' : ''}`}
                        data-testid={`button-weather-day-${d.date}`}
                        className={cn(
                          'text-left rounded-md border px-2 py-1.5 text-[11px] leading-tight tabular-nums transition-all',
                          'hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          selected ? 'border-primary bg-primary/10 ring-1 ring-primary' : 'bg-background',
                          extended && !selected && 'border-dashed bg-muted/30',
                          past && 'opacity-60',
                        )}
                      >
                        <div className="flex items-baseline justify-between gap-1">
                          <span className="font-semibold text-xs">{weekday}</span>
                          <span className="text-muted-foreground">{monthDay}</span>
                        </div>
                        <div className="truncate text-muted-foreground">{wmoDescription(d.weatherCode)}</div>
                        <div className="mt-0.5"><span className="font-semibold text-sm">{fmtNum(d.highF, 0, '°')}</span> <span className="text-muted-foreground">/ {fmtNum(d.lowF, 0, '°F')}</span></div>
                        <div>Rain {fmtNum(d.rainProbability, 0, '%')} · {fmtNum(d.precipitationIn, 2, '"')}</div>
                        <div className="flex items-center gap-0.5">
                          {isKnown(d.windDirectionDeg) && <Navigation className="w-2.5 h-2.5 shrink-0" style={{ transform: `rotate(${(d.windDirectionDeg + 180) % 360}deg)` }} />}
                          {fmtNum(d.windMph)}/{fmtNum(d.gustMph)} mph {compassDirection(d.windDirectionDeg)}
                        </div>
                        {extended && <div className="text-[10px] text-amber-700 dark:text-amber-400 mt-0.5">Extended, less certain</div>}
                      </button>
                    );
                  })}
                </div>
              </div>

              {activeKey && (
                <div className="rounded-md border" data-testid="panel-weather-hourly">
                  <div className="flex flex-wrap items-center gap-2 px-2 py-1.5 border-b bg-muted/20 text-xs">
                    <span className="font-semibold">Hourly · {formatDateKey(activeKey).weekday} {formatDateKey(activeKey).monthDay}</span>
                    <span className="text-muted-foreground">Times in {fc.timezone}</span>
                    {days.findIndex(d => d.date === activeKey) >= 7 && <span className="text-amber-700 dark:text-amber-400">Extended range, less certain</span>}
                  </div>
                  {hours.length === 0 ? (
                    <div className="p-3 text-xs text-muted-foreground" data-testid="text-weather-no-hourly">Hourly detail is unavailable for this date.</div>
                  ) : (
                    <div className="max-h-56 overflow-auto">
                      <table className="w-full text-[11px] tabular-nums">
                        <thead className="sticky top-0 bg-card text-muted-foreground">
                          <tr className="text-left">
                            <th className="px-2 py-1 font-medium">Hour</th>
                            <th className="px-2 py-1 font-medium text-right">Temp</th>
                            <th className="px-2 py-1 font-medium text-right">Rain %</th>
                            <th className="px-2 py-1 font-medium text-right">Rain in</th>
                            <th className="px-2 py-1 font-medium text-right">Wind</th>
                            <th className="px-2 py-1 font-medium text-right">Gust</th>
                            <th className="px-2 py-1 font-medium">Dir</th>
                            <th className="px-2 py-1 font-medium text-right">Humidity</th>
                          </tr>
                        </thead>
                        <tbody>
                          {hours.map(h => (
                            <tr key={h.time} className="border-t hover:bg-muted/40">
                              <td className="px-2 py-0.5 whitespace-nowrap">{hourLabel(h.time)}</td>
                              <td className="px-2 py-0.5 text-right">{fmtNum(h.temperatureF, 0, '°F')}</td>
                              <td className="px-2 py-0.5 text-right">{fmtNum(h.rainProbability, 0, '%')}</td>
                              <td className="px-2 py-0.5 text-right">{fmtNum(h.precipitationIn, 2)}</td>
                              <td className="px-2 py-0.5 text-right">{fmtNum(h.windMph, 0, ' mph')}</td>
                              <td className="px-2 py-0.5 text-right">{fmtNum(h.gustMph, 0, ' mph')}</td>
                              <td className="px-2 py-0.5">{compassDirection(h.windDirectionDeg)}</td>
                              <td className="px-2 py-0.5 text-right">{fmtNum(h.humidityPct, 0, '%')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
              <p className="text-[11px] text-muted-foreground flex gap-1.5">
                <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                Planning forecast only, not an application record. Always follow the product label and verify wind, temperature and rain conditions on site before spraying. A dash means the value is unavailable.
              </p>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

function SkeletonStrip() {
  return (
    <div className="flex gap-1.5 overflow-hidden" data-testid="status-weather-loading">
      {Array.from({ length: 14 }).map((_, i) => (
        <div key={i} className="h-24 w-[92px] shrink-0 rounded-md bg-muted animate-pulse" />
      ))}
    </div>
  );
}

function ErrorRow({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs" data-testid="status-weather-error">
      <AlertTriangle className="w-3.5 h-3.5 text-destructive" />
      <span>{message}</span>
      <Button variant="outline" size="sm" className="h-7 text-xs ml-auto gap-1" onClick={onRetry} data-testid="button-weather-retry">
        <RefreshCw className="w-3 h-3" /> Retry
      </Button>
    </div>
  );
}
