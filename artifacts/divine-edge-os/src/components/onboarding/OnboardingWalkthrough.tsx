import React, { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import {
  Users, Calendar, DollarSign, Settings, CheckCircle2,
  ChevronRight, ChevronLeft, Sparkles, X, MapPin, ClipboardList, Globe,
} from 'lucide-react';
import { useUpdateTenantSettings } from '@workspace/api-client-react';

const STORAGE_KEY = 'de_onboarding_done';
const PENDING_KEY = 'de_onboarding_pending';

// ── Timezone helpers ────────────────────────────────────────────────────────

function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'America/New_York';
  }
}

function getAllTimezones(): string[] {
  try {
    // Modern browsers support this
    return (Intl as any).supportedValuesOf('timeZone') as string[];
  } catch {
    // Curated fallback
    return [
      'America/Anchorage','America/Chicago','America/Denver','America/Detroit',
      'America/Halifax','America/Los_Angeles','America/New_York','America/Phoenix',
      'America/Puerto_Rico','America/Regina','America/St_Johns','America/Toronto',
      'America/Vancouver','America/Winnipeg',
      'Europe/Amsterdam','Europe/Berlin','Europe/London','Europe/Madrid',
      'Europe/Paris','Europe/Rome','Europe/Stockholm','Europe/Zurich',
      'Asia/Dubai','Asia/Hong_Kong','Asia/Jakarta','Asia/Kolkata',
      'Asia/Seoul','Asia/Shanghai','Asia/Singapore','Asia/Tokyo',
      'Australia/Melbourne','Australia/Sydney','Pacific/Auckland',
      'UTC',
    ];
  }
}

/** Group IANA zones by region prefix for the grouped <select> */
function groupTimezones(zones: string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const z of zones) {
    const slash = z.indexOf('/');
    const region = slash === -1 ? 'Other' : z.slice(0, slash);
    if (!groups[region]) groups[region] = [];
    groups[region].push(z);
  }
  return groups;
}

/** Pretty label: "America/New_York" → "New York (UTC-5)" */
function tzLabel(tz: string): string {
  try {
    const now = new Date();
    const offset = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    })
      .formatToParts(now)
      .find(p => p.type === 'timeZoneName')?.value ?? '';
    const city = tz.split('/').pop()?.replace(/_/g, ' ') ?? tz;
    return `${city} (${offset})`;
  } catch {
    return tz;
  }
}

// ── Step definitions ────────────────────────────────────────────────────────

interface Step {
  kind?: 'timezone';
  icon: React.ReactNode;
  title: string;
  description: string;
  tip: string;
  color: string;
  action?: { label: string; path: string };
}

const STEPS: Step[] = [
  {
    icon: <Sparkles className="w-10 h-10" />,
    title: 'Welcome to Divine Edge OS',
    description: "You're all set up. This quick tour covers the five things you'll use every day. It takes about a minute.",
    tip: 'You can re-open this tour any time from Settings → General.',
    color: 'from-violet-500 to-indigo-600',
  },
  {
    kind: 'timezone',
    icon: <Globe className="w-10 h-10" />,
    title: 'Set Your Timezone',
    description: "Choose the timezone your business operates in. This controls how scheduled visits, invoices, and timestamps are displayed across the app.",
    tip: "Tip: you can change this any time in Settings → General.",
    color: 'from-sky-500 to-blue-600',
  },
  {
    icon: <Users className="w-10 h-10" />,
    title: 'Customers',
    description: "Every job, invoice, and service history lives on a customer record. Start by adding your first customer — then attach properties to them.",
    tip: 'Tip: you can import a whole list at once using the CSV import on the Customers page.',
    color: 'from-blue-500 to-cyan-600',
    action: { label: 'Go to Customers', path: '/customers' },
  },
  {
    icon: <Calendar className="w-10 h-10" />,
    title: 'Schedule',
    description: "Create one-off jobs or set up recurring visits. Drag jobs on the calendar to reschedule, and assign them to staff or a crew.",
    tip: 'Tip: recurring jobs auto-generate on schedule — no manual work each week.',
    color: 'from-emerald-500 to-teal-600',
    action: { label: 'Open Schedule', path: '/schedule' },
  },
  {
    icon: <DollarSign className="w-10 h-10" />,
    title: 'Estimates & Invoices',
    description: "Send estimates for approval before work begins. After jobs are done, generate invoices and collect payment — by card, ACH, or check.",
    tip: 'Tip: enable Stripe in Settings → Integrations to accept online payments.',
    color: 'from-amber-500 to-orange-600',
    action: { label: 'View Estimates', path: '/estimates' },
  },
  {
    icon: <MapPin className="w-10 h-10" />,
    title: 'Properties & Blueprints',
    description: "Attach one or more properties to each customer. Upload a blueprint or pull satellite imagery to measure zones and estimate material costs.",
    tip: 'Tip: property size is used automatically when calculating chemical application rates.',
    color: 'from-pink-500 to-rose-600',
    action: { label: 'View Properties', path: '/properties' },
  },
  {
    icon: <ClipboardList className="w-10 h-10" />,
    title: 'Service Plans',
    description: "Set up recurring service plans for customers — monthly, weekly, or custom schedules. Plans auto-bill and auto-generate visits so nothing falls through the cracks.",
    tip: 'Tip: service plans appear in Settings → Service Plans.',
    color: 'from-purple-500 to-violet-600',
    action: { label: 'View Plans', path: '/plans' },
  },
  {
    icon: <Settings className="w-10 h-10" />,
    title: 'Settings',
    description: "Invite your team, connect Stripe, configure service zones, set up automated reminders, and customize everything to match your business.",
    tip: 'Tip: add team members in Settings → Team. Each person gets their own login.',
    color: 'from-slate-500 to-gray-700',
    action: { label: 'Open Settings', path: '/settings' },
  },
  {
    icon: <CheckCircle2 className="w-10 h-10" />,
    title: "You're ready to go!",
    description: "That's the core of Divine Edge OS. Add your first customer whenever you're ready — everything flows from there.",
    tip: 'You can always find help in Settings if you need it.',
    color: 'from-green-500 to-emerald-600',
    action: { label: 'Add First Customer', path: '/customers' },
  },
];

