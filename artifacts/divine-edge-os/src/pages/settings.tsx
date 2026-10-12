import React, { useState, useEffect, useRef } from 'react';
import { DefaultWordingCard } from '@/components/settings/DefaultWordingCard';
import { useLocation } from 'wouter';
import {
  useGetTenantSettings, getGetTenantSettingsQueryKey,
  useUpdateTenantSettings,
  useListUsers, getListUsersQueryKey,
  useCreateUser, useUpdateUser, useDeleteUser,
  useListPlans, getListPlansQueryKey,
  useUpdateFollowupTriggerConfig,
  useGetGmailAuthorizeUrl, getGetGmailAuthorizeUrlQueryKey,
  useDisconnectGmail,
  useListTags, getListTagsQueryKey, useCreateTag, useUpdateTag, useDeleteTag,
  useListSkipReasons, getListSkipReasonsQueryKey, useCreateSkipReason, useUpdateSkipReason, useDeleteSkipReason,
  customFetch,
} from '@workspace/api-client-react';
import type { FollowupTriggerConfig } from '@workspace/api-client-react';
import type { PaymentReminderRule } from '@workspace/api-client-react';
import { Repeat as RepeatIcon, ClipboardList, Search } from 'lucide-react';
import { format } from 'date-fns';
import PlanTemplatesSettings from '@/components/settings/PlanTemplatesSettings';
import RolePermissionsSettings from '@/components/settings/RolePermissionsSettings';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import {
  Building, CreditCard, Users, Shield, CheckCircle2, Plus, Trash2,
  GripVertical, EyeOff, Eye, Star, Settings as SettingsIcon, TrendingUp,
  ArrowRight, FlaskConical, Pencil, X, MapPin, Ruler, Navigation, MessageSquare,
  Phone, Mail, Send, Wifi, WifiOff, CheckCircle, AlertCircle,
  ImageIcon, Bell, Star as StarIcon, Link, Camera, Loader2, Copy, ExternalLink,
  PhoneMissed as PhoneMissedIcon, FileText, Tag, SkipForward, Zap,
} from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { BUILT_IN_CUSTOMER_FIELDS, CORE_FIELD_KEYS, getActiveCustomerFields, type CustomerFieldConfig } from '@/lib/fieldConfig';
import IntegrationsGrid from '@/components/settings/IntegrationsGrid';
import DevToolsPanel from '@/components/settings/DevToolsPanel';
import RoutingSettings from '@/components/settings/RoutingSettings';
import DeclineReasonsSettings from '@/components/settings/DeclineReasonsSettings';
import { AddressAutocomplete, type AddressSuggestion } from '@/components/shared/AddressAutocomplete';
import ExternalAccessSettings from '@/components/settings/ExternalAccessSettings';

