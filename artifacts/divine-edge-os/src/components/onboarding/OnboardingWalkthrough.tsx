import React, { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import {
  Users, Calendar, DollarSign, Settings, CheckCircle2,
  ChevronRight, ChevronLeft, Sparkles, X, MapPin, ClipboardList,
} from 'lucide-react';

const STORAGE_KEY = 'de_onboarding_done';
const PENDING_KEY = 'de_onboarding_pending';

interface Step {
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
    action: undefined,
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

interface Props {
  onDismiss: () => void;
}

export default function OnboardingWalkthrough({ onDismiss }: Props) {
  const [step, setStep] = useState(0);
  const [, setLocation] = useLocation();
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  // Prevent scroll while open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

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
          <div className="bg-muted/50 rounded-lg px-3 py-2.5 text-xs text-muted-foreground italic">
            {current.tip}
          </div>

          {/* Step dots */}
          <div className="flex justify-center gap-1.5 pt-1">
            {STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                className={`rounded-full transition-all ${i === step ? 'w-5 h-2 bg-primary' : 'w-2 h-2 bg-muted-foreground/30 hover:bg-muted-foreground/50'}`}
                aria-label={`Go to step ${i + 1}`}
              />
            ))}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            {step > 0 && (
              <Button variant="ghost" size="sm" className="gap-1" onClick={() => setStep(s => s - 1)}>
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
              <Button size="sm" className="gap-1" onClick={() => setStep(s => s + 1)}>
                Next <ChevronRight className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
