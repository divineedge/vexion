import React, { useState } from 'react';
import { useParams } from 'wouter';
import {
  useGetPublicReview,
  getGetPublicReviewQueryKey,
  useSubmitReviewRating,
  useSubmitReviewFeedback,
  useMarkReviewRedirected,
} from '@workspace/api-client-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { Star, CheckCircle2, XCircle, ExternalLink } from 'lucide-react';

const CHECKLIST_OPTIONS = [
  'Missed areas',
  'Late arrival',
  'Communication issues',
  'Pricing concern',
  'Equipment damage',
  'Staff professionalism',
];

type Stage = 'rating' | 'feedback' | 'done_high' | 'done_low';

export default function ReviewPublicPage() {
  const { token } = useParams<{ token: string }>();

  const [stage, setStage] = useState<Stage>('rating');
  const [hoverRating, setHoverRating] = useState(0);
  const [submittedRating, setSubmittedRating] = useState<number | null>(null);
  const [redirectData, setRedirectData] = useState<{
    googleUrl: string | null;
    facebookUrl: string | null;
    customLink1Label: string | null;
    customLink1Url: string | null;
    customLink2Label: string | null;
    customLink2Url: string | null;
  } | null>(null);

  const [checklist, setChecklist] = useState<string[]>([]);
  const [feedbackText, setFeedbackText] = useState('');
  const [improvementText, setImprovementText] = useState('');
  const [logoError, setLogoError] = useState(false);

  const { data, isLoading, error } = useGetPublicReview(token!, {
    query: { enabled: !!token, queryKey: getGetPublicReviewQueryKey(token!) },
  });

  const submitRating = useSubmitReviewRating();
  const submitFeedback = useSubmitReviewFeedback();
  const markRedirected = useMarkReviewRedirected();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <p className="text-muted-foreground">Loading your review...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="pt-8 pb-8 text-center">
            <XCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">Link Not Found</h2>
            <p className="text-muted-foreground">This review link is invalid or has expired. Please contact us if you need assistance.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  function toggleChecklist(label: string) {
    setChecklist(prev =>
      prev.includes(label) ? prev.filter(l => l !== label) : [...prev, label],
    );
  }

  function handleRatingSubmit(rating: number) {
    setSubmittedRating(rating);
    submitRating.mutate(
      { token: token!, data: { rating } },
      {
        onSuccess: (result) => {
          if (rating === 5) {
            markRedirected.mutate({ token: token! }, {
              onSuccess: () => {
                setRedirectData({
                  googleUrl: result.googleUrl ?? null,
                  facebookUrl: result.facebookUrl ?? null,
                  customLink1Label: result.customLink1Label ?? null,
                  customLink1Url: result.customLink1Url ?? null,
                  customLink2Label: result.customLink2Label ?? null,
                  customLink2Url: result.customLink2Url ?? null,
                });
                setStage('done_high');
              },
              onError: () => {
                // Still show the thank you screen even if redirect tracking fails
                setRedirectData({
                  googleUrl: result.googleUrl ?? null,
                  facebookUrl: result.facebookUrl ?? null,
                  customLink1Label: result.customLink1Label ?? null,
                  customLink1Url: result.customLink1Url ?? null,
                  customLink2Label: result.customLink2Label ?? null,
                  customLink2Url: result.customLink2Url ?? null,
                });
                setStage('done_high');
              },
            });
          } else {
            setStage('feedback');
          }
        },
        onError: () => toast.error('Failed to submit rating. Please try again.'),
      },
    );
  }

  function handleFeedbackSubmit() {
    submitFeedback.mutate(
      {
        token: token!,
        data: {
          checklistSelections: checklist,
          feedbackText: feedbackText || undefined,
          improvementText: improvementText || undefined,
        },
      },
      {
        onSuccess: () => setStage('done_low'),
        onError: () => toast.error('Failed to submit feedback. Please try again.'),
      },
    );
  }

  const logoUrl = `${import.meta.env.BASE_URL}api/public/tenants/${data.tenantId}/logo`;

  return (
    <div className="min-h-screen bg-muted/30 py-8 px-4">
      <div className="max-w-lg mx-auto space-y-6">
        {/* Company header */}
        <div className="text-center space-y-3">
          {!logoError && (
            <img
              src={logoUrl}
              alt={`${data.companyName} logo`}
              className="h-14 mx-auto object-contain"
              onError={() => setLogoError(true)}
            />
          )}
          <h1 className="text-2xl font-bold">{data.companyName}</h1>
        </div>

        {/* Stage: rating picker */}
        {stage === 'rating' && (
          <Card>
            <CardContent className="pt-8 pb-8 text-center space-y-6">
              <div>
                <h2 className="text-xl font-semibold mb-1">How was your experience?</h2>
                <p className="text-muted-foreground text-sm">Tap a star to rate your service</p>
              </div>
              <div className="flex justify-center gap-3">
                {[1, 2, 3, 4, 5].map(s => (
                  <button
                    key={s}
                    className="focus:outline-none transition-transform hover:scale-110"
                    onMouseEnter={() => setHoverRating(s)}
                    onMouseLeave={() => setHoverRating(0)}
                    onClick={() => handleRatingSubmit(s)}
                    disabled={submitRating.isPending}
                    aria-label={`${s} star${s !== 1 ? 's' : ''}`}
                  >
                    <Star
                      className={`w-12 h-12 transition-colors ${
                        s <= (hoverRating || 0)
                          ? 'text-amber-400 fill-amber-400'
                          : 'text-muted-foreground/30'
                      }`}
                    />
                  </button>
                ))}
              </div>
              {submitRating.isPending && (
                <p className="text-sm text-muted-foreground">Submitting...</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Stage: feedback form (1-4 stars) */}
        {stage === 'feedback' && (
          <Card>
            <CardContent className="pt-6 pb-6 space-y-5">
              <div className="text-center space-y-1">
                <div className="flex justify-center gap-1 mb-2">
                  {[1, 2, 3, 4, 5].map(s => (
                    <Star
                      key={s}
                      className={`w-6 h-6 ${s <= (submittedRating ?? 0) ? 'text-amber-400 fill-amber-400' : 'text-muted-foreground/30'}`}
                    />
                  ))}
                </div>
                <h2 className="text-lg font-semibold">We're sorry to hear that</h2>
                <p className="text-sm text-muted-foreground">Help us improve by sharing what went wrong.</p>
              </div>

              <Separator />

              <div className="space-y-2">
                <p className="text-sm font-medium">What issues did you experience? (select all that apply)</p>
                <div className="grid grid-cols-2 gap-2">
                  {CHECKLIST_OPTIONS.map(label => (
                    <label
                      key={label}
                      className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer text-sm transition-all ${
                        checklist.includes(label)
                          ? 'bg-primary/5 border-primary/40 font-medium'
                          : 'hover:bg-muted/40 border-border'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checklist.includes(label)}
                        onChange={() => toggleChecklist(label)}
                        className="rounded accent-primary"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Tell us what went wrong</label>
                <Textarea
                  placeholder="Please describe the issue in more detail..."
                  rows={3}
                  value={feedbackText}
                  onChange={e => setFeedbackText(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">What could we do better?</label>
                <Textarea
                  placeholder="Any suggestions for improvement?"
                  rows={3}
                  value={improvementText}
                  onChange={e => setImprovementText(e.target.value)}
                />
              </div>

              <Button
                className="w-full"
                onClick={handleFeedbackSubmit}
                disabled={submitFeedback.isPending}
              >
                {submitFeedback.isPending ? 'Submitting...' : 'Submit Feedback'}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Stage: done — high rating (5 stars), show redirect links */}
        {stage === 'done_high' && (
          <Card>
            <CardContent className="pt-8 pb-8 text-center space-y-5">
              <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto" />
              <div>
                <h2 className="text-2xl font-bold mb-1">Thank You! 🎉</h2>
                <p className="text-muted-foreground">We're so glad you had a great experience. Would you mind leaving us a quick review?</p>
              </div>
              <div className="flex flex-col gap-3">
                {redirectData?.googleUrl && (
                  <a href={redirectData.googleUrl} target="_blank" rel="noopener noreferrer">
                    <Button className="w-full gap-2" variant="default">
                      <ExternalLink className="w-4 h-4" /> Leave a Google Review
                    </Button>
                  </a>
                )}
                {redirectData?.facebookUrl && (
                  <a href={redirectData.facebookUrl} target="_blank" rel="noopener noreferrer">
                    <Button className="w-full gap-2" variant="outline">
                      <ExternalLink className="w-4 h-4" /> Leave a Facebook Review
                    </Button>
                  </a>
                )}
                {redirectData?.customLink1Url && redirectData.customLink1Label && (
                  <a href={redirectData.customLink1Url} target="_blank" rel="noopener noreferrer">
                    <Button className="w-full gap-2" variant="outline">
                      <ExternalLink className="w-4 h-4" /> {redirectData.customLink1Label}
                    </Button>
                  </a>
                )}
                {redirectData?.customLink2Url && redirectData.customLink2Label && (
                  <a href={redirectData.customLink2Url} target="_blank" rel="noopener noreferrer">
                    <Button className="w-full gap-2" variant="outline">
                      <ExternalLink className="w-4 h-4" /> {redirectData.customLink2Label}
                    </Button>
                  </a>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Stage: done — low rating, no redirect */}
        {stage === 'done_low' && (
          <Card>
            <CardContent className="pt-8 pb-8 text-center space-y-4">
              <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto" />
              <div>
                <h2 className="text-xl font-bold mb-1">Thank You for Your Feedback</h2>
                <p className="text-muted-foreground">We appreciate you taking the time to let us know. Our team will review your feedback and follow up with you shortly.</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* If status is already 'rated' when loaded (previously responded) */}
        {stage === 'rating' && data.status === 'rated' && (
          <Card>
            <CardContent className="pt-8 pb-8 text-center">
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
              <h2 className="text-xl font-bold mb-2">Already Submitted</h2>
              <p className="text-muted-foreground">You've already submitted your review. Thank you!</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