export default function SettingsPage() {
  const { isSuperAdmin, isOwner, user } = useAuth();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();

  const { data: settings } = useGetTenantSettings({ query: { queryKey: getGetTenantSettingsQueryKey() } });
  const { data: users } = useListUsers({ query: { queryKey: getListUsersQueryKey() } });
  const { data: plans } = useListPlans({ query: { enabled: isSuperAdmin, queryKey: getListPlansQueryKey() } });
  const updateSettings = useUpdateTenantSettings();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const gmailAuthorizeUrl = useGetGmailAuthorizeUrl({ query: { enabled: false, queryKey: getGetGmailAuthorizeUrlQueryKey() } });
  const disconnectGmail = useDisconnectGmail({
    mutation: {
      onSuccess: () => {
        toast.success('Gmail disconnected');
        setGmailConnected(false);
        setGmailEmail('');
        qc.invalidateQueries({ queryKey: getGetTenantSettingsQueryKey() });
      },
      onError: () => toast.error('Failed to disconnect Gmail'),
    },
  });

  const handleGmailConnect = async () => {
    const result = await gmailAuthorizeUrl.refetch();
    if (result.data?.url) window.location.href = result.data.url;
    else toast.error('Could not start Google authorization. Please try again.');
  };

  // General
  const [companyName, setCompanyName] = useState('');
  const [timezone, setTimezone] = useState('');
  const [taxRate, setTaxRate] = useState('');
  const [buffer, setBuffer] = useState('');

  // Inventory pricing
  const [markupPct, setMarkupPct] = useState('');
  const [showCostToTech, setShowCostToTech] = useState(false);

  // Customer fields
  const [customerFields, setCustomerFields] = useState<CustomerFieldConfig[]>([]);
  const [addFieldOpen, setAddFieldOpen] = useState(false);
  const [newField, setNewField] = useState<Partial<CustomerFieldConfig>>({ type: 'text', visible: true, required: false, isBuiltIn: false });
  const [newOptions, setNewOptions] = useState('');

  // Operational
  const [durationUnit, setDurationUnit] = useState<'minutes' | 'hours'>('minutes');
  const [ownersSchedulable, setOwnersSchedulable] = useState(false);
  const [autoInvoiceFrequency, setAutoInvoiceFrequency] = useState<'off' | 'daily' | 'weekly' | 'bi_monthly' | 'monthly' | 'biweekly' | 'weekly_friday' | 'monthly_15'>('off');
  const [nonRecurringInvoiceCadence, setNonRecurringInvoiceCadence] = useState<'immediate' | 'weekly'>('immediate');
  const [invoiceDeliveryMode, setInvoiceDeliveryMode] = useState<'review' | 'automatic'>('review');
  const [maxClockInHours, setMaxClockInHours] = useState('');
  const [dailyTaskHourlyRate, setDailyTaskHourlyRate] = useState('0');
  const [defaultOffSeasonStart, setDefaultOffSeasonStart] = useState('11-15');
  const [defaultOffSeasonEnd, setDefaultOffSeasonEnd] = useState('03-14');
  // Estimate & Invoice defaults
  const [estimateExpiryDays, setEstimateExpiryDays] = useState('30');
  const [invoiceDueDays, setInvoiceDueDays] = useState('30');
  const [taxEnabled, setTaxEnabled] = useState(true);
  // Callback due-date defaults
  const [callbackDueHoursHigh, setCallbackDueHoursHigh] = useState('4');
  const [callbackDueHoursNormal, setCallbackDueHoursNormal] = useState('24');
  const [callbackDueHoursLow, setCallbackDueHoursLow] = useState('72');
  const [callbackWarningThresholdPct, setCallbackWarningThresholdPct] = useState('10');
  // Plan renewal warning
  const [renewalWarningDays, setRenewalWarningDays] = useState('30');
  // Cancellation policy
  const [cancellationFeeEnabled, setCancellationFeeEnabled] = useState(false);
  const [cancellationFeeAmount, setCancellationFeeAmount] = useState('50');
  const [teamSearch, setTeamSearch] = useState('');
  const [teamRoleFilter, setTeamRoleFilter] = useState('all');

  // Business Tags
  const { data: bizTags = [] } = useListTags({ query: { queryKey: getListTagsQueryKey() } });
  const createTag = useCreateTag();
  const updateTagMutation = useUpdateTag();
  const deleteTagMutation = useDeleteTag();
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#6b7280');
  const [editingTagId, setEditingTagId] = useState<number | null>(null);
  const [editingTagName, setEditingTagName] = useState('');
  const [editingTagColor, setEditingTagColor] = useState('#6b7280');

  // Skip Reasons
  const { data: skipReasons = [] } = useListSkipReasons({ query: { queryKey: getListSkipReasonsQueryKey() } });
  const createSkipReason = useCreateSkipReason();
  const updateSkipReasonMutation = useUpdateSkipReason();
  const deleteSkipReasonMutation = useDeleteSkipReason();
  const [newSkipLabel, setNewSkipLabel] = useState('');
  const [newSkipAction, setNewSkipAction] = useState('none');
  const [newSkipMsgTemplate, setNewSkipMsgTemplate] = useState('');
  const [newSkipFlagNote, setNewSkipFlagNote] = useState('');
  const [newSkipTaskTitle, setNewSkipTaskTitle] = useState('');
  const [editingSkipId, setEditingSkipId] = useState<number | null>(null);
  const [editingSkipAction, setEditingSkipAction] = useState('none');
  const [editingSkipMsgTemplate, setEditingSkipMsgTemplate] = useState('');
  const [editingSkipFlagNote, setEditingSkipFlagNote] = useState('');
  const [editingSkipTaskTitle, setEditingSkipTaskTitle] = useState('');

  // Communications
  const [mainPhoneNumber, setMainPhoneNumber] = useState('');
  const [marketingPhoneNumber, setMarketingPhoneNumber] = useState('');
  const [phonePlatform, setPhonePlatform] = useState('');
  const [phonePlatformApiKey, setPhonePlatformApiKey] = useState('');
  const [phonePlatformAccountSid, setPhonePlatformAccountSid] = useState('');
  const [phonePlatformAuthToken, setPhonePlatformAuthToken] = useState('');
  const [phonePlatformWebhookSecret, setPhonePlatformWebhookSecret] = useState('');
  const [quoPhoneNumberId, setQuoPhoneNumberId] = useState('');
  const [emailProvider, setEmailProvider] = useState('');
  const [emailApiKey, setEmailApiKey] = useState('');
  const [emailFromAddress, setEmailFromAddress] = useState('');
  const [emailDomain, setEmailDomain] = useState('');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailEmail, setGmailEmail] = useState('');
  const [gmailSenderName, setGmailSenderName] = useState('');

  // Maps & measurement
  const [defaultGeofenceRadius, setDefaultGeofenceRadius] = useState('100');
  const [defaultGeofenceUnit, setDefaultGeofenceUnit] = useState<'m' | 'ft'>('m');
  const [autoCreateGeofence, setAutoCreateGeofence] = useState(false);
  const [preferredAreaUnit, setPreferredAreaUnit] = useState<'sqft' | 'acres'>('sqft');
  const [zoneTypes, setZoneTypes] = useState<Array<{ id: string; name: string; color: string; mode?: 'area' | 'linear' }>>([
    { id: '1', name: 'Front Lawn', color: '#3B82F6', mode: 'area' },
    { id: '2', name: 'Back Yard', color: '#10B981', mode: 'area' },
    { id: '3', name: 'Bed Areas', color: '#F59E0B', mode: 'area' },
    { id: '4', name: 'Side Yard', color: '#EF4444', mode: 'area' },
    { id: '5', name: 'Common Area', color: '#8B5CF6', mode: 'area' },
    { id: '6', name: 'Fence Line', color: '#06B6D4', mode: 'linear' },
  ]);

  // Team
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({ name: '', email: '', role: 'technician', password: '', hourlyRate: '', hireDate: '' });
  const [editUserOpen, setEditUserOpen] = useState(false);
  const [editUserForm, setEditUserForm] = useState<{ id: number; name: string; role: string; hourlyRate: string; hireDate: string; applicatorLicense: string } | null>(null);


  // Branding
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const logoFileRef = useRef<HTMLInputElement>(null);
  const [businessPhone, setBusinessPhone] = useState('');
  const [businessEmail, setBusinessEmail] = useState('');
  const [businessWebsite, setBusinessWebsite] = useState('');
  const [businessAddress, setBusinessAddress] = useState('');
  const [businessCity, setBusinessCity] = useState('');
  const [businessState, setBusinessState] = useState('');
  const [businessZip, setBusinessZip] = useState('');
  const [businessLat, setBusinessLat] = useState<number | null>(null);
  const [businessLng, setBusinessLng] = useState<number | null>(null);
  const [businessMailingSameAsPhysical, setBusinessMailingSameAsPhysical] = useState(true);
  const [businessMailingAddress, setBusinessMailingAddress] = useState('');
  const [businessMailingCity, setBusinessMailingCity] = useState('');
  const [businessMailingState, setBusinessMailingState] = useState('');
  const [businessMailingZip, setBusinessMailingZip] = useState('');
  const [businessLicenseNumber, setBusinessLicenseNumber] = useState('');
  const [businessTagline, setBusinessTagline] = useState('');
  const [invoiceFooterText, setInvoiceFooterText] = useState('');

  // Payment Reminders
  const [paymentRemindersEnabled, setPaymentRemindersEnabled] = useState(false);
  const [paymentReminderSchedule, setPaymentReminderSchedule] = useState<PaymentReminderRule[]>([]);
  const [paymentReminderChannels, setPaymentReminderChannels] = useState<Array<'email' | 'sms'>>([]);
  const [stopServiceRuleEnabled, setStopServiceRuleEnabled] = useState(false);

  // Notification Templates
  const [notificationTemplates, setNotificationTemplates] = useState<Record<string, string | undefined>>({});
  const [testEmailSending, setTestEmailSending] = useState(false);
  const DEFAULT_FOLLOWUP_CONFIG: FollowupTriggerConfig = {
    sentEstimate: { enabled: true, delayDays: 3, repeatDays: 4 },
    sentInvoice: { enabled: true, delayDays: 5, repeatDays: 5 },
    unansweredEmail: { enabled: true, hours: 48 },
    missedCall: { enabled: true },
  };
  const [followupConfig, setFollowupConfig] = useState<FollowupTriggerConfig>(DEFAULT_FOLLOWUP_CONFIG);
  const updateFollowupTriggerConfig = useUpdateFollowupTriggerConfig();
  const [stopServiceThresholdDays, setStopServiceThresholdDays] = useState('30');

  // Reviews
  const [reviewRequestOnInvoicePaid, setReviewRequestOnInvoicePaid] = useState(false);
  const [reviewRequestOnEstimateApproved, setReviewRequestOnEstimateApproved] = useState(false);
  const [reviewGoogleUrl, setReviewGoogleUrl] = useState('');
  const [reviewFacebookUrl, setReviewFacebookUrl] = useState('');
  const [reviewCustomLink1Label, setReviewCustomLink1Label] = useState('');
  const [reviewCustomLink1Url, setReviewCustomLink1Url] = useState('');
  const [reviewCustomLink2Label, setReviewCustomLink2Label] = useState('');
  const [reviewCustomLink2Url, setReviewCustomLink2Url] = useState('');


  useEffect(() => {
    if (settings) {
      setCompanyName(settings.companyName ?? '');
      setTimezone(settings.timezone ?? 'America/Los_Angeles');
      setTaxRate(String(settings.taxRate ?? 8.5));
      setBuffer(String(settings.overageMaterialBuffer ?? 10));
      setMarkupPct(String(settings.defaultMarkupPct ?? 20));
      setShowCostToTech(settings.showCostPriceToTech ?? false);
      setDurationUnit((settings.durationUnit as 'minutes' | 'hours') ?? 'minutes');
      setOwnersSchedulable((settings as any).ownersSchedulable ?? false);
      setAutoInvoiceFrequency((settings.autoInvoiceFrequency as typeof autoInvoiceFrequency) ?? 'off');
      setNonRecurringInvoiceCadence(((settings as any).nonRecurringInvoiceCadence as 'immediate' | 'weekly') ?? 'immediate');
      setInvoiceDeliveryMode(settings.invoiceDeliveryMode === 'automatic' ? 'automatic' : 'review');
      setMaxClockInHours((settings as any).maxClockInHours != null ? String((settings as any).maxClockInHours) : '');
      setDailyTaskHourlyRate(String(settings.dailyTaskHourlyRate ?? 0));
      setDefaultOffSeasonStart((settings as any).defaultOffSeasonStart ?? '11-15');
      setDefaultOffSeasonEnd((settings as any).defaultOffSeasonEnd ?? '03-14');
      setEstimateExpiryDays(String((settings as any).estimateExpiryDays ?? 30));
      setInvoiceDueDays(String((settings as any).invoiceDueDays ?? 30));
      setTaxEnabled((settings as any).taxEnabled ?? true);
      setCallbackDueHoursHigh(String((settings as any).callbackDueHoursHigh ?? 4));
      setCallbackDueHoursNormal(String((settings as any).callbackDueHoursNormal ?? 24));
      setCallbackDueHoursLow(String((settings as any).callbackDueHoursLow ?? 72));
      setCallbackWarningThresholdPct(String((settings as any).callbackWarningThresholdPct ?? 10));
      setRenewalWarningDays(String((settings as any).renewalWarningDays ?? 30));
      setCancellationFeeEnabled((settings as any).cancellationFeeEnabled ?? false);
      setCancellationFeeAmount(String((settings as any).cancellationFeeAmount ?? 50));
      setDefaultGeofenceRadius(String((settings as any).defaultGeofenceRadius ?? 100));
      setDefaultGeofenceUnit(((settings as any).defaultGeofenceUnit as 'm' | 'ft') ?? 'm');
      setAutoCreateGeofence((settings as any).autoCreateGeofence ?? false);
      setPreferredAreaUnit(((settings as any).preferredAreaUnit as 'sqft' | 'acres') ?? 'sqft');
      const rawZoneTypes = (settings as any).measurementZoneTypes as Array<{ id: string; name: string; color: string; mode?: 'area' | 'linear' }> | undefined;
      if (rawZoneTypes && rawZoneTypes.length > 0) {
        setZoneTypes(rawZoneTypes.map(zt => ({ ...zt, mode: zt.mode ?? 'area' })));
      } else {
        // Derive from legacy labels with default colors. Legacy labels carry no mode info, so
        // derived zone types always default to 'area'.
        const ZONE_COLORS = ['#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6','#06B6D4','#84CC16','#F97316','#EC4899','#6366F1'];
        const labels: string[] = (settings as any).measurementZoneLabels ?? ['Front Lawn', 'Back Yard', 'Bed Areas', 'Side Yard', 'Common Area'];
        setZoneTypes(labels.map((name, i) => ({ id: String(i + 1), name, color: ZONE_COLORS[i % ZONE_COLORS.length], mode: 'area' as const })));
      }
      setCustomerFields(getActiveCustomerFields(settings));
      // Branding
      setLogoUrl(settings.logoUrl ?? null);
      setBusinessPhone((settings as any).businessPhone ?? '');
      setBusinessEmail((settings as any).businessEmail ?? '');
      setBusinessWebsite((settings as any).businessWebsite ?? '');
      setBusinessAddress((settings as any).businessAddress ?? '');
      setBusinessCity((settings as any).businessCity ?? '');
      setBusinessState((settings as any).businessState ?? '');
      setBusinessZip((settings as any).businessZip ?? '');
      setBusinessLat((settings as any).businessLat ?? null);
      setBusinessLng((settings as any).businessLng ?? null);
      setBusinessMailingSameAsPhysical((settings as any).businessMailingSameAsPhysical ?? true);
      setBusinessMailingAddress((settings as any).businessMailingAddress ?? '');
      setBusinessMailingCity((settings as any).businessMailingCity ?? '');
      setBusinessMailingState((settings as any).businessMailingState ?? '');
      setBusinessMailingZip((settings as any).businessMailingZip ?? '');
      setBusinessLicenseNumber((settings as any).businessLicenseNumber ?? '');
      setBusinessTagline((settings as any).businessTagline ?? '');
      setInvoiceFooterText((settings as any).invoiceFooterText ?? '');

      // Payment Reminders
      setPaymentRemindersEnabled((settings as any).paymentRemindersEnabled ?? false);
      setPaymentReminderSchedule((settings as any).paymentReminderSchedule ?? []);
      setPaymentReminderChannels(((settings as any).paymentReminderChannels ?? []) as Array<'email' | 'sms'>);
      setStopServiceRuleEnabled((settings as any).stopServiceRuleEnabled ?? false);
      setStopServiceThresholdDays(String((settings as any).stopServiceThresholdDays ?? 30));

      // Notification Templates
      setNotificationTemplates((settings as any).notificationTemplates ?? {});

      // Reviews
      setReviewRequestOnInvoicePaid((settings as any).reviewRequestOnInvoicePaid ?? false);
      setReviewRequestOnEstimateApproved((settings as any).reviewRequestOnEstimateApproved ?? false);
      setReviewGoogleUrl((settings as any).reviewGoogleUrl ?? '');
      setReviewFacebookUrl((settings as any).reviewFacebookUrl ?? '');
      setReviewCustomLink1Label((settings as any).reviewCustomLink1Label ?? '');
      setReviewCustomLink1Url((settings as any).reviewCustomLink1Url ?? '');
      setReviewCustomLink2Label((settings as any).reviewCustomLink2Label ?? '');
      setReviewCustomLink2Url((settings as any).reviewCustomLink2Url ?? '');

      // Communications
      const s = settings as any;
      setMainPhoneNumber(s.mainPhoneNumber ?? '');
      setMarketingPhoneNumber(s.marketingPhoneNumber ?? '');
      setPhonePlatform(s.phonePlatform ?? '');
      setPhonePlatformApiKey(s.phonePlatformConfig?.apiKey ?? '');
      setPhonePlatformAccountSid(s.phonePlatformConfig?.accountSid ?? '');
      setPhonePlatformWebhookSecret(s.phonePlatformConfig?.webhookSecret ?? '');
      setQuoPhoneNumberId(s.phonePlatformConfig?.quoPhoneNumberId ?? '');
      setEmailProvider(s.emailProvider ?? '');
      setEmailApiKey(s.emailProviderConfig?.apiKey ?? '');
      setEmailFromAddress(s.emailProviderConfig?.fromAddress ?? '');
      setEmailDomain(s.emailProviderConfig?.domain ?? '');
      setSmtpHost(s.emailProviderConfig?.smtpHost ?? '');
      setSmtpPort(s.emailProviderConfig?.smtpPort ?? '587');
      setSmtpUser(s.emailProviderConfig?.smtpUser ?? '');
      setSmtpPass(s.emailProviderConfig?.smtpPass ?? '');
      setGmailConnected(!!s.emailProviderConfig?.gmailConnected);
      setGmailEmail(s.emailProviderConfig?.gmailEmail ?? '');
      setGmailSenderName((s.emailProviderConfig as any)?.gmailSenderName ?? '');

      // Follow-Up Queue triggers
      if (s.followupTriggerConfig) {
        setFollowupConfig({ ...DEFAULT_FOLLOWUP_CONFIG, ...s.followupTriggerConfig });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  // ── Branding handlers ──
  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Only images are allowed'); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error('Image must be under 10 MB'); return; }
    setLogoUploading(true);
    try {
      const { uploadURL, objectPath } = await customFetch<{ uploadURL: string; objectPath: string }>(
        '/api/storage/uploads/request-url',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }) },
      );
      const uploadRes = await fetch(uploadURL, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!uploadRes.ok) throw new Error('Upload failed');
      await new Promise<void>((resolve, reject) => {
        updateSettings.mutate(
          { data: { logoUrl: objectPath } },
          { onSuccess: () => { setLogoUrl(objectPath); qc.invalidateQueries({ queryKey: getGetTenantSettingsQueryKey() }); resolve(); }, onError: () => reject(new Error('Save failed')) },
        );
      });
      toast.success('Logo updated');
    } catch {
      toast.error('Failed to upload logo');
    } finally {
      setLogoUploading(false);
      e.target.value = '';
    }
  };

  const selectBusinessPhysicalAddress = (item: AddressSuggestion) => {
    const city = item.city ?? '';
    const state = item.state ?? '';
    const zip = item.zip ?? '';
    setBusinessAddress(item.address);
    setBusinessCity(city);
    setBusinessState(state);
    setBusinessZip(zip);
    setBusinessLat(item.lat);
    setBusinessLng(item.lng);
    if (businessMailingSameAsPhysical) {
      setBusinessMailingAddress(item.address);
      setBusinessMailingCity(city);
      setBusinessMailingState(state);
      setBusinessMailingZip(zip);
    }
  };

  const selectBusinessMailingAddress = (item: AddressSuggestion) => {
    setBusinessMailingAddress(item.address);
    setBusinessMailingCity(item.city ?? '');
    setBusinessMailingState(item.state ?? '');
    setBusinessMailingZip(item.zip ?? '');
  };

  const saveBranding = () => {
    const mailingAddress = businessMailingSameAsPhysical ? businessAddress : businessMailingAddress;
    const mailingCity = businessMailingSameAsPhysical ? businessCity : businessMailingCity;
    const mailingState = businessMailingSameAsPhysical ? businessState : businessMailingState;
    const mailingZip = businessMailingSameAsPhysical ? businessZip : businessMailingZip;
    updateSettings.mutate(
      { data: {
        businessPhone: businessPhone || null,
        businessEmail: businessEmail || null,
        businessWebsite: businessWebsite || null,
        businessAddress: businessAddress || null,
        businessCity: businessCity || null,
        businessState: businessState || null,
        businessZip: businessZip || null,
        businessLat,
        businessLng,
        businessMailingSameAsPhysical,
        businessMailingAddress: mailingAddress || null,
        businessMailingCity: mailingCity || null,
        businessMailingState: mailingState || null,
        businessMailingZip: mailingZip || null,
        businessLicenseNumber: businessLicenseNumber || undefined,
        businessTagline: businessTagline || undefined,
        invoiceFooterText: invoiceFooterText || undefined,
      } as Parameters<typeof updateSettings.mutate>[0]['data'] },
      {
        onSuccess: () => { toast.success('Branding saved'); qc.invalidateQueries({ queryKey: getGetTenantSettingsQueryKey() }); },
        onError: () => toast.error('Failed to save branding'),
      },
    );
  };

  const savePaymentReminders = () => {
    updateSettings.mutate(
      { data: { paymentRemindersEnabled, paymentReminderSchedule, paymentReminderChannels, stopServiceRuleEnabled, stopServiceThresholdDays: parseInt(stopServiceThresholdDays, 10) || 30 } as Parameters<typeof updateSettings.mutate>[0]['data'] },
      {
        onSuccess: () => { toast.success('Payment reminder settings saved'); qc.invalidateQueries({ queryKey: getGetTenantSettingsQueryKey() }); },
        onError: () => toast.error('Failed to save'),
      },
    );
  };

  const saveNotificationTemplates = () => {
    updateSettings.mutate(
      { data: { notificationTemplates } as Parameters<typeof updateSettings.mutate>[0]['data'] },
      {
        onSuccess: () => { toast.success('Notification templates saved'); qc.invalidateQueries({ queryKey: getGetTenantSettingsQueryKey() }); },
        onError: () => toast.error('Failed to save templates'),
      },
    );
  };

  const saveFollowupConfig = () => {
    updateFollowupTriggerConfig.mutate(
      { data: followupConfig },
      {
        onSuccess: () => { toast.success('Follow-up automation settings saved'); qc.invalidateQueries({ queryKey: getGetTenantSettingsQueryKey() }); },
        onError: () => toast.error('Failed to save'),
      },
    );
  };

  const saveReviews = () => {
    updateSettings.mutate(
      { data: { reviewRequestOnInvoicePaid, reviewRequestOnEstimateApproved, reviewGoogleUrl: reviewGoogleUrl || undefined, reviewFacebookUrl: reviewFacebookUrl || undefined, reviewCustomLink1Label: reviewCustomLink1Label || undefined, reviewCustomLink1Url: reviewCustomLink1Url || undefined, reviewCustomLink2Label: reviewCustomLink2Label || undefined, reviewCustomLink2Url: reviewCustomLink2Url || undefined } as Parameters<typeof updateSettings.mutate>[0]['data'] },
      {
        onSuccess: () => { toast.success('Review settings saved'); qc.invalidateQueries({ queryKey: getGetTenantSettingsQueryKey() }); },
        onError: () => toast.error('Failed to save'),
      },
    );
  };

  const saveGeneral = () => {
    updateSettings.mutate(
      { data: { companyName, timezone, taxRate: parseFloat(taxRate), overageMaterialBuffer: parseFloat(buffer), taxEnabled, callbackDueHoursHigh: parseInt(callbackDueHoursHigh, 10) || 4, callbackDueHoursNormal: parseInt(callbackDueHoursNormal, 10) || 24, callbackDueHoursLow: parseInt(callbackDueHoursLow, 10) || 72, renewalWarningDays: parseInt(renewalWarningDays, 10) || 30, callbackWarningThresholdPct: parseInt(callbackWarningThresholdPct, 10) || 10, cancellationFeeEnabled, cancellationFeeAmount: parseFloat(cancellationFeeAmount) || 0 } as Parameters<typeof updateSettings.mutate>[0]['data'] },
      {
        onSuccess: () => { toast.success('Settings saved'); qc.invalidateQueries({ queryKey: getGetTenantSettingsQueryKey() }); },
        onError: () => toast.error('Failed to save settings'),
      },
    );
  };

  const saveInvoicingDefaults = () => {
    updateSettings.mutate(
      { data: { invoiceDueDays: parseInt(invoiceDueDays, 10) || 0, invoiceDeliveryMode, autoInvoiceFrequency, nonRecurringInvoiceCadence } as Parameters<typeof updateSettings.mutate>[0]['data'] },
      {
        onSuccess: () => { toast.success('Invoicing settings saved'); qc.invalidateQueries({ queryKey: getGetTenantSettingsQueryKey() }); },
        onError: () => toast.error('Failed to save invoicing settings'),
      },
    );
  };

  const saveEstimateDefaults = () => {
    updateSettings.mutate(
      { data: { estimateExpiryDays: parseInt(estimateExpiryDays, 10) || 0 } as Parameters<typeof updateSettings.mutate>[0]['data'] },
      {
        onSuccess: () => { toast.success('Estimate defaults saved'); qc.invalidateQueries({ queryKey: getGetTenantSettingsQueryKey() }); },
        onError: () => toast.error('Failed to save estimate defaults'),
      },
    );
  };

  const saveInventoryPricing = () => {
    updateSettings.mutate(
      { data: { defaultMarkupPct: parseFloat(markupPct) || 20, showCostPriceToTech: showCostToTech } },
      {
        onSuccess: () => { toast.success('Pricing settings saved'); qc.invalidateQueries({ queryKey: getGetTenantSettingsQueryKey() }); },
        onError: () => toast.error('Failed to save pricing settings'),
      },
    );
  };

  const saveOperational = () => {
    updateSettings.mutate(
      { data: { durationUnit, ownersSchedulable, maxClockInHours: maxClockInHours ? parseFloat(maxClockInHours) : null, dailyTaskHourlyRate: parseFloat(dailyTaskHourlyRate) || 0, defaultOffSeasonStart: defaultOffSeasonStart || null, defaultOffSeasonEnd: defaultOffSeasonEnd || null } as Parameters<typeof updateSettings.mutate>[0]['data'] },
      {
        onSuccess: () => { toast.success('Operational settings saved'); qc.invalidateQueries({ queryKey: getGetTenantSettingsQueryKey() }); },
        onError: () => toast.error('Failed to save settings'),
      },
    );
  };

  const saveCustomerFields = (fields: CustomerFieldConfig[]) => {
    updateSettings.mutate(
      { data: { customerFields: fields } },
      {
        onSuccess: () => { toast.success('Customer fields updated'); qc.invalidateQueries({ queryKey: getGetTenantSettingsQueryKey() }); },
        onError: () => toast.error('Failed to save customer fields'),
      },
    );
  };

  const toggleFieldProp = (key: string, prop: 'visible' | 'required') => {
    const next = customerFields.map(f => f.key === key ? { ...f, [prop]: !f[prop] } : f);
    setCustomerFields(next);
    saveCustomerFields(next);
  };

  const removeCustomField = (key: string) => {
    const next = customerFields.filter(f => f.key !== key);
    setCustomerFields(next);
    saveCustomerFields(next);
  };

  const addCustomField = () => {
    if (!newField.label || !newField.key) { toast.error('Label and key are required'); return; }
    const options = newField.type === 'select' ? newOptions.split(',').map(s => s.trim()).filter(Boolean) : undefined;
    const field: CustomerFieldConfig = {
      key: newField.key!.replace(/\s+/g, '_').toLowerCase(),
      label: newField.label!,
      type: newField.type as CustomerFieldConfig['type'] ?? 'text',
      options,
      visible: true,
      required: newField.required ?? false,
      isBuiltIn: false,
    };
    if (customerFields.some(f => f.key === field.key)) { toast.error('A field with this key already exists'); return; }
    const next = [...customerFields, field];
    setCustomerFields(next);
    saveCustomerFields(next);
    setAddFieldOpen(false);
    setNewField({ type: 'text', visible: true, required: false, isBuiltIn: false });
    setNewOptions('');
  };

  const handleInvite = () => {
    if (!inviteForm.name || !inviteForm.email) { toast.error('Name and email are required'); return; }
    createUser.mutate(
      {
        data: {
          name: inviteForm.name,
          email: inviteForm.email,
          role: inviteForm.role,
          password: inviteForm.password || undefined,
          hourlyRate: inviteForm.hourlyRate ? parseFloat(inviteForm.hourlyRate) : undefined,
          hireDate: inviteForm.hireDate ? new Date(inviteForm.hireDate).toISOString() : undefined,
        } as Parameters<typeof createUser.mutate>[0]['data'],
      },
      {
        onSuccess: () => {
          toast.success(`${inviteForm.name} added`);
          qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
          setInviteOpen(false);
          setInviteForm({ name: '', email: '', role: 'technician', password: '', hourlyRate: '', hireDate: '' });
        },
        onError: () => toast.error('Failed to add user'),
      },
    );
  };

  const openEditUser = (u: { id: number; name: string; role: string; hourlyRate?: number | null; hireDate?: string | null }) => {
    setEditUserForm({
      id: u.id,
      name: u.name,
      role: u.role,
      hourlyRate: u.hourlyRate != null ? String(u.hourlyRate) : '',
      hireDate: u.hireDate ? u.hireDate.slice(0, 10) : '',
      applicatorLicense: (u as any).applicatorLicense ?? '',
    });
    setEditUserOpen(true);
  };

  const handleSaveEditUser = () => {
    if (!editUserForm) return;
    updateUser.mutate({
      id: editUserForm.id,
      data: {
        name: editUserForm.name,
        role: editUserForm.role,
        hourlyRate: editUserForm.hourlyRate ? parseFloat(editUserForm.hourlyRate) : null,
        hireDate: editUserForm.hireDate ? new Date(editUserForm.hireDate).toISOString() : null,
        applicatorLicense: editUserForm.applicatorLicense || null,
      } as Parameters<typeof updateUser.mutate>[0]['data'],
    }, {
      onSuccess: () => {
        toast.success('Team member updated');
        qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
        setEditUserOpen(false);
        setEditUserForm(null);
      },
      onError: () => toast.error('Failed to update user'),
    });
  };

  const toggleUserActive = (id: number, current: boolean) => {
    updateUser.mutate({ id, data: { isActive: !current } }, {
      onSuccess: () => {
        toast.success(current ? 'User deactivated' : 'User activated');
        qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
      },
      onError: () => toast.error('Failed to update user'),
    });
  };

  const [deleteUserPending, setDeleteUserPending] = useState<{ id: number; name: string } | null>(null);

  const handleDeleteUser = (id: number, name: string) => {
    setDeleteUserPending({ id, name });
  };

  const initialSettingsTab = (() => {
    const t = new URLSearchParams(window.location.search).get('tab') ?? 'general';
    if (t === 'payment-reminders') return 'invoicing';
    return t;
  })();

  // Legacy deep links to template tabs now open Finance
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t === 'invoice-templates') setLocation('/financials?tab=invoice-templates');
    else if (t === 'estimate-templates') setLocation('/estimates?tab=templates');
  }, [setLocation]);

  // Live sell price preview in inventory pricing card
  const sellPreview = (() => {
    const cost = 10; // example cost
    const m = parseFloat(markupPct);
    if (isNaN(m)) return null;
    return cost * (1 + m / 100);
  })();

  return (
    <div className="space-y-6 max-w-5xl mx-auto animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage company profile, integrations, and team access.</p>
      </div>

      <Tabs defaultValue={initialSettingsTab} className="w-full">
        <TabsList className="flex flex-wrap gap-1 h-auto mb-6">
          <TabsTrigger value="general"><Building className="w-4 h-4 mr-2" />General</TabsTrigger>
          <TabsTrigger value="customer-fields"><SettingsIcon className="w-4 h-4 mr-2" />Customer Fields</TabsTrigger>
          <TabsTrigger value="payments"><CreditCard className="w-4 h-4 mr-2" />Integrations</TabsTrigger>
          <TabsTrigger value="communications"><MessageSquare className="w-4 h-4 mr-2" />Communications</TabsTrigger>
          <TabsTrigger value="users"><Users className="w-4 h-4 mr-2" />Team</TabsTrigger>
          {isOwner && <TabsTrigger value="api-access"><Zap className="w-4 h-4 mr-2" />API & AI Access</TabsTrigger>}
          {isSuperAdmin && <TabsTrigger value="plans"><Shield className="w-4 h-4 mr-2" />Plans</TabsTrigger>}
          <TabsTrigger value="invoicing"><CreditCard className="w-4 h-4 mr-2" />Invoicing</TabsTrigger>
          <TabsTrigger value="estimates"><FileText className="w-4 h-4 mr-2" />Estimates</TabsTrigger>
          <TabsTrigger value="operational"><SettingsIcon className="w-4 h-4 mr-2" />Operational</TabsTrigger>
          <TabsTrigger value="measurements"><MapPin className="w-4 h-4 mr-2" />Maps & Quotes</TabsTrigger>
          <TabsTrigger value="branding"><ImageIcon className="w-4 h-4 mr-2" />Branding</TabsTrigger>
          <TabsTrigger value="followups"><PhoneMissedIcon className="w-4 h-4 mr-2" />Follow-Ups</TabsTrigger>
          <TabsTrigger value="notification-templates"><MessageSquare className="w-4 h-4 mr-2" />Msg Templates</TabsTrigger>
          <TabsTrigger value="reviews"><StarIcon className="w-4 h-4 mr-2" />Reviews</TabsTrigger>
          <TabsTrigger value="tags"><Tag className="w-4 h-4 mr-2" />Tags</TabsTrigger>
          <TabsTrigger value="skip-reasons"><SkipForward className="w-4 h-4 mr-2" />Skip Reasons</TabsTrigger>
          {isOwner && <TabsTrigger value="roles"><Shield className="w-4 h-4 mr-2" />Roles</TabsTrigger>}
          {isOwner && <TabsTrigger value="advanced"><Shield className="w-4 h-4 mr-2" />Advanced</TabsTrigger>}
        </TabsList>

        {/* ── General ── */}
        <TabsContent value="general" className="space-y-6 focus-visible:outline-none">
          <Card>
            <CardHeader>
              <CardTitle>Company Profile</CardTitle>
              <CardDescription>Your public company information shown on invoices.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Company Name</label>
                  <Input title="Your company or business name" value={companyName} onChange={e => setCompanyName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Timezone</label>
                  <Input title="Timezone used for scheduling and date display (e.g. America/New_York)" value={timezone} onChange={e => setTimezone(e.target.value)} />
                </div>
              </div>
              <Button onClick={saveGeneral} disabled={updateSettings.isPending}>
                {updateSettings.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Customer Portal</CardTitle>
              <CardDescription>
                Share this link with your customers so they can view invoices, jobs, and account details.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <div className="flex-1 relative">
                  <Input
                    readOnly
                    value={`${window.location.origin}/portal/?tenant=${settings?.slug ?? user?.tenantId ?? 1}`}
                    className="pr-10 font-mono text-sm bg-muted"
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}/portal/?tenant=${settings?.slug ?? user?.tenantId ?? 1}`);
                    toast.success('Portal link copied to clipboard');
                  }}
                >
                  <Copy className="w-4 h-4 mr-1.5" />
                  Copy
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => window.open(`/portal/?tenant=${settings?.slug ?? user?.tenantId ?? 1}`, '_blank')}
                >
                  <ExternalLink className="w-4 h-4 mr-1.5" />
                  Open
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Customers log in with the email and phone number you have on file for them.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Operational Defaults</CardTitle></CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Default Tax Rate (%)</label>
                  <Input type="number" min={0} step={0.1} title="Default sales tax rate applied to new estimates and invoices" value={taxRate} onChange={e => setTaxRate(e.target.value)} disabled={!taxEnabled} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Default Material Buffer (%)</label>
                  <Input type="number" title="Percentage markup added to material costs on estimates" value={buffer} onChange={e => setBuffer(e.target.value)} />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">Charge Sales Tax</p>
                  <p className="text-xs text-muted-foreground mt-0.5">When off, tax is hidden from all estimates, invoices, and revenue reports.</p>
                </div>
                <Switch checked={taxEnabled} onCheckedChange={setTaxEnabled} />
              </div>
              <div className="grid grid-cols-2 gap-4 pt-2 border-t">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Plan Renewal Warning (days)</label>
                  <p className="text-xs text-muted-foreground">Plans expiring within this window are flagged as "expiring soon" on the Plans dashboard.</p>
                  <div className="flex items-center gap-1">
                    <Input type="number" min={1} value={renewalWarningDays} onChange={e => setRenewalWarningDays(e.target.value)} className="w-20" />
                    <span className="text-xs text-muted-foreground">days</span>
                  </div>
                </div>
              </div>
              <div className="pt-2 border-t space-y-3">
                <div>
                  <p className="text-sm font-medium">Cancellation Fee</p>
                  <p className="text-xs text-muted-foreground">Automatically create a draft charge invoice when a customer cancels a job via the portal within the allowed window.</p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={cancellationFeeEnabled}
                    title={cancellationFeeEnabled ? 'Disable cancellation fee' : 'Enable cancellation fee'}
                    onClick={() => setCancellationFeeEnabled(v => !v)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:outline-none ${cancellationFeeEnabled ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${cancellationFeeEnabled ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
                  </button>
                  <span className="text-sm">{cancellationFeeEnabled ? 'Enabled' : 'Disabled'}</span>
                </div>
                {cancellationFeeEnabled && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Fee amount:</span>
                    <div className="flex items-center gap-1">
                      <span className="text-sm text-muted-foreground">$</span>
                      <Input type="number" min={0} step={0.01} value={cancellationFeeAmount} onChange={e => setCancellationFeeAmount(e.target.value)} className="w-24" placeholder="0.00" />
                    </div>
                    <p className="text-xs text-muted-foreground">A draft invoice for this amount is created when a customer cancels via the portal.</p>
                  </div>
                )}
              </div>
              <div className="space-y-3 pt-2 border-t">
                <div>
                  <p className="text-sm font-medium">Callback Due-Time Defaults</p>
                  <p className="text-xs text-muted-foreground">Hours from today a callback fix must be completed, by priority.</p>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-red-600">🔴 High</label>
                    <div className="flex items-center gap-1">
                      <Input type="number" min={1} value={callbackDueHoursHigh} onChange={e => setCallbackDueHoursHigh(e.target.value)} className="w-16 text-sm" />
                      <span className="text-xs text-muted-foreground">hrs</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-amber-600">🟡 Normal</label>
                    <div className="flex items-center gap-1">
                      <Input type="number" min={1} value={callbackDueHoursNormal} onChange={e => setCallbackDueHoursNormal(e.target.value)} className="w-16 text-sm" />
                      <span className="text-xs text-muted-foreground">hrs</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">⚪ Low</label>
                    <div className="flex items-center gap-1">
                      <Input type="number" min={1} value={callbackDueHoursLow} onChange={e => setCallbackDueHoursLow(e.target.value)} className="w-16 text-sm" />
                      <span className="text-xs text-muted-foreground">hrs</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="space-y-2 pt-2 border-t">
                <p className="text-sm font-medium">Callback Warning Threshold</p>
                <p className="text-xs text-muted-foreground">Technicians with a callback ratio above this percentage will be flagged on the callbacks page.</p>
                <div className="flex items-center gap-2">
                  <Input type="number" min={1} max={100} value={callbackWarningThresholdPct} onChange={e => setCallbackWarningThresholdPct(e.target.value)} className="w-20" />
                  <span className="text-xs text-muted-foreground">%</span>
                </div>
              </div>
              <Button onClick={saveGeneral} disabled={updateSettings.isPending} variant="outline">Save Defaults</Button>
            </CardContent>
          </Card>

          {/* Inventory Pricing */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><TrendingUp className="w-5 h-5" /> Inventory Pricing</CardTitle>
              <CardDescription>
                Set your standard markup on parts. The sell price shown to customers is calculated as:
                Buy Price × (1 + Markup %).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Default Markup (%)</label>
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    title="Default markup percentage applied to inventory item cost prices"
                    value={markupPct}
                    onChange={e => setMarkupPct(e.target.value)}
                    placeholder="20"
                  />
                  <p className="text-xs text-muted-foreground">Applied when adding a new item unless overridden per-item.</p>
                </div>

                {/* Live preview */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Preview (on $10.00 cost)</label>
                  <div className="flex items-center gap-2 rounded-lg border px-3 py-2 bg-muted/30 text-sm h-10">
                    <span className="text-muted-foreground">$10.00</span>
                    <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="font-semibold text-primary">
                      {sellPreview != null ? `$${sellPreview.toFixed(2)}` : '—'}
                    </span>
                  </div>
                </div>
              </div>

              <Separator />

              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <p className="text-sm font-medium">Show buy price to technicians</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    When off, technicians only see the sell price — not what you paid for an item.
                  </p>
                </div>
                <Switch
                  title={showCostToTech ? 'Technicians can see item cost prices — click to hide' : 'Technicians cannot see cost prices — click to allow'}
                  checked={showCostToTech}
                  onCheckedChange={v => setShowCostToTech(v)}
                />
              </div>

              <Button onClick={saveInventoryPricing} disabled={updateSettings.isPending} variant="outline">
                Save Pricing Settings
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Customer Fields ── */}
        <TabsContent value="customer-fields" className="space-y-6 focus-visible:outline-none">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between pb-2">
              <div>
                <CardTitle>Customer Form Fields</CardTitle>
                <CardDescription>
                  Control which fields appear on customer forms. Toggle visibility and required status for each field.
                  Core fields (Name, Email, Phone) are always required.
                </CardDescription>
              </div>
              <Button size="sm" title="Add a new custom field to customer forms" onClick={() => setAddFieldOpen(true)} className="gap-2 shrink-0 ml-4">
                <Plus className="w-4 h-4" /> Add Custom Field
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center gap-6 text-xs text-muted-foreground py-2 border-b mb-3">
                <div className="flex items-center gap-1.5"><Eye className="w-3 h-3" /> Visible on form</div>
                <div className="flex items-center gap-1.5"><Star className="w-3 h-3" /> Required to submit</div>
                <div className="flex items-center gap-1.5"><Badge variant="outline" className="text-[10px] px-1">Built-in</Badge> Cannot be deleted</div>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-2 py-1">All Fields</p>
                {customerFields.map(field => (
                  (() => {
                    const isCore = (CORE_FIELD_KEYS as readonly string[]).includes(field.key);
                    return (
                      <div
                        key={field.key}
                        className={`flex items-center gap-4 px-3 py-2.5 rounded-lg border transition-colors ${field.visible ? 'bg-background' : 'bg-muted/20 opacity-60'}`}
                      >
                        {isCore
                          ? <div className="w-4 h-4 shrink-0" />
                          : <GripVertical className="w-4 h-4 text-muted-foreground/40 cursor-grab shrink-0" />}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm" title={field.label}>{field.label}</span>
                            {field.isBuiltIn && <Badge variant="outline" className="text-[10px] px-1" title="Built-in field — cannot be deleted">Built-in</Badge>}
                            {isCore && <Badge className="text-[10px] px-1 bg-blue-50 text-blue-700 border-blue-200" variant="outline" title="Always shown — only required status is configurable">Always visible</Badge>}
                            {!isCore && <span className="text-xs text-muted-foreground capitalize" title={`Field type: ${field.type}`}>{field.type}</span>}
                          </div>
                        </div>
                        <div
                          className="flex items-center gap-1.5 shrink-0"
                          title={isCore ? 'Core fields are always visible and cannot be hidden' : (field.visible ? 'Field is visible on customer records' : 'Field is hidden from customer records')}
                        >
                          {field.visible ? <Eye className="w-3.5 h-3.5 text-muted-foreground" /> : <EyeOff className="w-3.5 h-3.5 text-muted-foreground/40" />}
                          <Switch checked={field.visible} disabled={isCore} onCheckedChange={() => !isCore && toggleFieldProp(field.key, 'visible')} />
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0" title={field.required ? 'Field is required when creating customers' : 'Field is optional — staff can leave it blank'}>
                          <Star className={`w-3.5 h-3.5 ${field.required ? 'text-amber-500' : 'text-muted-foreground/40'}`} />
                          <Switch checked={field.required} disabled={!field.visible} onCheckedChange={() => toggleFieldProp(field.key, 'required')} />
                        </div>
                        {!field.isBuiltIn ? (
                          <Button variant="ghost" size="icon" className="w-8 h-8 text-muted-foreground hover:text-destructive" title="Delete this custom field" onClick={() => removeCustomField(field.key)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        ) : <div className="w-8" />}
                      </div>
                    );
                  })()
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Add custom field sheet */}
          <Sheet open={addFieldOpen} onOpenChange={setAddFieldOpen}>
            <SheetContent className="w-full sm:max-w-md">
              <SheetHeader className="pb-4">
                <SheetTitle>Add Custom Field</SheetTitle>
                <SheetDescription>This field will appear on all customer forms for your team.</SheetDescription>
              </SheetHeader>
              <div className="space-y-4 pb-6">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Field Label <span className="text-destructive">*</span></label>
                  <Input
                    title="Human-readable label shown on customer forms"
                    placeholder="e.g. License Number"
                    value={newField.label ?? ''}
                    onChange={e => setNewField(f => ({ ...f, label: e.target.value, key: e.target.value.replace(/\s+/g, '_').toLowerCase() }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Field Key <span className="text-destructive">*</span></label>
                  <Input
                    title="Unique machine key — lowercase with underscores only"
                    placeholder="license_number"
                    value={newField.key ?? ''}
                    onChange={e => setNewField(f => ({ ...f, key: e.target.value }))}
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">Unique identifier. Lowercase, underscores only.</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Field Type</label>
                  <Select value={newField.type} onValueChange={v => setNewField(f => ({ ...f, type: v as CustomerFieldConfig['type'] }))}>
                    <SelectTrigger title="Data type for this custom field — determines how it renders on forms"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="text">Text</SelectItem>
                      <SelectItem value="number">Number</SelectItem>
                      <SelectItem value="date">Date</SelectItem>
                      <SelectItem value="textarea">Long Text</SelectItem>
                      <SelectItem value="select">Dropdown</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {newField.type === 'select' && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Options <span className="text-destructive">*</span></label>
                    <Input title="Comma-separated list of dropdown options for this field" placeholder="Option 1, Option 2, Option 3" value={newOptions} onChange={e => setNewOptions(e.target.value)} />
                    <p className="text-xs text-muted-foreground">Comma-separated list of dropdown options.</p>
                  </div>
                )}
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">Required field</p>
                    <p className="text-xs text-muted-foreground">Team must fill this in to save a customer</p>
                  </div>
                  <Switch title={newField.required ? 'Field is required — uncheck to make it optional' : 'Field is optional — check to make it required'} checked={newField.required ?? false} onCheckedChange={v => setNewField(f => ({ ...f, required: v }))} />
                </div>
                <Separator />
                <div className="flex gap-3 justify-end">
                  <Button variant="outline" onClick={() => setAddFieldOpen(false)}>Cancel</Button>
                  <Button title="Save this custom field and add it to customer forms" onClick={addCustomField}>Add Field</Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </TabsContent>

        {/* ── Maps & Quotes ── */}
        <TabsContent value="measurements" className="space-y-6 focus-visible:outline-none">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Navigation className="w-5 h-5 text-primary" /> Geofence Defaults
              </CardTitle>
              <CardDescription>
                Default geofence settings applied when a new property is added.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Default Radius</label>
                  <Input
                    type="number"
                    min={10}
                    title="Default geofence radius applied when a new property is added"
                    value={defaultGeofenceRadius}
                    onChange={e => setDefaultGeofenceRadius(e.target.value)}
                    placeholder="100"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Unit</label>
                  <Select value={defaultGeofenceUnit} onValueChange={v => setDefaultGeofenceUnit(v as 'm' | 'ft')}>
                    <SelectTrigger title="Unit of measurement for the geofence radius"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="m">Meters (m)</SelectItem>
                      <SelectItem value="ft">Feet (ft)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <p className="text-sm font-medium">Auto-create geofence on new property</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Automatically creates a geofence using the property's geocoded location when a property is added.
                  </p>
                </div>
                <Switch checked={autoCreateGeofence} onCheckedChange={setAutoCreateGeofence} />
              </div>
              <Button
                onClick={() => updateSettings.mutate(
                  { data: { defaultGeofenceRadius: parseInt(defaultGeofenceRadius, 10) || 100, defaultGeofenceUnit, autoCreateGeofence } as Parameters<typeof updateSettings.mutate>[0]['data'] },
                  { onSuccess: () => toast.success('Geofence defaults saved'), onError: () => toast.error('Failed to save') }
                )}
                disabled={updateSettings.isPending}
                variant="outline"
              >
                Save Geofence Defaults
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Ruler className="w-5 h-5 text-primary" /> Measurement Defaults
              </CardTitle>
              <CardDescription>
                Control how measurements and satellite map zones work across all properties.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Preferred Area Unit</label>
                <Select value={preferredAreaUnit} onValueChange={v => setPreferredAreaUnit(v as 'sqft' | 'acres')}>
                  <SelectTrigger className="max-w-[200px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sqft">Square Feet (sqft)</SelectItem>
                    <SelectItem value="acres">Acres</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Zone Type Manager */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Zone Types</label>
                  <Button
                    size="sm"
                    variant="outline"
                    title="Add a new zone type with a default color"
                    className="gap-1 text-xs h-7"
                    onClick={() => {
                      const ZONE_COLORS = ['#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6','#06B6D4','#84CC16','#F97316','#EC4899','#6366F1'];
                      const color = ZONE_COLORS[zoneTypes.length % ZONE_COLORS.length];
                      setZoneTypes(z => [...z, { id: crypto.randomUUID(), name: 'New Zone', color, mode: 'area' as const }]);
                    }}
                  >
                    <Plus className="w-3 h-3" /> Add Zone Type
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Define the zone types available when drawing measurement areas on the satellite map. Each type gets a unique color.
                  Set a type's mode to <span className="font-medium">Linear</span> for fence lines, edging, or hedges measured in feet
                  instead of square feet.
                </p>
                <div className="space-y-2">
                  {zoneTypes.map((zt, idx) => (
                    <div key={zt.id} className="flex items-center gap-2 p-2 border rounded-lg bg-muted/20">
                      {/* Color swatch / picker */}
                      <div className="relative shrink-0">
                        <div
                          className="w-7 h-7 rounded-md border-2 border-white shadow-sm cursor-pointer ring-1 ring-border"
                          title={`Zone color: ${zt.color} — click to change`}
                          style={{ backgroundColor: zt.color }}
                          onClick={() => document.getElementById(`color-picker-${zt.id}`)?.click()}
                        />
                        <input
                          id={`color-picker-${zt.id}`}
                          type="color"
                          value={zt.color}
                          className="absolute inset-0 opacity-0 w-7 h-7 cursor-pointer"
                          onChange={e => setZoneTypes(z => z.map(z2 => z2.id === zt.id ? { ...z2, color: e.target.value } : z2))}
                        />
                      </div>
                      {/* Name input */}
                      <Input
                        className="h-8 text-sm flex-1"
                        title="Zone type name (e.g. Front Lawn, Backyard, Bed)"
                        value={zt.name}
                        onChange={e => setZoneTypes(z => z.map(z2 => z2.id === zt.id ? { ...z2, name: e.target.value } : z2))}
                        placeholder="Zone name"
                      />
                      {/* Mode toggle: area vs linear */}
                      <div className="flex items-center rounded-md border overflow-hidden shrink-0" title="Whether this zone type is measured as an area (polygon) or a length (line)">
                        <button
                          type="button"
                          className={`px-2 py-1 text-xs font-medium transition ${(zt.mode ?? 'area') === 'area' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                          onClick={() => setZoneTypes(z => z.map(z2 => z2.id === zt.id ? { ...z2, mode: 'area' as const } : z2))}
                        >
                          Area
                        </button>
                        <button
                          type="button"
                          className={`px-2 py-1 text-xs font-medium transition ${zt.mode === 'linear' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                          onClick={() => setZoneTypes(z => z.map(z2 => z2.id === zt.id ? { ...z2, mode: 'linear' as const } : z2))}
                        >
                          Linear
                        </button>
                      </div>
                      {/* Move up */}
                      <button
                        className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 transition"
                        disabled={idx === 0}
                        title="Move up"
                        onClick={() => setZoneTypes(z => {
                          const next = [...z];
                          [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                          return next;
                        })}
                      >
                        ↑
                      </button>
                      {/* Move down */}
                      <button
                        className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 transition"
                        disabled={idx === zoneTypes.length - 1}
                        title="Move down"
                        onClick={() => setZoneTypes(z => {
                          const next = [...z];
                          [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                          return next;
                        })}
                      >
                        ↓
                      </button>
                      {/* Delete */}
                      <button
                        className="p-1 text-muted-foreground hover:text-destructive disabled:opacity-30 transition"
                        disabled={zoneTypes.length <= 1}
                        title="Delete zone type"
                        onClick={() => setZoneTypes(z => z.filter(z2 => z2.id !== zt.id))}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>

              </div>

              <Button
                title="Save measurement settings and zone type definitions"
                onClick={() => {
                  const validZoneTypes = zoneTypes.filter(z => z.name.trim()).map(z => ({ ...z, mode: z.mode ?? 'area' as const }));
                  updateSettings.mutate(
                    { data: { preferredAreaUnit, measurementZoneTypes: validZoneTypes } as Parameters<typeof updateSettings.mutate>[0]['data'] },
                    { onSuccess: () => toast.success('Measurement settings saved'), onError: () => toast.error('Failed to save') }
                  );
                }}
                disabled={updateSettings.isPending}
                variant="outline"
              >
                Save Measurement Settings
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="w-5 h-5 text-primary" /> Website Widget
              </CardTitle>
              <CardDescription>
                Embed an instant-quote widget on your company website. Prospects enter an address, pick a service, and submit a quote request — all without calling in.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-md bg-muted/50 border p-3 font-mono text-xs overflow-x-auto whitespace-nowrap">
                {`<iframe src="${window.location.origin}${import.meta.env.BASE_URL?.replace(/\/$/, '') ?? ''}/widget/quote" width="420" height="600" frameborder="0" style="border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,0.12)"></iframe>`}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2 text-xs"
                  onClick={() => {
                    const snippet = `<iframe src="${window.location.origin}${import.meta.env.BASE_URL?.replace(/\/$/, '') ?? ''}/widget/quote" width="420" height="600" frameborder="0" style="border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,0.12)"></iframe>`;
                    navigator.clipboard.writeText(snippet).then(() => toast.success('Widget code copied!'));
                  }}
                >
                  Copy Widget Code
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2 text-xs"
                  onClick={() => window.open(`${import.meta.env.BASE_URL?.replace(/\/$/, '') ?? ''}/widget/quote`, '_blank')}
                >
                  Preview Widget
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Integrations ── */}
        <TabsContent value="payments" className="space-y-6 focus-visible:outline-none">
          <Card>
            <CardHeader>
              <CardTitle>Payment Processing</CardTitle>
              <CardDescription>Connect Stripe to accept credit cards on invoices.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-[#635BFF]/10 rounded-xl flex items-center justify-center">
                    <span className="text-[#635BFF] font-bold text-xl">S</span>
                  </div>
                  <div>
                    <h3 className="font-semibold text-[#635BFF]">Stripe</h3>
                    <p className="text-sm text-muted-foreground">Accept credit cards and ACH</p>
                  </div>
                </div>
                <Switch title={settings?.stripeEnabled ? 'Stripe is enabled — click to disable credit card and ACH payments' : 'Enable Stripe to accept credit card and ACH payments'} checked={settings?.stripeEnabled} onCheckedChange={v => updateSettings.mutate({ data: { stripeEnabled: v } }, { onSuccess: () => qc.invalidateQueries({ queryKey: getGetTenantSettingsQueryKey() }) })} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Accounting</CardTitle>
              <CardDescription>Push invoices and customer data to QuickBooks automatically.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-[#2CA01C]/10 rounded-xl flex items-center justify-center">
                    <span className="text-[#2CA01C] font-bold text-xl">QB</span>
                  </div>
                  <div>
                    <h3 className="font-semibold text-[#2CA01C]">QuickBooks Online</h3>
                    <p className="text-sm text-muted-foreground">
                      One-way push — this app sends to QuickBooks
                    </p>
                  </div>
                </div>
                <Switch title={settings?.quickbooksEnabled ? 'QuickBooks sync is enabled — click to disable' : 'Enable to push invoices and customers to QuickBooks'} checked={settings?.quickbooksEnabled} onCheckedChange={v => updateSettings.mutate({ data: { quickbooksEnabled: v } }, { onSuccess: () => qc.invalidateQueries({ queryKey: getGetTenantSettingsQueryKey() }) })} />
              </div>

              {settings?.quickbooksEnabled && (
                <div className="rounded-lg bg-muted/40 border border-dashed p-4 text-sm space-y-2">
                  <p className="font-medium">What gets pushed to QuickBooks:</p>
                  <ul className="space-y-1 text-muted-foreground text-xs list-disc list-inside">
                    <li>New and updated invoices (status, line items, totals)</li>
                    <li>Customer names and contact info</li>
                    <li>Payments marked as Paid</li>
                  </ul>
                  <p className="text-xs text-muted-foreground pt-1">
                    Data flows one-way: changes made in QuickBooks do not sync back here.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <IntegrationsGrid />
        </TabsContent>

        {/* ── Communications ── */}
        <TabsContent value="communications" className="space-y-6 focus-visible:outline-none">
          {/* Phone Numbers */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Phone className="w-5 h-5" /> Phone Numbers</CardTitle>
              <CardDescription>
                Configure the phone numbers used for outbound messages. The main number is used for service reminders; the marketing number for campaigns.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Main Number <span className="text-xs text-muted-foreground">(reminders & transactional)</span></label>
                  <Input
                    title="Primary phone number used for transactional SMS and service reminders"
                    placeholder="+15551234567"
                    value={mainPhoneNumber}
                    onChange={e => setMainPhoneNumber(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Marketing Number <span className="text-xs text-muted-foreground">(campaigns)</span></label>
                  <Input
                    title="Marketing phone number used for broadcast campaigns"
                    placeholder="+15559876543"
                    value={marketingPhoneNumber}
                    onChange={e => setMarketingPhoneNumber(e.target.value)}
                  />
                </div>
              </div>
              <Button
                variant="outline"
                disabled={updateSettings.isPending}
                onClick={() => updateSettings.mutate(
                  { data: { mainPhoneNumber, marketingPhoneNumber } as any },
                  { onSuccess: () => toast.success('Phone numbers saved'), onError: () => toast.error('Failed to save') }
                )}
              >
                Save Phone Numbers
              </Button>
            </CardContent>
          </Card>

          {/* SMS Provider */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><MessageSquare className="w-5 h-5" /> SMS Provider</CardTitle>
              <CardDescription>
                Connect a business phone platform to send SMS. Once connected, outbound messages route through the selected provider. Inbound replies are logged automatically via webhook.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Platform</label>
                <Select value={phonePlatform || 'none'} onValueChange={v => setPhonePlatform(v === 'none' ? '' : v)}>
                  <SelectTrigger className="max-w-xs">
                    <SelectValue placeholder="Not connected" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not connected (dev mode)</SelectItem>
                    <SelectItem value="openphone">OpenPhone</SelectItem>
                    <SelectItem value="quo">Quo</SelectItem>
                    <SelectItem value="grasshopper">Grasshopper</SelectItem>
                    <SelectItem value="twilio">Twilio</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {phonePlatform === 'quo' && (
                <div className="rounded-lg border p-4 space-y-3 bg-muted/20">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <div className="w-6 h-6 rounded bg-indigo-600 flex items-center justify-center text-white text-xs font-bold">Q</div>
                    Quo Configuration
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">API Key</label>
                    <Input
                      type="password"
                      placeholder={phonePlatformApiKey.startsWith('••') ? '(saved)' : 'Enter Quo API key'}
                      value={phonePlatformApiKey}
                      onChange={e => setPhonePlatformApiKey(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Quo → Workspace Settings → API → Generate API key</p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Phone Number ID</label>
                    <Input
                      placeholder="PN123abc"
                      value={quoPhoneNumberId}
                      onChange={e => setQuoPhoneNumberId(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">The Quo number this tenant sends/receives from — needed to pull calls for the Calls tab.</p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Webhook Signing Key</label>
                    <Input
                      type="password"
                      placeholder={phonePlatformWebhookSecret.startsWith('••') ? '(saved)' : 'whsec_...'}
                      value={phonePlatformWebhookSecret}
                      onChange={e => setPhonePlatformWebhookSecret(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Returned when you create a webhook in Quo. Required to verify inbound call/message events.</p>
                  </div>
                  <div className="rounded-md bg-blue-50 border border-blue-200 p-3 text-xs text-blue-800 space-y-1">
                    <p className="font-medium">Webhook URL for inbound calls & messages:</p>
                    <code className="block font-mono break-all">{`${window.location.origin}/api/communications/webhook`}</code>
                    <p className="text-blue-700">Create webhooks for "message.received" and call events pointing at this URL in Quo → API → Webhooks.</p>
                  </div>
                </div>
              )}

              {phonePlatform === 'openphone' && (
                <div className="rounded-lg border p-4 space-y-3 bg-muted/20">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <div className="w-6 h-6 rounded bg-violet-600 flex items-center justify-center text-white text-xs font-bold">OP</div>
                    OpenPhone Configuration
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">API Key</label>
                    <Input
                      type="password"
                      placeholder={phonePlatformApiKey.startsWith('••') ? '(saved)' : 'Enter OpenPhone API key'}
                      value={phonePlatformApiKey}
                      onChange={e => setPhonePlatformApiKey(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Find in OpenPhone → Settings → API keys</p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Webhook Signing Secret</label>
                    <Input
                      type="password"
                      placeholder={phonePlatformWebhookSecret.startsWith('••') ? '(saved)' : 'Enter OpenPhone webhook secret'}
                      value={phonePlatformWebhookSecret}
                      onChange={e => setPhonePlatformWebhookSecret(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Found in OpenPhone → Settings → Webhooks → Signing secret. Required to verify inbound messages.</p>
                  </div>
                  <div className="rounded-md bg-blue-50 border border-blue-200 p-3 text-xs text-blue-800 space-y-1">
                    <p className="font-medium">Webhook URL for inbound messages:</p>
                    <code className="block font-mono break-all">{`${window.location.origin}/api/communications/webhook`}</code>
                    <p className="text-blue-700">Add this URL in OpenPhone → Settings → Webhooks → Message received</p>
                  </div>
                </div>
              )}

              {(phonePlatform === 'grasshopper' || phonePlatform === 'twilio') && (
                <div className="rounded-lg border p-4 space-y-3 bg-muted/20">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <div className={`w-6 h-6 rounded flex items-center justify-center text-white text-xs font-bold ${phonePlatform === 'grasshopper' ? 'bg-green-600' : 'bg-red-600'}`}>
                      {phonePlatform === 'grasshopper' ? 'GH' : 'TW'}
                    </div>
                    {phonePlatform === 'grasshopper' ? 'Grasshopper' : 'Twilio'} Configuration
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">Account SID</label>
                      <Input
                        placeholder="ACxxxxxxxx"
                        value={phonePlatformAccountSid}
                        onChange={e => setPhonePlatformAccountSid(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">Auth Token</label>
                      <Input
                        type="password"
                        placeholder="(saved)"
                        value={phonePlatformAuthToken}
                        onChange={e => setPhonePlatformAuthToken(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="rounded-md bg-blue-50 border border-blue-200 p-3 text-xs text-blue-800 space-y-1">
                    <p className="font-medium">Webhook URL for inbound messages:</p>
                    <code className="block font-mono break-all">{`${window.location.origin}/api/communications/webhook`}</code>
                    <p className="text-blue-700">Configure this as your messaging webhook in {phonePlatform === 'grasshopper' ? 'Grasshopper' : 'Twilio'} console</p>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2">
                {(settings as any)?.phonePlatform ? (
                  <Badge className="bg-emerald-500/10 text-emerald-700 border-transparent gap-1">
                    <CheckCircle className="w-3 h-3" /> Connected — {(settings as any).phonePlatform}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground gap-1">
                    <WifiOff className="w-3 h-3" /> Not connected — SMS will be logged to console
                  </Badge>
                )}
              </div>

              <Button
                variant="outline"
                disabled={updateSettings.isPending}
                onClick={() => updateSettings.mutate(
                  {
                    data: {
                      phonePlatform: phonePlatform || null,
                      phonePlatformConfig: {
                        apiKey: phonePlatformApiKey,
                        accountSid: phonePlatformAccountSid,
                        authToken: phonePlatformAuthToken,
                        webhookSecret: phonePlatformWebhookSecret,
                        quoPhoneNumberId: quoPhoneNumberId,
                      },
                    } as any
                  },
                  {
                    onSuccess: () => { toast.success('SMS provider saved'); },
                    onError: () => toast.error('Failed to save'),
                  }
                )}
              >
                Save SMS Provider
              </Button>
            </CardContent>
          </Card>

          {/* Email Provider */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Mail className="w-5 h-5" /> Email Provider</CardTitle>
              <CardDescription>
                Connect a transactional email provider to send service reminders and messages from your own domain.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Provider</label>
                <Select value={emailProvider || 'none'} onValueChange={v => setEmailProvider(v === 'none' ? '' : v)}>
                  <SelectTrigger className="max-w-xs">
                    <SelectValue placeholder="Not connected" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not connected (dev mode)</SelectItem>
                    <SelectItem value="gmail">Google / Gmail</SelectItem>
                    <SelectItem value="resend">Resend</SelectItem>
                    <SelectItem value="sendgrid">SendGrid</SelectItem>
                    <SelectItem value="mailgun">Mailgun</SelectItem>
                    <SelectItem value="smtp">SMTP</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {emailProvider === 'gmail' && (
                <div className="rounded-lg border p-4 space-y-3 bg-muted/20">
                  <p className="text-sm text-muted-foreground">
                    Sign in with the Google account you want to send from — no API key or password needed. Transactional emails (estimates, invoices, reminders) will be sent from that account.
                  </p>
                  {gmailConnected ? (
                    <div className="flex items-center justify-between gap-3 rounded-lg border bg-background p-3">
                      <div className="flex items-center gap-2">
                        <Badge className="bg-emerald-500/10 text-emerald-700 border-transparent gap-1">
                          <CheckCircle className="w-3 h-3" /> Connected
                        </Badge>
                        <span className="text-sm font-medium">{gmailEmail}</span>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        disabled={disconnectGmail.isPending}
                        onClick={() => disconnectGmail.mutate()}
                      >
                        Disconnect
                      </Button>
                    </div>
                  ) : (
                    <Button variant="outline" onClick={handleGmailConnect} disabled={gmailAuthorizeUrl.isFetching} className="gap-2">
                      <Mail className="w-4 h-4" /> {gmailAuthorizeUrl.isFetching ? 'Redirecting...' : 'Connect Google Account'}
                    </Button>
                  )}
                  <div className="space-y-1.5 pt-1">
                    <label className="text-sm font-medium">Sender Display Name</label>
                    <Input
                      placeholder="e.g. Mike's Lawn Care"
                      value={gmailSenderName}
                      onChange={e => setGmailSenderName(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Customers will see "Mike's Lawn Care &lt;{gmailEmail || 'you@gmail.com'}&gt;" instead of just your email address. Leave blank to show only the address.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={updateSettings.isPending}
                    onClick={() => updateSettings.mutate(
                      { data: { emailProvider: 'gmail', emailProviderConfig: { gmailSenderName } } as any },
                      {
                        onSuccess: () => { toast.success('Gmail sender name saved'); qc.invalidateQueries({ queryKey: getGetTenantSettingsQueryKey() }); },
                        onError: () => toast.error('Failed to save'),
                      }
                    )}
                  >
                    Save Sender Name
                  </Button>
                </div>
              )}

              {emailProvider && emailProvider !== 'smtp' && emailProvider !== 'gmail' && (
                <div className="rounded-lg border p-4 space-y-3 bg-muted/20">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">API Key</label>
                    <Input
                      type="password"
                      placeholder={emailApiKey.startsWith('••') ? '(saved)' : `Enter ${emailProvider} API key`}
                      value={emailApiKey}
                      onChange={e => setEmailApiKey(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">From Address</label>
                    <Input
                      placeholder="noreply@yourcompany.com"
                      value={emailFromAddress}
                      onChange={e => setEmailFromAddress(e.target.value)}
                    />
                  </div>
                  {emailProvider === 'mailgun' && (
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">Mailgun Domain</label>
                      <Input
                        placeholder="mg.yourcompany.com"
                        value={emailDomain}
                        onChange={e => setEmailDomain(e.target.value)}
                      />
                    </div>
                  )}
                </div>
              )}

              {emailProvider === 'smtp' && (
                <div className="rounded-lg border p-4 space-y-3 bg-muted/20">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">SMTP Host</label>
                      <Input
                        placeholder="smtp.mailserver.com"
                        value={smtpHost}
                        onChange={e => setSmtpHost(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">Port</label>
                      <Input
                        placeholder="587"
                        value={smtpPort}
                        onChange={e => setSmtpPort(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">Username</label>
                      <Input
                        placeholder="smtp-user@yourcompany.com"
                        value={smtpUser}
                        onChange={e => setSmtpUser(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">Password</label>
                      <Input
                        type="password"
                        placeholder={smtpPass.startsWith('••') ? '(saved)' : 'SMTP password'}
                        value={smtpPass}
                        onChange={e => setSmtpPass(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">From Address</label>
                    <Input
                      placeholder="noreply@yourcompany.com"
                      value={emailFromAddress}
                      onChange={e => setEmailFromAddress(e.target.value)}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">Port 465 uses TLS; 587 uses STARTTLS (recommended).</p>
                </div>
              )}

              <div className="flex flex-col gap-2">
                {(settings as any)?.emailProvider ? (
                  <Badge className="bg-emerald-500/10 text-emerald-700 border-transparent gap-1 w-fit">
                    <CheckCircle className="w-3 h-3" /> Connected — {(settings as any).emailProvider === 'gmail' ? 'Google / Gmail' : (settings as any).emailProvider}
                  </Badge>
                ) : (
                  <>
                    <Badge variant="outline" className="text-muted-foreground gap-1 w-fit">
                      <WifiOff className="w-3 h-3" /> Not connected
                    </Badge>
                    <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
                      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                      <span>
                        No email provider is configured. Transactional emails (portal login codes, service reminders, estimates) will only be logged to the server console and will <strong>not</strong> reach customers. Connect a provider above to enable delivery.
                      </span>
                    </div>
                  </>
                )}
              </div>

              {emailProvider !== 'gmail' && (
              <Button
                variant="outline"
                disabled={updateSettings.isPending}
                onClick={() => updateSettings.mutate(
                  {
                    data: {
                      emailProvider: emailProvider || null,
                      emailProviderConfig: {
                        apiKey: emailApiKey,
                        fromAddress: emailFromAddress,
                        domain: emailDomain,
                        smtpHost,
                        smtpPort,
                        smtpUser,
                        smtpPass,
                      },
                    } as any
                  },
                  {
                    onSuccess: () => toast.success('Email provider saved'),
                    onError: () => toast.error('Failed to save'),
                  }
                )}
              >
                Save Email Provider
              </Button>
              )}
            </CardContent>
          </Card>

          {/* Automated Reminders Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Send className="w-5 h-5" /> Automated Service Reminders</CardTitle>
              <CardDescription>
                The system automatically sends reminders to customers before their scheduled jobs.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg border p-4 flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                    <span className="text-blue-700 text-xs font-bold">7d</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium">7-Day Reminder</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Sent one week before the scheduled job. Includes date, time, service, and property address.</p>
                  </div>
                </div>
                <div className="rounded-lg border p-4 flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                    <span className="text-amber-700 text-xs font-bold">24h</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium">24-Hour Reminder</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Sent the day before. All messages include a "Reply STOP to opt out" footer.</p>
                  </div>
                </div>
              </div>
              <div className="rounded-md bg-muted/40 border border-dashed p-3 text-sm text-muted-foreground">
                <p>Reminders are dispatched every 15 minutes. A customer's opt-out preference is respected — toggled on their customer record.</p>
                <p className="mt-1">Staff can also trigger a manual reminder from any job's detail view.</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Team ── */}
        <TabsContent value="users" className="focus-visible:outline-none">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle>Team Members</CardTitle>
                <CardDescription>Manage access and roles for your team.</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    title="Search team members by name or email"
                    value={teamSearch}
                    onChange={e => setTeamSearch(e.target.value)}
                    placeholder="Search staff…"
                    className="h-8 text-sm pl-7 w-40"
                  />
                </div>
                <Select value={teamRoleFilter} onValueChange={setTeamRoleFilter}>
                  <SelectTrigger className="h-8 text-sm w-36" title="Filter team members by role"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Roles</SelectItem>
                    <SelectItem value="owner">Owner</SelectItem>
                    <SelectItem value="office_manager">Office Manager</SelectItem>
                    <SelectItem value="crew_manager">Crew Manager</SelectItem>
                    <SelectItem value="technician">Technician</SelectItem>
                  </SelectContent>
                </Select>
                {isOwner && (
                  <Button size="sm" title="Add a new team member to your organization" onClick={() => setInviteOpen(true)} className="gap-2">
                    <Plus className="w-4 h-4" /> Add Member
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Hourly Rate</TableHead>
                    <TableHead>Hire Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[170px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(users ?? []).filter(u => !teamSearch.trim() || u.name.toLowerCase().includes(teamSearch.toLowerCase()) || u.email.toLowerCase().includes(teamSearch.toLowerCase())).filter(u => teamRoleFilter === 'all' || u.role === teamRoleFilter).map(u => {
                    const highlightUserId = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('userId') : null;
                    const isHighlighted = highlightUserId && String(u.id) === highlightUserId;
                    return (
                    <TableRow key={u.id} id={`user-row-${u.id}`} className={isHighlighted ? 'bg-primary/5 ring-1 ring-primary/20' : ''}>
                      <TableCell className="font-medium" title={u.name}>{u.name}</TableCell>
                      <TableCell className="text-muted-foreground text-sm" title={`Email: ${u.email}`}>{u.email}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="capitalize" title={`Role: ${u.role.replace(/_/g, ' ')}`}>{u.role.replace(/_/g, ' ')}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground" title={(u as any).hourlyRate != null ? `Hourly rate: $${(u as any).hourlyRate.toFixed(2)}/hr` : 'No hourly rate set'}>{(u as any).hourlyRate != null ? `${(u as any).hourlyRate.toFixed(2)}/hr` : '—'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground" title={(u as any).hireDate ? `Hire date: ${format(new Date((u as any).hireDate), 'EEEE, MMMM d, yyyy')}` : 'No hire date set'}>{(u as any).hireDate ? format(new Date((u as any).hireDate), 'MMM d, yyyy') : '—'}</TableCell>
                      <TableCell>
                        {u.isActive !== false ? (
                          <Badge className="bg-emerald-500/10 text-emerald-600 border-transparent" title="This team member is active">Active</Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground" title="This team member is inactive">Inactive</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            title="View employee file"
                            onClick={() => setLocation(`/team/${u.id}`)}
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                          {isOwner && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs px-2"
                                title="Edit this team member's profile and role"
                                onClick={() => openEditUser(u as any)}
                              >
                                Edit
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs px-2"
                                title={u.isActive !== false ? 'Deactivate this team member (they will lose access)' : 'Reactivate this team member (they will regain access)'}
                                onClick={() => toggleUserActive(u.id, u.isActive !== false)}
                                disabled={updateUser.isPending}
                              >
                                {u.isActive !== false ? 'Deactivate' : 'Activate'}
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                title="Permanently delete this team member"
                                onClick={() => handleDeleteUser(u.id, u.name)}
                                disabled={deleteUser.isPending}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ); })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Invite Sheet */}
          <Sheet open={inviteOpen} onOpenChange={setInviteOpen}>
            <SheetContent className="w-full sm:max-w-md">
              <SheetHeader className="pb-4">
                <SheetTitle>Add Team Member</SheetTitle>
                <SheetDescription>Add a new user to your team. They'll receive access immediately.</SheetDescription>
              </SheetHeader>
              <div className="space-y-4 pb-6">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Full Name <span className="text-destructive">*</span></label>
                  <Input title="Team member's full name" value={inviteForm.name} onChange={e => setInviteForm(f => ({ ...f, name: e.target.value }))} placeholder="Jane Smith" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Email <span className="text-destructive">*</span></label>
                  <Input type="email" title="Team member's login email address" value={inviteForm.email} onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))} placeholder="jane@company.com" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Role</label>
                  <Select value={inviteForm.role} onValueChange={v => setInviteForm(f => ({ ...f, role: v }))}>
                    <SelectTrigger title="Role determines what this team member can see and do in the system"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="company_owner">Company Owner</SelectItem>
                      <SelectItem value="office_manager">Office Manager</SelectItem>
                      <SelectItem value="department_manager">Department Manager</SelectItem>
                      <SelectItem value="crew_manager">Crew Manager</SelectItem>
                      <SelectItem value="technician">Technician</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Password <span className="text-muted-foreground font-normal">(required to sign in)</span></label>
                  <Input type="password" title="Initial password for this team member — they can change it after signing in" value={inviteForm.password} onChange={e => setInviteForm(f => ({ ...f, password: e.target.value }))} placeholder="Min. 8 characters" autoComplete="new-password" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Hourly Pay Rate</label>
                  <Input type="number" min="0" step="0.01" title="Hourly pay rate in dollars — used for labor cost calculations" value={inviteForm.hourlyRate} onChange={e => setInviteForm(f => ({ ...f, hourlyRate: e.target.value }))} placeholder="e.g. 22.50" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Hire Date</label>
                  <Input type="date" title="Date this team member was hired" value={inviteForm.hireDate} onChange={e => setInviteForm(f => ({ ...f, hireDate: e.target.value }))} />
                </div>
                <Separator />
                <div className="flex gap-3 justify-end">
                  <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
                  <Button title="Add this team member to your organization" onClick={handleInvite} disabled={createUser.isPending}>
                    {createUser.isPending ? 'Adding...' : 'Add Member'}
                  </Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>

          {/* Edit Member Sheet */}
          <Sheet open={editUserOpen} onOpenChange={(open) => { setEditUserOpen(open); if (!open) setEditUserForm(null); }}>
            <SheetContent className="w-full sm:max-w-md">
              <SheetHeader className="pb-4">
                <SheetTitle>Edit Team Member</SheetTitle>
                <SheetDescription>Update role, pay rate, and hire date.</SheetDescription>
              </SheetHeader>
              {editUserForm && (
                <div className="space-y-4 pb-6">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Full Name</label>
                    <Input title="Team member's full name" value={editUserForm.name} onChange={e => setEditUserForm(f => f && ({ ...f, name: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Role</label>
                    <Select value={editUserForm.role} onValueChange={v => setEditUserForm(f => f && ({ ...f, role: v }))}>
                      <SelectTrigger title="Role determines what this team member can see and do in the system"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="company_owner">Company Owner</SelectItem>
                        <SelectItem value="office_manager">Office Manager</SelectItem>
                        <SelectItem value="department_manager">Department Manager</SelectItem>
                        <SelectItem value="crew_manager">Crew Manager</SelectItem>
                        <SelectItem value="technician">Technician</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Hourly Pay Rate</label>
                    <Input type="number" min="0" step="0.01" title="Hourly pay rate in dollars — used for labor cost calculations" value={editUserForm.hourlyRate} onChange={e => setEditUserForm(f => f && ({ ...f, hourlyRate: e.target.value }))} placeholder="e.g. 22.50" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Hire Date</label>
                    <Input type="date" title="Date this team member was hired" value={editUserForm.hireDate} onChange={e => setEditUserForm(f => f && ({ ...f, hireDate: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Pesticide Applicator License #</label>
                    <Input title="Pesticide applicator license number — required for chemical application jobs" placeholder="e.g. LIC-12345" value={editUserForm.applicatorLicense} onChange={e => setEditUserForm(f => f && ({ ...f, applicatorLicense: e.target.value }))} />
                    <p className="text-xs text-muted-foreground">Required before assigning this person to chemical application jobs.</p>
                  </div>
                  <Separator />
                  <div className="flex gap-3 justify-end">
                    <Button variant="outline" onClick={() => setEditUserOpen(false)}>Cancel</Button>
                    <Button title="Save changes to this team member's profile" onClick={handleSaveEditUser} disabled={updateUser.isPending}>
                      {updateUser.isPending ? 'Saving...' : 'Save Changes'}
                    </Button>
                  </div>
                </div>
              )}
            </SheetContent>
          </Sheet>
        </TabsContent>

        {isOwner && (
          <TabsContent value="api-access" className="focus-visible:outline-none">
            <ExternalAccessSettings />
          </TabsContent>
        )}

        {/* ── Plans (superadmin) ── */}
        {isSuperAdmin && (
          <TabsContent value="plans" className="focus-visible:outline-none">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {(plans ?? []).map(plan => (
                <Card key={plan.id} className={settings?.planTier === plan.tier ? 'border-primary shadow-md relative' : ''}>
                  {settings?.planTier === plan.tier && (
                    <div className="absolute -top-2 -right-2">
                      <Badge className="bg-primary text-primary-foreground">Current</Badge>
                    </div>
                  )}
                  <CardHeader>
                    <CardTitle className="text-xl capitalize">{plan.name}</CardTitle>
                    <div className="text-3xl font-bold tracking-tight mt-2">
                      ${plan.price}<span className="text-sm font-normal text-muted-foreground">/mo</span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2 mb-6 text-sm">
                      {(plan.features ?? []).map((feature, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                    <Button variant={settings?.planTier === plan.tier ? 'outline' : 'default'} className="w-full">
                      {settings?.planTier === plan.tier ? 'Manage Plan' : 'Upgrade'}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        )}

        {/* ── Estimate Templates ── */}
        <TabsContent value="estimates" className="space-y-6 focus-visible:outline-none">
          <Card>
            <CardHeader>
              <CardTitle>Estimate Defaults</CardTitle>
              <CardDescription>Company-wide defaults for new estimates. Templates and wording are edited in Finance, Estimates.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Estimate Expiry (days)</label>
                <p className="text-xs text-muted-foreground">Auto-sets expiry date on new estimates. 0 = no expiry.</p>
                <Input type="number" min={0} value={estimateExpiryDays} onChange={e => setEstimateExpiryDays(e.target.value)} className="w-28" data-testid="input-estimate-expiry-days" />
              </div>
              <DefaultWordingCard kind="estimate" />
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
                <Button onClick={saveEstimateDefaults} disabled={updateSettings.isPending}>Save Estimate Defaults</Button>
                <Button variant="outline" onClick={() => setLocation('/estimates?tab=templates')} className="gap-1.5">
                  Edit estimate templates <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </CardContent>
          </Card>
          <DeclineReasonsSettings />
        </TabsContent>

        {/* ── Invoice Templates ── */}
        <TabsContent value="invoicing" className="space-y-6 focus-visible:outline-none">
          <Card>
            <CardHeader>
              <CardTitle>Invoice Defaults and Automation</CardTitle>
              <CardDescription>Company-wide invoice terms and billing automation. Templates and wording are edited in Finance, Invoice Templates.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Invoice Net Terms (days)</label>
                <p className="text-xs text-muted-foreground">Default due date on new invoices. 0 = due on receipt.</p>
                <Input type="number" min={0} value={invoiceDueDays} onChange={e => setInvoiceDueDays(e.target.value)} className="w-28" data-testid="input-invoice-due-days" />
              </div>
                {/* Billing automation */}
                <div className="space-y-4 rounded-lg border bg-muted/30 p-4" data-testid="billing-automation-block">
                  <div>
                    <p className="text-sm font-semibold">Billing Automation</p>
                    <p className="text-xs text-muted-foreground">Only jobs for customers with <span className="font-medium text-foreground">Auto-Invoice on Job Completion</span> enabled are invoiced by this automation. Turn it on per customer: Customers, open the customer, Edit. Jobs with no price are held for billing review (Schedule, Billing Review filter) and never invoiced automatically; free or plan-covered work can stay completed without an invoice. Recurring invoice templates and estimates set to invoice after the job keep their own timing, but use the delivery choice below.</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Invoice Delivery</label>
                    <Select value={invoiceDeliveryMode} onValueChange={v => setInvoiceDeliveryMode(v as 'review' | 'automatic')}>
                      <SelectTrigger className="w-80" data-testid="select-invoice-delivery-mode"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="review">Create drafts for admin review</SelectItem>
                        <SelectItem value="automatic">Create and send automatically</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">{invoiceDeliveryMode === 'review' ? 'Invoices are created as Draft. Staff review and edit them in Financials, then an admin uses Send Invoice to email the customer.' : 'Invoices are created and sent to the customer without review.'}</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Recurring Job Batching</label>
                    <Select value={autoInvoiceFrequency} onValueChange={v => setAutoInvoiceFrequency(v as typeof autoInvoiceFrequency)}>
                      <SelectTrigger className="w-80" data-testid="select-auto-invoice-frequency"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="off">Off (manual only)</SelectItem>
                        <SelectItem value="daily">Daily (next scheduled run)</SelectItem>
                        <SelectItem value="weekly">Weekly (Mondays)</SelectItem>
                        <SelectItem value="bi_monthly">Twice monthly (1st and 15th)</SelectItem>
                        <SelectItem value="monthly">Monthly (1st of month)</SelectItem>
                        <SelectItem value="biweekly">Every 2 weeks (legacy)</SelectItem>
                        <SelectItem value="weekly_friday">Weekly, Fridays (legacy)</SelectItem>
                        <SelectItem value="monthly_15">Monthly, 15th (legacy)</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Applies to completed recurring jobs only. Dates use the company timezone{timezone ? ` (${timezone})` : ''}.</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">One-Off Job Invoicing</label>
                    <Select value={nonRecurringInvoiceCadence} onValueChange={v => setNonRecurringInvoiceCadence(v as typeof nonRecurringInvoiceCadence)}>
                      <SelectTrigger className="w-80" data-testid="select-nonrecurring-cadence"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="immediate">Immediately on completion</SelectItem>
                        <SelectItem value="weekly">Batch weekly (Mondays)</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Non-recurring jobs are billed on this cadence, independent of recurring batching.</p>
                  </div>
                </div>
              <DefaultWordingCard kind="invoice" />
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
                <Button onClick={saveInvoicingDefaults} disabled={updateSettings.isPending} data-testid="button-save-invoicing">Save Invoicing</Button>
                <Button variant="outline" onClick={() => setLocation('/financials?tab=invoice-templates')} className="gap-1.5">
                  Edit invoice templates <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Operational ── */}
        <TabsContent value="operational" className="space-y-6 focus-visible:outline-none">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <SettingsIcon className="w-5 h-5" /> Job Settings
              </CardTitle>
              <CardDescription>Configure how job durations are entered and how invoices are generated.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Duration unit */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Duration Input Unit</label>
                  <p className="text-xs text-muted-foreground">How field staff enter job durations. Stored internally in minutes.</p>
                  <div className="flex items-center rounded-md border p-1 bg-muted/50 w-fit gap-1">
                    <Button
                      size="sm"
                      title="Field staff enter job duration in minutes"
                      variant={durationUnit === 'minutes' ? 'secondary' : 'ghost'}
                      className="h-8 px-4 text-sm"
                      onClick={() => setDurationUnit('minutes')}
                    >Minutes</Button>
                    <Button
                      size="sm"
                      title="Field staff enter job duration in hours"
                      variant={durationUnit === 'hours' ? 'secondary' : 'ghost'}
                      className="h-8 px-4 text-sm"
                      onClick={() => setDurationUnit('hours')}
                    >Hours</Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Schedule Owners for Field Work</label>
                  <p className="text-xs text-muted-foreground">Allow company owners to appear as individual job assignees and to be added to crews.</p>
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={ownersSchedulable}
                      onCheckedChange={setOwnersSchedulable}
                      title="Allow owners to be scheduled individually and added to crews"
                      data-testid="switch-owners-schedulable"
                    />
                    <span className="text-sm text-muted-foreground">{ownersSchedulable ? 'Owners are available' : 'Owners are hidden'}</span>
                  </div>
                </div>

                {/* Hard clock-out */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Max Clock-In Duration (hours)</label>
                  <p className="text-xs text-muted-foreground">Auto clock-out staff who forget to clock out after this many hours. Leave blank to disable.</p>
                  <Input
                    type="number" min="0" step="0.5" className="w-40"
                    title="Staff are automatically clocked out after this many hours — leave blank to disable"
                    value={maxClockInHours}
                    onChange={e => setMaxClockInHours(e.target.value)}
                    placeholder="e.g. 12"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Default Recurring Job Off-Season</label>
                  <p className="text-xs text-muted-foreground">Pre-filled when creating a recurring job. Leave both blank to disable the default.</p>
                  <div className="flex items-center gap-2">
                    <Input value={defaultOffSeasonStart} onChange={e => setDefaultOffSeasonStart(e.target.value)} placeholder="11-15" maxLength={5} pattern="\d{2}-\d{2}" className="w-24 font-mono" title="Default off-season start in MM-DD format" />
                    <span className="text-muted-foreground text-sm">to</span>
                    <Input value={defaultOffSeasonEnd} onChange={e => setDefaultOffSeasonEnd(e.target.value)} placeholder="03-14" maxLength={5} pattern="\d{2}-\d{2}" className="w-24 font-mono" title="Default off-season end in MM-DD format" />
                  </div>
                </div>
              </div>

              {/* Daily Task Hourly Rate */}
              <div className="col-span-2 space-y-2 pt-2 border-t">
                <label className="text-sm font-medium flex items-center gap-2">
                  <ClipboardList className="w-4 h-4 text-blue-600" />
                  Daily Task Hourly Rate
                </label>
                <p className="text-xs text-muted-foreground">
                  Flat hourly pay rate applied to daily task / compliance time logged by technicians.
                  When set, the Payroll page shows a Task Pay column (task minutes ÷ 60 × rate) alongside P4P earnings.
                  Set to 0 to display task hours without a dollar value.
                </p>
                <div className="flex items-center gap-2 w-fit">
                  <span className="text-sm font-medium text-muted-foreground">$</span>
                  <Input
                    type="number"
                    min={0}
                    step={0.25}
                    title="Hourly rate for daily task / compliance time — used to calculate Task Pay in the Payroll report"
                    className="w-28 text-right"
                    value={dailyTaskHourlyRate}
                    onChange={e => setDailyTaskHourlyRate(e.target.value)}
                    placeholder="0.00"
                  />
                  <span className="text-sm font-medium text-muted-foreground">/ hr</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    {parseFloat(dailyTaskHourlyRate) > 0 ? 'Task pay will appear in Payroll' : 'Display-only (no dollar value)'}
                  </span>
                </div>
              </div>

              <div className="flex justify-end pt-2 border-t">
                <Button onClick={saveOperational} disabled={updateSettings.isPending} variant="outline">
                  Save Job Settings
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        {/* ── Chemicals ── */}
        {isOwner && (
          <TabsContent value="advanced" className="space-y-6 focus-visible:outline-none">
            <DevToolsPanel />
          </TabsContent>
        )}


        {/* ── Branding ── */}
        <TabsContent value="branding" className="space-y-6 focus-visible:outline-none">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ImageIcon className="w-5 h-5" /> Business Logo</CardTitle>
              <CardDescription>
                Upload your company logo. It appears on invoices, estimates, and review pages sent to customers.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-6">
                <div className="flex-shrink-0">
                  <div className="w-28 h-28 rounded-xl border-2 border-dashed border-border bg-muted/30 flex items-center justify-center overflow-hidden">
                    {logoUrl ? (
                      <img
                        src={`${import.meta.env.BASE_URL}api/public/tenants/${settings?.tenantId}/logo`}
                        alt="Business logo"
                        className="w-full h-full object-contain p-1"
                        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : (
                      <ImageIcon className="w-10 h-10 text-muted-foreground/30" />
                    )}
                  </div>
                </div>
                <div className="flex-1 space-y-3">
                  <div>
                    <p className="text-sm font-medium">Company Logo</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Used on invoices, estimates, and review pages sent to your customers. PNG, JPG, or SVG recommended. Max 10 MB.
                    </p>
                  </div>
                  <input
                    ref={logoFileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleLogoUpload}
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      title={logoUrl ? 'Replace the current company logo with a new image' : 'Upload a company logo — shown on invoices and estimates'}
                      className="gap-2"
                      onClick={() => logoFileRef.current?.click()}
                      disabled={logoUploading}
                    >
                      {logoUploading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Camera className="w-4 h-4" />
                      )}
                      {logoUploading ? 'Uploading…' : logoUrl ? 'Replace Logo' : 'Upload Logo'}
                    </Button>
                    {logoUrl && (
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Remove the current company logo"
                        className="text-muted-foreground hover:text-destructive"
                        disabled={updateSettings.isPending}
                        onClick={() => {
                          updateSettings.mutate(
                            { data: { logoUrl: null } },
                            {
                              onSuccess: () => { setLogoUrl(null); toast.success('Logo removed'); qc.invalidateQueries({ queryKey: getGetTenantSettingsQueryKey() }); },
                              onError: () => toast.error('Failed to remove logo'),
                            },
                          );
                        }}
                      >
                        <Trash2 className="w-4 h-4 mr-1" /> Remove
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Building className="w-5 h-5" /> Business Profile</CardTitle>
              <CardDescription>
                Contact and legal information displayed on customer-facing documents.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="bp-phone">Business Phone</Label>
                  <Input
                    id="bp-phone"
                    title="Business phone number printed on invoices and emails"
                    placeholder="+1 (555) 000-0000"
                    value={businessPhone}
                    onChange={e => setBusinessPhone(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bp-email">Business Email</Label>
                  <Input
                    id="bp-email"
                    type="email"
                    title="Business email address printed on invoices and customer communications"
                    placeholder="contact@yourcompany.com"
                    value={businessEmail}
                    onChange={e => setBusinessEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bp-website">Website</Label>
                  <Input
                    id="bp-website"
                    type="url"
                    title="Your business website URL printed on customer documents"
                    placeholder="https://yourcompany.com"
                    value={businessWebsite}
                    onChange={e => setBusinessWebsite(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bp-license">License Number</Label>
                  <Input
                    id="bp-license"
                    title="Your contractor or business license number"
                    placeholder="LIC-123456"
                    value={businessLicenseNumber}
                    onChange={e => setBusinessLicenseNumber(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-4 rounded-lg border p-4">
                <div>
                  <Label htmlFor="bp-address">Physical Business Address</Label>
                  <p className="mb-2 text-xs text-muted-foreground">Used to prioritize nearby customer and property addresses.</p>
                  <AddressAutocomplete
                    id="bp-address"
                    title="Physical business street address"
                    placeholder="Start typing a street address"
                    value={businessAddress}
                    onChange={value => {
                      setBusinessAddress(value);
                      setBusinessLat(null);
                      setBusinessLng(null);
                      if (businessMailingSameAsPhysical) setBusinessMailingAddress(value);
                    }}
                    onSelect={selectBusinessPhysicalAddress}
                  />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="bp-city">City</Label>
                    <Input id="bp-city" value={businessCity} onChange={e => {
                      setBusinessCity(e.target.value);
                      if (businessMailingSameAsPhysical) setBusinessMailingCity(e.target.value);
                    }} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="bp-state">State</Label>
                    <Input id="bp-state" value={businessState} maxLength={2} onChange={e => {
                      setBusinessState(e.target.value.toUpperCase());
                      if (businessMailingSameAsPhysical) setBusinessMailingState(e.target.value.toUpperCase());
                    }} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="bp-zip">ZIP</Label>
                    <Input id="bp-zip" value={businessZip} onChange={e => {
                      setBusinessZip(e.target.value);
                      if (businessMailingSameAsPhysical) setBusinessMailingZip(e.target.value);
                    }} />
                  </div>
                </div>
                {businessLat !== null && businessLng !== null && (
                  <p className="text-xs text-emerald-700">Local address center confirmed.</p>
                )}
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="bp-mailing-same"
                    checked={businessMailingSameAsPhysical}
                    onCheckedChange={checked => {
                      const same = checked === true;
                      setBusinessMailingSameAsPhysical(same);
                      if (same) {
                        setBusinessMailingAddress(businessAddress);
                        setBusinessMailingCity(businessCity);
                        setBusinessMailingState(businessState);
                        setBusinessMailingZip(businessZip);
                      }
                    }}
                  />
                  <Label htmlFor="bp-mailing-same" className="font-normal">Mailing address is the same as the physical address</Label>
                </div>
                {!businessMailingSameAsPhysical && (
                  <div className="space-y-3 border-t pt-4">
                    <div>
                      <Label htmlFor="bp-mailing-address">Mailing Address</Label>
                      <AddressAutocomplete
                        id="bp-mailing-address"
                        title="Business mailing street address"
                        placeholder="Start typing a mailing address"
                        value={businessMailingAddress}
                        onChange={setBusinessMailingAddress}
                        onSelect={selectBusinessMailingAddress}
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="bp-mailing-city">City</Label>
                        <Input id="bp-mailing-city" value={businessMailingCity} onChange={e => setBusinessMailingCity(e.target.value)} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="bp-mailing-state">State</Label>
                        <Input id="bp-mailing-state" value={businessMailingState} maxLength={2} onChange={e => setBusinessMailingState(e.target.value.toUpperCase())} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="bp-mailing-zip">ZIP</Label>
                        <Input id="bp-mailing-zip" value={businessMailingZip} onChange={e => setBusinessMailingZip(e.target.value)} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bp-tagline">Tagline</Label>
                <Input
                  id="bp-tagline"
                  title="Short slogan shown below your company name on documents"
                  placeholder="Your trusted local lawn care experts"
                  value={businessTagline}
                  onChange={e => setBusinessTagline(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">A short slogan shown below your company name on documents.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bp-footer">Invoice Footer Text</Label>
                <Textarea
                  id="bp-footer"
                  title="Text that appears at the bottom of every invoice — use for payment terms or a thank-you note"
                  rows={3}
                  placeholder="Thank you for your business! Payment is due within 30 days."
                  value={invoiceFooterText}
                  onChange={e => setInvoiceFooterText(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Appears at the bottom of every invoice. Good place for payment terms or a thank-you note.</p>
              </div>
              <Button onClick={saveBranding} disabled={updateSettings.isPending} variant="outline">
                {updateSettings.isPending ? 'Saving…' : 'Save Business Profile'}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Payment Reminders ── */}
        <TabsContent value="invoicing" className="space-y-6 focus-visible:outline-none">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Bell className="w-5 h-5" /> Payment Reminders</CardTitle>
              <CardDescription>
                Automatically notify customers about upcoming or overdue invoices on your chosen schedule.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Master toggle */}
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <p className="text-sm font-medium">Enable Payment Reminders</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    When on, the system sends reminders to customers according to the schedule below.
                  </p>
                </div>
                <Switch title={paymentRemindersEnabled ? 'Payment reminders are enabled — click to disable' : 'Payment reminders are disabled — click to enable'} checked={paymentRemindersEnabled} onCheckedChange={setPaymentRemindersEnabled} />
              </div>

              {/* Default channels for newly-added rules */}
              <div className="space-y-2">
                <p className="text-sm font-medium">Default Channels</p>
                <p className="text-xs text-muted-foreground">Used as the starting selection for new rules below. Each rule's channels can be customized individually.</p>
                <div className="flex items-center gap-6 mt-2">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="channel-email"
                      title="Send payment reminders via email by default"
                      checked={paymentReminderChannels.includes('email')}
                      onCheckedChange={v => setPaymentReminderChannels(prev =>
                        v ? [...prev.filter(c => c !== 'email'), 'email'] : prev.filter(c => c !== 'email')
                      )}
                    />
                    <label htmlFor="channel-email" className="text-sm cursor-pointer flex items-center gap-1.5">
                      <Mail className="w-3.5 h-3.5" /> Email
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="channel-sms"
                      title="Send payment reminders via SMS by default"
                      checked={paymentReminderChannels.includes('sms')}
                      onCheckedChange={v => setPaymentReminderChannels(prev =>
                        v ? [...prev.filter(c => c !== 'sms'), 'sms'] : prev.filter(c => c !== 'sms')
                      )}
                    />
                    <label htmlFor="channel-sms" className="text-sm cursor-pointer flex items-center gap-1.5">
                      <MessageSquare className="w-3.5 h-3.5" /> SMS
                    </label>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Schedule builder */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Reminder Schedule</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      <span className="font-medium">Negative</span> days = before due date &nbsp;·&nbsp; <span className="font-medium">Positive</span> days = days overdue (after due date)
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 h-8 text-xs"
                    onClick={() => setPaymentReminderSchedule(prev => [...prev, { offsetDays: 3, label: 'Reminder', channels: paymentReminderChannels.length > 0 ? [...paymentReminderChannels] : ['email'] }])}
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Rule
                  </Button>
                </div>

                {paymentReminderSchedule.length === 0 && (
                  <div className="rounded-lg border border-dashed p-4 text-center">
                    <p className="text-sm text-muted-foreground">No reminder rules yet. Add one above.</p>
                    <p className="text-xs text-muted-foreground mt-1">Example: −3 days = "3 days before due date", +7 days = "7 days overdue"</p>
                  </div>
                )}

                <div className="space-y-2">
                  {paymentReminderSchedule.map((rule, idx) => (
                    <div key={idx} className="flex items-center gap-3 rounded-lg border p-3 bg-muted/20">
                      <div className="space-y-0.5 w-36">
                        <label className="text-xs text-muted-foreground">Days offset</label>
                        <div className="flex items-center gap-1">
                          <Input
                            type="number"
                            className="h-8 text-sm w-24"
                            title="Negative = days before due date; positive = days overdue; 0 = on due date"
                            value={rule.offsetDays}
                            onChange={e => setPaymentReminderSchedule(prev =>
                              prev.map((r, i) => i === idx ? { ...r, offsetDays: parseInt(e.target.value, 10) || 0 } : r)
                            )}
                          />
                          <span className="text-xs text-muted-foreground">d</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                          {rule.offsetDays < 0 ? `${Math.abs(rule.offsetDays)}d before due` : rule.offsetDays > 0 ? `${rule.offsetDays}d overdue` : 'On due date'}
                        </p>
                      </div>
                      <div className="flex-1 space-y-0.5">
                        <label className="text-xs text-muted-foreground">Label</label>
                        <Input
                          className="h-8 text-sm"
                          title="Display name for this reminder rule"
                          placeholder="e.g. 3 days before due"
                          value={rule.label}
                          onChange={e => setPaymentReminderSchedule(prev =>
                            prev.map((r, i) => i === idx ? { ...r, label: e.target.value } : r)
                          )}
                        />
                      </div>
                      <div className="space-y-0.5">
                        <label className="text-xs text-muted-foreground">Channels</label>
                        <div className="flex items-center gap-3 h-8">
                          <div className="flex items-center gap-1.5">
                            <Checkbox
                              id={`rule-${idx}-email`}
                              title="Send this reminder via email"
                              checked={(rule.channels ?? []).includes('email')}
                              onCheckedChange={v => setPaymentReminderSchedule(prev =>
                                prev.map((r, i) => {
                                  if (i !== idx) return r;
                                  const current = r.channels ?? [];
                                  return { ...r, channels: v ? [...current.filter(c => c !== 'email'), 'email'] : current.filter(c => c !== 'email') };
                                })
                              )}
                            />
                            <label htmlFor={`rule-${idx}-email`} className="text-sm cursor-pointer flex items-center gap-1">
                              <Mail className="w-3.5 h-3.5" /> Email
                            </label>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Checkbox
                              id={`rule-${idx}-sms`}
                              title="Send this reminder via SMS text message"
                              checked={(rule.channels ?? []).includes('sms')}
                              onCheckedChange={v => setPaymentReminderSchedule(prev =>
                                prev.map((r, i) => {
                                  if (i !== idx) return r;
                                  const current = r.channels ?? [];
                                  return { ...r, channels: v ? [...current.filter(c => c !== 'sms'), 'sms'] : current.filter(c => c !== 'sms') };
                                })
                              )}
                            />
                            <label htmlFor={`rule-${idx}-sms`} className="text-sm cursor-pointer flex items-center gap-1">
                              <MessageSquare className="w-3.5 h-3.5" /> SMS
                            </label>
                          </div>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="w-8 h-8 text-muted-foreground hover:text-destructive mt-4"
                        onClick={() => setPaymentReminderSchedule(prev => prev.filter((_, i) => i !== idx))}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              <Button onClick={savePaymentReminders} disabled={updateSettings.isPending} variant="outline">
                {updateSettings.isPending ? 'Saving…' : 'Save Reminder Settings'}
              </Button>
            </CardContent>
          </Card>

          {/* Stop-Service Rule */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><AlertCircle className="w-5 h-5" /> Stop-Service Rule</CardTitle>
              <CardDescription>
                Flag accounts for office review when invoices go unpaid past a threshold. <strong>This never automatically pauses service</strong> — it only creates a flag for office staff to manually approve or dismiss.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <p className="text-sm font-medium">Enable Stop-Service Flagging</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    When on, accounts with unpaid invoices past the threshold are flagged for office review. Pending flags appear in the Financials page.
                  </p>
                </div>
                <Switch checked={stopServiceRuleEnabled} onCheckedChange={setStopServiceRuleEnabled} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ss-threshold">Threshold (days overdue)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="ss-threshold"
                    type="number"
                    min={1}
                    step={1}
                    title="Number of days an invoice must be overdue before the account is flagged for stop-service review"
                    className="w-24"
                    value={stopServiceThresholdDays}
                    onChange={e => setStopServiceThresholdDays(e.target.value)}
                  />
                  <span className="text-sm text-muted-foreground">days overdue</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Flag is raised when an invoice is this many days past its due date and still unpaid. A manager must manually approve or dismiss each flag — service is never paused automatically.
                </p>
              </div>

              <Button onClick={savePaymentReminders} disabled={updateSettings.isPending} variant="outline">
                {updateSettings.isPending ? 'Saving…' : 'Save Stop-Service Rule'}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Follow-Up Queue Automation ── */}
        <TabsContent value="followups" className="space-y-6 focus-visible:outline-none">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><PhoneMissedIcon className="w-5 h-5" /> Follow-Up Queue Triggers</CardTitle>
              <CardDescription>
                Control which events add an item to the Follow-Up Queue and how often unresolved items are re-surfaced. Items never disappear on their own — staff must resolve them with a note.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Sent estimate, no response</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Flag estimates that were sent but never approved or declined.</p>
                  </div>
                  <Switch
                    title={followupConfig.sentEstimate?.enabled !== false ? 'Sent-estimate follow-ups are on — click to disable' : 'Enable follow-ups for sent estimates with no response'}
                    checked={followupConfig.sentEstimate?.enabled ?? true}
                    onCheckedChange={(v) => setFollowupConfig(c => ({ ...c, sentEstimate: { ...c.sentEstimate, enabled: v } }))}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Wait before flagging (days)</Label>
                    <Input type="number" min={1} title="Days after sending before the estimate is flagged for follow-up" value={followupConfig.sentEstimate?.delayDays ?? ''}
                      onChange={e => setFollowupConfig(c => ({ ...c, sentEstimate: { ...c.sentEstimate, delayDays: parseInt(e.target.value, 10) } }))}
                      onBlur={e => { const v = parseInt(e.target.value, 10); if (!v || v < 1) setFollowupConfig(c => ({ ...c, sentEstimate: { ...c.sentEstimate, delayDays: 1 } })); }} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Re-surface every (days)</Label>
                    <Input type="number" min={1} title="How often to re-surface the follow-up if not resolved" value={followupConfig.sentEstimate?.repeatDays ?? ''}
                      onChange={e => setFollowupConfig(c => ({ ...c, sentEstimate: { ...c.sentEstimate, repeatDays: parseInt(e.target.value, 10) } }))}
                      onBlur={e => { const v = parseInt(e.target.value, 10); if (!v || v < 1) setFollowupConfig(c => ({ ...c, sentEstimate: { ...c.sentEstimate, repeatDays: 1 } })); }} />
                  </div>
                </div>
              </div>

              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Sent invoice, unpaid</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Flag invoices that were sent but remain unpaid.</p>
                  </div>
                  <Switch
                    title={followupConfig.sentInvoice?.enabled !== false ? 'Sent-invoice follow-ups are on — click to disable' : 'Enable follow-ups for sent invoices that remain unpaid'}
                    checked={followupConfig.sentInvoice?.enabled ?? true}
                    onCheckedChange={(v) => setFollowupConfig(c => ({ ...c, sentInvoice: { ...c.sentInvoice, enabled: v } }))}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Wait before flagging (days)</Label>
                    <Input type="number" min={1} title="Days after sending before the invoice is flagged for follow-up" value={followupConfig.sentInvoice?.delayDays ?? ''}
                      onChange={e => setFollowupConfig(c => ({ ...c, sentInvoice: { ...c.sentInvoice, delayDays: parseInt(e.target.value, 10) } }))}
                      onBlur={e => { const v = parseInt(e.target.value, 10); if (!v || v < 1) setFollowupConfig(c => ({ ...c, sentInvoice: { ...c.sentInvoice, delayDays: 1 } })); }} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Re-surface every (days)</Label>
                    <Input type="number" min={1} title="How often to re-surface the follow-up if unpaid" value={followupConfig.sentInvoice?.repeatDays ?? ''}
                      onChange={e => setFollowupConfig(c => ({ ...c, sentInvoice: { ...c.sentInvoice, repeatDays: parseInt(e.target.value, 10) } }))}
                      onBlur={e => { const v = parseInt(e.target.value, 10); if (!v || v < 1) setFollowupConfig(c => ({ ...c, sentInvoice: { ...c.sentInvoice, repeatDays: 1 } })); }} />
                  </div>
                </div>
              </div>

              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Unanswered inbound email</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Flag inbound customer emails that haven't been replied to.</p>
                  </div>
                  <Switch
                    title={followupConfig.unansweredEmail?.enabled !== false ? 'Unanswered-email follow-ups are on — click to disable' : 'Enable follow-ups for inbound emails with no reply'}
                    checked={followupConfig.unansweredEmail?.enabled ?? true}
                    onCheckedChange={(v) => setFollowupConfig(c => ({ ...c, unansweredEmail: { ...c.unansweredEmail, enabled: v } }))}
                  />
                </div>
                <div className="space-y-1 w-1/2">
                  <Label className="text-xs">Wait before flagging (hours)</Label>
                  <Input type="number" min={1} title="Hours after receiving the email before it's flagged for follow-up" value={followupConfig.unansweredEmail?.hours ?? ''}
                    onChange={e => setFollowupConfig(c => ({ ...c, unansweredEmail: { ...c.unansweredEmail, hours: parseInt(e.target.value, 10) } }))}
                    onBlur={e => { const v = parseInt(e.target.value, 10); if (!v || v < 1) setFollowupConfig(c => ({ ...c, unansweredEmail: { ...c.unansweredEmail, hours: 1 } })); }} />
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <p className="text-sm font-medium">Missed calls & voicemails</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Immediately flag missed calls and voicemails from known customers.</p>
                </div>
                <Switch
                  title={followupConfig.missedCall?.enabled !== false ? 'Missed-call follow-ups are on — click to disable' : 'Enable follow-ups for missed calls and voicemails'}
                  checked={followupConfig.missedCall?.enabled ?? true}
                  onCheckedChange={(v) => setFollowupConfig(c => ({ ...c, missedCall: { ...c.missedCall, enabled: v } }))}
                />
              </div>

              <Button onClick={saveFollowupConfig} disabled={updateFollowupTriggerConfig.isPending}>
                {updateFollowupTriggerConfig.isPending ? 'Saving…' : 'Save Follow-Up Settings'}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Reviews ── */}
        <TabsContent value="reviews" className="space-y-6 focus-visible:outline-none">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><StarIcon className="w-5 h-5" /> Review Request Triggers</CardTitle>
              <CardDescription>
                The backend automatically sends a review request to the customer when these events occur. Customers who rate 5 stars are redirected to the links you configure below.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <p className="text-sm font-medium">Send review request when invoice is paid</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Automatically sends a review request when a customer's invoice is marked as paid.
                  </p>
                </div>
                <Switch title={reviewRequestOnInvoicePaid ? 'Review request on paid invoice is on — click to disable' : 'Enable automatic review requests when invoices are paid'} checked={reviewRequestOnInvoicePaid} onCheckedChange={setReviewRequestOnInvoicePaid} />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <p className="text-sm font-medium">Send review request when estimate is approved</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Automatically sends a review request when a customer approves an estimate.
                  </p>
                </div>
                <Switch title={reviewRequestOnEstimateApproved ? 'Review request on approved estimate is on — click to disable' : 'Enable automatic review requests when estimates are approved'} checked={reviewRequestOnEstimateApproved} onCheckedChange={setReviewRequestOnEstimateApproved} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Link className="w-5 h-5" /> Review Destination Links</CardTitle>
              <CardDescription>
                Customers who give a 5-star rating are directed to these links to leave a public review. Add at least one link to enable review collection.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Google */}
              <div className="space-y-1.5">
                <Label htmlFor="rev-google" className="flex items-center gap-1.5">
                  <div className="w-4 h-4 rounded-sm bg-red-500/10 flex items-center justify-center">
                    <span className="text-[9px] font-bold text-red-600">G</span>
                  </div>
                  Google Review URL
                </Label>
                <Input
                  id="rev-google"
                  type="url"
                  placeholder="https://g.page/r/YOUR_PLACE_ID/review"
                  value={reviewGoogleUrl}
                  onChange={e => setReviewGoogleUrl(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Find this in Google Business Profile → Get more reviews → Share review form.</p>
              </div>

              {/* Facebook */}
              <div className="space-y-1.5">
                <Label htmlFor="rev-facebook" className="flex items-center gap-1.5">
                  <div className="w-4 h-4 rounded-sm bg-blue-500/10 flex items-center justify-center">
                    <span className="text-[9px] font-bold text-blue-700">f</span>
                  </div>
                  Facebook Review URL
                </Label>
                <Input
                  id="rev-facebook"
                  type="url"
                  placeholder="https://www.facebook.com/your-page/reviews"
                  value={reviewFacebookUrl}
                  onChange={e => setReviewFacebookUrl(e.target.value)}
                />
              </div>

              <Separator />

              {/* Custom link 1 */}
              <div>
                <p className="text-sm font-medium mb-3">Custom Link 1</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="rev-cl1-label">Button Label</Label>
                    <Input
                      id="rev-cl1-label"
                      placeholder="e.g. Yelp, Angi, Nextdoor"
                      value={reviewCustomLink1Label}
                      onChange={e => setReviewCustomLink1Label(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rev-cl1-url">URL</Label>
                    <Input
                      id="rev-cl1-url"
                      type="url"
                      placeholder="https://…"
                      value={reviewCustomLink1Url}
                      onChange={e => setReviewCustomLink1Url(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Custom link 2 */}
              <div>
                <p className="text-sm font-medium mb-3">Custom Link 2</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="rev-cl2-label">Button Label</Label>
                    <Input
                      id="rev-cl2-label"
                      placeholder="e.g. HomeAdvisor, Thumbtack"
                      value={reviewCustomLink2Label}
                      onChange={e => setReviewCustomLink2Label(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rev-cl2-url">URL</Label>
                    <Input
                      id="rev-cl2-url"
                      type="url"
                      placeholder="https://…"
                      value={reviewCustomLink2Url}
                      onChange={e => setReviewCustomLink2Url(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <Button onClick={saveReviews} disabled={updateSettings.isPending} variant="outline">
                {updateSettings.isPending ? 'Saving…' : 'Save Review Settings'}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Notification Templates ── */}
        <TabsContent value="notification-templates" className="space-y-6 focus-visible:outline-none">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><MessageSquare className="w-5 h-5" /> Notification Templates</CardTitle>
              <CardDescription>
                Customize the message content for automated reminders. Leave a field blank to use the built-in default. Use double-brace variables to insert dynamic values.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Variable reference */}
              <div className="rounded-lg bg-muted/50 border p-3 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Available variables</p>
                <div className="flex flex-wrap gap-1.5">
                  {['{{firstName}}','{{companyName}}','{{jobTitle}}','{{date}}','{{time}}','{{address}}','{{invoiceNumber}}','{{amount}}','{{dueMessage}}'].map(v => (
                    <code key={v} className="text-xs bg-background border rounded px-1.5 py-0.5 font-mono">{v}</code>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium">Service reminder vars:</span> firstName, companyName, jobTitle, date, time, address.&ensp;
                  <span className="font-medium">Payment reminder vars:</span> firstName, companyName, invoiceNumber, amount, dueMessage.
                </p>
              </div>

              {/* ── Service Reminders ── */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold flex items-center gap-1.5"><Bell className="w-4 h-4" /> Service Reminder (7-day &amp; 24-hour)</h3>
                <div className="space-y-1.5">
                  <Label>SMS Body</Label>
                  <Textarea
                    rows={3}
                    title="SMS text sent to customers before their service visit — use {{firstName}}, {{date}}, {{time}}, {{jobTitle}} as placeholders"
                    placeholder={'Default: Hi {{firstName}}, reminder: {{companyName}} will be at your property on {{date}} at {{time}} for "{{jobTitle}}". Reply STOP to opt out.'}
                    value={notificationTemplates.serviceReminderSms ?? ''}
                    onChange={e => setNotificationTemplates(t => ({ ...t, serviceReminderSms: e.target.value || undefined as any }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Email Subject</Label>
                  <Input
                    title="Email subject line for service reminders — use {{jobTitle}}, {{date}} as placeholders"
                    placeholder="Default: Upcoming Service Reminder — {{jobTitle}} on {{date}}"
                    value={notificationTemplates.serviceReminderEmailSubject ?? ''}
                    onChange={e => setNotificationTemplates(t => ({ ...t, serviceReminderEmailSubject: e.target.value || undefined as any }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Email Body</Label>
                  <Textarea
                    rows={6}
                    title="Email body for service reminders — use {{firstName}}, {{companyName}}, {{date}}, {{time}}, {{address}} as placeholders"
                    placeholder={'Default: Hi {{firstName}},\n\nThis is a reminder that {{companyName}} will be servicing your property on {{date}} at {{time}}.\n\nProperty: {{address}}\n\nIf you have questions, please contact us.\n\nThank you,\n{{companyName}}'}
                    value={notificationTemplates.serviceReminderEmailBody ?? ''}
                    onChange={e => setNotificationTemplates(t => ({ ...t, serviceReminderEmailBody: e.target.value || undefined as any }))}
                  />
                </div>
              </div>

              <Separator />

              {/* ── Payment Reminders ── */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold flex items-center gap-1.5"><CreditCard className="w-4 h-4" /> Payment Reminder</h3>
                <div className="space-y-1.5">
                  <Label>Email Subject</Label>
                  <Input
                    title="Email subject line for payment reminders — use {{invoiceNumber}} as a placeholder"
                    placeholder="Default: Payment reminder — Invoice {{invoiceNumber}} (or 'Payment overdue' when past due)"
                    value={notificationTemplates.paymentReminderEmailSubject ?? ''}
                    onChange={e => setNotificationTemplates(t => ({ ...t, paymentReminderEmailSubject: e.target.value || undefined as any }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Email Body</Label>
                  <Textarea
                    rows={6}
                    title="Email body for payment reminders — use {{firstName}}, {{invoiceNumber}}, {{amount}}, {{dueMessage}}, {{companyName}} as placeholders"
                    placeholder={'Default: Hi {{firstName}},\n\nInvoice {{invoiceNumber}} for ${{amount}} {{dueMessage}}.\n\nPlease arrange payment at your earliest convenience.\n\nThank you,\n{{companyName}}'}
                    value={notificationTemplates.paymentReminderEmailBody ?? ''}
                    onChange={e => setNotificationTemplates(t => ({ ...t, paymentReminderEmailBody: e.target.value || undefined as any }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>SMS Body</Label>
                  <Textarea
                    rows={2}
                    title="SMS text for payment reminders — use {{firstName}}, {{invoiceNumber}}, {{amount}}, {{companyName}}, {{dueMessage}} as placeholders"
                    placeholder="Default: Hi {{firstName}}, reminder: invoice {{invoiceNumber}} (${{amount}}) from {{companyName}} {{dueMessage}}. Reply STOP to opt out."
                    value={notificationTemplates.paymentReminderSms ?? ''}
                    onChange={e => setNotificationTemplates(t => ({ ...t, paymentReminderSms: e.target.value || undefined as any }))}
                  />
                </div>
              </div>

              <div className="flex gap-2 flex-wrap">
                <Button onClick={saveNotificationTemplates} disabled={updateSettings.isPending} variant="outline">
                  {updateSettings.isPending ? 'Saving…' : 'Save Templates'}
                </Button>
                <Button
                  variant="ghost"
                  disabled={testEmailSending}
                  onClick={async () => {
                    setTestEmailSending(true);
                    try {
                      await customFetch('/api/settings/test-email', { method: 'POST' });
                      toast.success('Test email sent to your account email');
                    } catch {
                      toast.error('Failed to send test email');
                    } finally {
                      setTestEmailSending(false);
                    }
                  }}
                >
                  {testEmailSending ? 'Sending…' : 'Send Test Email'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tags ── */}
        <TabsContent value="tags" className="space-y-6 focus-visible:outline-none">
          <Card>
            <CardHeader>
              <CardTitle>Business Tags</CardTitle>
              <CardDescription>
                Define your tag library here. Tags created in settings can be applied to customers, jobs, and properties.
                Near-duplicate names (like "Commercial" and "commercial") are blocked automatically.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Create new tag */}
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={newTagColor}
                  onChange={e => setNewTagColor(e.target.value)}
                  className="w-9 h-9 rounded-md border cursor-pointer"
                  title="Choose tag color"
                />
                <Input
                  placeholder="Tag name, e.g. Commercial, Priority, Irrigation"
                  value={newTagName}
                  onChange={e => setNewTagName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && newTagName.trim()) {
                      createTag.mutate({ data: { name: newTagName.trim(), color: newTagColor } }, {
                        onSuccess: () => { toast.success('Tag created'); setNewTagName(''); setNewTagColor('#6b7280'); qc.invalidateQueries({ queryKey: getListTagsQueryKey() }); },
                        onError: (err: unknown) => {
                          const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to create tag';
                          toast.error(msg);
                        },
                      });
                    }
                  }}
                />
                <Button
                  disabled={!newTagName.trim() || createTag.isPending}
                  onClick={() => {
                    if (!newTagName.trim()) return;
                    createTag.mutate({ data: { name: newTagName.trim(), color: newTagColor } }, {
                      onSuccess: () => { toast.success('Tag created'); setNewTagName(''); setNewTagColor('#6b7280'); qc.invalidateQueries({ queryKey: getListTagsQueryKey() }); },
                      onError: (err: unknown) => {
                        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to create tag';
                        toast.error(msg);
                      },
                    });
                  }}
                >
                  <Plus className="w-4 h-4 mr-1" /> Add Tag
                </Button>
              </div>

              {/* Tag list */}
              {bizTags.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tags yet. Create your first tag above.</p>
              ) : (
                <div className="divide-y rounded-md border">
                  {bizTags.map(tag => (
                    <div key={tag.id} className="flex items-center gap-3 px-3 py-2.5">
                      {editingTagId === tag.id ? (
                        <>
                          <input
                            type="color"
                            value={editingTagColor}
                            onChange={e => setEditingTagColor(e.target.value)}
                            className="w-8 h-8 rounded-md border cursor-pointer flex-shrink-0"
                          />
                          <Input
                            value={editingTagName}
                            onChange={e => setEditingTagName(e.target.value)}
                            className="h-8 text-sm flex-1"
                            autoFocus
                            onKeyDown={e => {
                              if (e.key === 'Escape') setEditingTagId(null);
                              if (e.key === 'Enter') {
                                updateTagMutation.mutate({ id: tag.id, data: { name: editingTagName, color: editingTagColor } }, {
                                  onSuccess: () => { toast.success('Tag updated'); setEditingTagId(null); qc.invalidateQueries({ queryKey: getListTagsQueryKey() }); },
                                  onError: () => toast.error('Failed to update tag'),
                                });
                              }
                            }}
                          />
                          <Button size="sm" className="h-8"
                            onClick={() => updateTagMutation.mutate({ id: tag.id, data: { name: editingTagName, color: editingTagColor } }, {
                              onSuccess: () => { toast.success('Tag updated'); setEditingTagId(null); qc.invalidateQueries({ queryKey: getListTagsQueryKey() }); },
                              onError: () => toast.error('Failed to update tag'),
                            })}>Save</Button>
                          <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditingTagId(null)}><X className="w-3 h-3" /></Button>
                        </>
                      ) : (
                        <>
                          <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }} />
                          <span className="text-sm flex-1 font-medium">{tag.name}</span>
                          <span className="text-xs text-muted-foreground font-mono">#{tag.slug}</span>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Edit tag" onClick={() => { setEditingTagId(tag.id); setEditingTagName(tag.name); setEditingTagColor(tag.color); }}><Pencil className="w-3 h-3" /></Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" title="Delete tag"
                            onClick={() => {
                              if (!confirm(`Delete tag "${tag.name}"? It will be removed from the library but existing labels on records won't be changed.`)) return;
                              deleteTagMutation.mutate({ id: tag.id }, {
                                onSuccess: () => { toast.success('Tag deleted'); qc.invalidateQueries({ queryKey: getListTagsQueryKey() }); },
                                onError: () => toast.error('Failed to delete tag'),
                              });
                            }}
                          ><Trash2 className="w-3 h-3" /></Button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Skip Reasons ── */}
        <TabsContent value="skip-reasons" className="space-y-6 focus-visible:outline-none">
          <Card>
            <CardHeader>
              <CardTitle>Job Skip Reasons</CardTitle>
              <CardDescription>
                When a recurring job occurrence is skipped, staff must choose a reason from this list.
                Each reason can optionally trigger an automatic action — notify the customer, flag the property, or create a follow-up task for the office.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Add new reason */}
              <div className="space-y-3 border rounded-md p-4 bg-muted/30">
                <p className="text-sm font-medium">Add a new reason</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Reason label</label>
                    <Input placeholder="e.g. Weather, Customer request, Not growing" value={newSkipLabel} onChange={e => setNewSkipLabel(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Automatic action</label>
                    <Select value={newSkipAction} onValueChange={v => { setNewSkipAction(v); setNewSkipMsgTemplate(''); setNewSkipFlagNote(''); setNewSkipTaskTitle(''); }}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None — just log it</SelectItem>
                        <SelectItem value="notify_customer">Text the customer</SelectItem>
                        <SelectItem value="flag_property">Flag the property</SelectItem>
                        <SelectItem value="create_task">Create an office task</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {newSkipAction === 'notify_customer' && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Custom SMS message <span className="font-normal">(optional — uses {'{firstName}'}, {'{jobTitle}'}, {'{reason}'})</span></label>
                    <Input placeholder="Hi {firstName}, your service {jobTitle} was skipped — {reason}." value={newSkipMsgTemplate} onChange={e => setNewSkipMsgTemplate(e.target.value)} />
                  </div>
                )}
                {newSkipAction === 'flag_property' && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Flag note <span className="font-normal">(optional — defaults to the job title + reason)</span></label>
                    <Input placeholder="e.g. Property was inaccessible" value={newSkipFlagNote} onChange={e => setNewSkipFlagNote(e.target.value)} />
                  </div>
                )}
                {newSkipAction === 'create_task' && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Task title <span className="font-normal">(optional)</span></label>
                    <Input placeholder="e.g. Follow up: service skipped due to {reason}" value={newSkipTaskTitle} onChange={e => setNewSkipTaskTitle(e.target.value)} />
                  </div>
                )}
                <Button
                  disabled={!newSkipLabel.trim() || createSkipReason.isPending}
                  onClick={() => {
                    const cfg: Record<string, string> = {};
                    if (newSkipAction === 'notify_customer' && newSkipMsgTemplate) cfg['messageTemplate'] = newSkipMsgTemplate;
                    if (newSkipAction === 'flag_property' && newSkipFlagNote) cfg['note'] = newSkipFlagNote;
                    if (newSkipAction === 'create_task' && newSkipTaskTitle) cfg['title'] = newSkipTaskTitle;
                    createSkipReason.mutate({ data: { label: newSkipLabel.trim(), action: newSkipAction, actionConfig: cfg } }, {
                      onSuccess: () => { toast.success('Skip reason added'); setNewSkipLabel(''); setNewSkipAction('none'); setNewSkipMsgTemplate(''); setNewSkipFlagNote(''); setNewSkipTaskTitle(''); qc.invalidateQueries({ queryKey: getListSkipReasonsQueryKey() }); },
                      onError: () => toast.error('Failed to add skip reason'),
                    });
                  }}
                >
                  <Plus className="w-4 h-4 mr-1" /> Add Reason
                </Button>
              </div>

              {/* Reason list */}
              {skipReasons.length === 0 ? (
                <p className="text-sm text-muted-foreground">No skip reasons configured yet.</p>
              ) : (
                <div className="divide-y rounded-md border">
                  {skipReasons.map(reason => {
                    const ac = (reason.actionConfig ?? {}) as Record<string, string>;
                    const actionLabel: Record<string, string> = {
                      none: 'No action',
                      notify_customer: 'Text customer',
                      flag_property: 'Flag property',
                      create_task: 'Create task',
                    };
                    return (
                      <div key={reason.id} className="px-3 py-3 space-y-2">
                        {editingSkipId === reason.id ? (
                          <div className="space-y-3">
                            <Select value={editingSkipAction} onValueChange={v => { setEditingSkipAction(v); setEditingSkipMsgTemplate(''); setEditingSkipFlagNote(''); setEditingSkipTaskTitle(''); }}>
                              <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">None — just log it</SelectItem>
                                <SelectItem value="notify_customer">Text the customer</SelectItem>
                                <SelectItem value="flag_property">Flag the property</SelectItem>
                                <SelectItem value="create_task">Create an office task</SelectItem>
                              </SelectContent>
                            </Select>
                            {editingSkipAction === 'notify_customer' && (
                              <Input placeholder="Custom SMS message (optional)" value={editingSkipMsgTemplate} onChange={e => setEditingSkipMsgTemplate(e.target.value)} />
                            )}
                            {editingSkipAction === 'flag_property' && (
                              <Input placeholder="Flag note (optional)" value={editingSkipFlagNote} onChange={e => setEditingSkipFlagNote(e.target.value)} />
                            )}
                            {editingSkipAction === 'create_task' && (
                              <Input placeholder="Task title (optional)" value={editingSkipTaskTitle} onChange={e => setEditingSkipTaskTitle(e.target.value)} />
                            )}
                            <div className="flex gap-2">
                              <Button size="sm" onClick={() => {
                                const cfg: Record<string, string> = {};
                                if (editingSkipAction === 'notify_customer' && editingSkipMsgTemplate) cfg['messageTemplate'] = editingSkipMsgTemplate;
                                if (editingSkipAction === 'flag_property' && editingSkipFlagNote) cfg['note'] = editingSkipFlagNote;
                                if (editingSkipAction === 'create_task' && editingSkipTaskTitle) cfg['title'] = editingSkipTaskTitle;
                                updateSkipReasonMutation.mutate({ id: reason.id, data: { action: editingSkipAction, actionConfig: cfg } }, {
                                  onSuccess: () => { toast.success('Updated'); setEditingSkipId(null); qc.invalidateQueries({ queryKey: getListSkipReasonsQueryKey() }); },
                                  onError: () => toast.error('Failed to update'),
                                });
                              }}>Save</Button>
                              <Button size="sm" variant="ghost" onClick={() => setEditingSkipId(null)}>Cancel</Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium">{reason.label}</p>
                              <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                                <Zap className="w-3 h-3" />
                                {actionLabel[reason.action] ?? reason.action}
                                {reason.action !== 'none' && ac['messageTemplate'] && <span className="italic">— custom message set</span>}
                                {reason.action !== 'none' && ac['note'] && <span className="italic">— custom note set</span>}
                                {reason.action !== 'none' && ac['title'] && <span className="italic">— custom title set</span>}
                              </p>
                            </div>
                            <Switch
                              checked={reason.isActive}
                              title={reason.isActive ? 'Disable this reason' : 'Enable this reason'}
                              onCheckedChange={v => updateSkipReasonMutation.mutate({ id: reason.id, data: { isActive: v } }, {
                                onSuccess: () => qc.invalidateQueries({ queryKey: getListSkipReasonsQueryKey() }),
                              })}
                            />
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Edit action" onClick={() => {
                              setEditingSkipId(reason.id);
                              setEditingSkipAction(reason.action);
                              setEditingSkipMsgTemplate(ac['messageTemplate'] ?? '');
                              setEditingSkipFlagNote(ac['note'] ?? '');
                              setEditingSkipTaskTitle(ac['title'] ?? '');
                            }}><Pencil className="w-3 h-3" /></Button>
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" title="Delete reason"
                              onClick={() => {
                                if (!confirm(`Delete skip reason "${reason.label}"?`)) return;
                                deleteSkipReasonMutation.mutate({ id: reason.id }, {
                                  onSuccess: () => { toast.success('Deleted'); qc.invalidateQueries({ queryKey: getListSkipReasonsQueryKey() }); },
                                  onError: () => toast.error('Failed to delete'),
                                });
                              }}
                            ><Trash2 className="w-3 h-3" /></Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Roles ── */}
        {isOwner && (
          <TabsContent value="roles" className="space-y-6 focus-visible:outline-none">
            <RolePermissionsSettings />
          </TabsContent>
        )}
      </Tabs>

      {/* Remove User Confirmation */}
      {deleteUserPending != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDeleteUserPending(null)}>
          <div className="bg-card rounded-xl shadow-xl p-6 max-w-sm w-full mx-4 space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-semibold">Remove Team Member</h2>
            <p className="text-sm text-muted-foreground">Remove <strong>{deleteUserPending.name}</strong> from your team? They will lose access to the system.</p>
            <div className="flex gap-3 justify-end">
              <button className="text-sm px-3 py-1.5 rounded-md border hover:bg-muted transition-colors" onClick={() => setDeleteUserPending(null)}>Cancel</button>
              <button
                className="text-sm px-3 py-1.5 rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
                disabled={deleteUser.isPending}
                onClick={() => {
                  deleteUser.mutate({ id: deleteUserPending.id }, {
                    onSuccess: () => { toast.success(`${deleteUserPending.name} removed`); qc.invalidateQueries({ queryKey: getListUsersQueryKey() }); setDeleteUserPending(null); },
                    onError: () => toast.error('Failed to remove user'),
                  });
                }}
              >
                {deleteUser.isPending ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