// ── Hook ────────────────────────────────────────────────────────────────────

export function useOnboarding() {
  const [show, setShow] = useState(() => {
    if (localStorage.getItem(STORAGE_KEY)) return false;
    return !!localStorage.getItem(PENDING_KEY);
  });

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, '1');
    localStorage.removeItem(PENDING_KEY);
    setShow(false);
  };

  return { show, dismiss };
}

export function markOnboardingPending() {
  localStorage.setItem(PENDING_KEY, '1');
}

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  onDismiss: () => void;
}

export default function OnboardingWalkthrough({ onDismiss }: Props) {
  const [step, setStep] = useState(0);
  const [, setLocation] = useLocation();
  const [timezone, setTimezone] = useState(getBrowserTimezone);
  const [tzSaving, setTzSaving] = useState(false);
  const [tzSearch, setTzSearch] = useState('');

  const updateSettings = useUpdateTenantSettings();

  const allZones = useMemo(() => getAllTimezones(), []);
  const groupedZones = useMemo(() => groupTimezones(allZones), [allZones]);

  const filteredGroups = useMemo(() => {
    if (!tzSearch.trim()) return groupedZones;
    const q = tzSearch.toLowerCase();
    const result: Record<string, string[]> = {};
    for (const [region, zones] of Object.entries(groupedZones)) {
      const matched = zones.filter(z => z.toLowerCase().includes(q));
      if (matched.length) result[region] = matched;
    }
    return result;
  }, [groupedZones, tzSearch]);

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const isTimezoneStep = current.kind === 'timezone';

  // Prevent body scroll while open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const saveTimezoneAndAdvance = async () => {
    setTzSaving(true);
    try {
      await updateSettings.mutateAsync({ data: { timezone } } as any);
    } catch {
      // non-blocking — they can fix it in Settings
    } finally {
      setTzSaving(false);
      setStep(s => s + 1);
    }
  };

  const handleNext = () => {
    if (isTimezoneStep) {
      saveTimezoneAndAdvance();
    } else {
      setStep(s => s + 1);
    }
  };

  const handleAction = (path: string) => {
    onDismiss();
    setLocation(path);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="relative bg-card rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Close */}
        <button
          className="absolute top-3 right-3 z-10 p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
          onClick={onDismiss}
          title="Skip tour"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Gradient header */}
        <div className={`bg-gradient-to-br ${current.color} text-white p-8 flex flex-col items-center gap-3 text-center`}>
          <div className="opacity-90">{current.icon}</div>
          <h2 className="text-xl font-bold">{current.title}</h2>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <p className="text-sm text-foreground leading-relaxed">{current.description}</p>

          {/* Timezone picker (only on timezone step) */}
          {isTimezoneStep && (
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Search timezone…"
                value={tzSearch}
                onChange={e => setTzSearch(e.target.value)}
                className="w-full text-sm border border-input rounded-md px-3 py-1.5 bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <select
                size={6}
                value={timezone}
                onChange={e => setTimezone(e.target.value)}
                className="w-full text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring overflow-auto"
              >
                {Object.entries(filteredGroups).map(([region, zones]) => (
                  <optgroup key={region} label={region}>
                    {zones.map(tz => (
                      <option key={tz} value={tz}>
                        {tzLabel(tz)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Selected: <span className="font-medium">{timezone}</span>
              </p>
            </div>
          )}

          <div className="bg-muted/50 rounded-lg px-3 py-2.5 text-xs text-muted-foreground italic">
            {current.tip}
          </div>

          {/* Step dots */}
          <div className="flex justify-center gap-1.5 pt-1">
            {STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => {
                  // Don't allow jumping past timezone without saving
                  if (i > step && isTimezoneStep) return;
                  setStep(i);
                }}
                className={`rounded-full transition-all ${i === step ? 'w-5 h-2 bg-primary' : 'w-2 h-2 bg-muted-foreground/30 hover:bg-muted-foreground/50'}`}
                aria-label={`Go to step ${i + 1}`}
              />
            ))}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            {step > 0 && (
              <Button variant="ghost" size="sm" className="gap-1" onClick={() => setStep(s => s - 1)} disabled={tzSaving}>
                <ChevronLeft className="w-4 h-4" /> Back
              </Button>
            )}
            <div className="flex-1" />
            {current.action && (
              <Button variant="outline" size="sm" onClick={() => handleAction(current.action!.path)}>
                {current.action.label}
              </Button>
            )}
            {isLast ? (
              <Button size="sm" className="gap-1" onClick={onDismiss}>
                Done <CheckCircle2 className="w-4 h-4" />
              </Button>
            ) : (
              <Button size="sm" className="gap-1" onClick={handleNext} disabled={tzSaving}>
                {tzSaving ? 'Saving…' : 'Next'} {!tzSaving && <ChevronRight className="w-4 h-4" />}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
