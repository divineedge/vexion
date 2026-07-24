import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import {
  useGetTenantSettings, getGetTenantSettingsQueryKey,
  useUpdateTenantSettings,
  useListUsers, getListUsersQueryKey,
  useCreateUser, useUpdateUser, useDeleteUser,
  useListPlans, getListPlansQueryKey,
  useListChemicalProducts, getListChemicalProductsQueryKey,
  useCreateChemicalProduct, useUpdateChemicalProduct, useDeleteChemicalProduct,
  useListChemicalMixtures, getListChemicalMixturesQueryKey,
  useCreateChemicalMixture, useUpdateChemicalMixture, useDeleteChemicalMixture,
  useUpdateFollowupTriggerConfig,
  useGetGmailAuthorizeUrl, getGetGmailAuthorizeUrlQueryKey,
  useDisconnectGmail,
  useListEquipmentTypes, getListEquipmentTypesQueryKey,
  useCreateEquipmentType, useUpdateEquipmentType, useDeleteEquipmentType,
  customFetch,
} from '@workspace/api-client-react';
import type { FollowupTriggerConfig } from '@workspace/api-client-react';
import type { ChemicalProduct, ChemicalMixture, ChemicalMixtureItem, PaymentReminderRule, EquipmentType } from '@workspace/api-client-react';
import { Repeat as RepeatIcon, ClipboardList } from 'lucide-react';
import { format } from 'date-fns';
import PlanTemplatesSettings from '@/components/settings/PlanTemplatesSettings';
import EstimateTemplatesSettings from '@/components/settings/EstimateTemplatesSettings';
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
  ImageIcon, Bell, Star as StarIcon, Link, Camera, Loader2,
  PhoneMissed as PhoneMissedIcon, FileText,
} from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { BUILT_IN_CUSTOMER_FIELDS, getActiveCustomerFields, type CustomerFieldConfig } from '@/lib/fieldConfig';
import IntegrationsGrid from '@/components/settings/IntegrationsGrid';
import DevToolsPanel from '@/components/settings/DevToolsPanel';
import RoutingSettings from '@/components/settings/RoutingSettings';

export default function SettingsPage() {
  const { isSuperAdmin, isOwner } = useAuth();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();

  const { data: settings } = useGetTenantSettings({ query: { queryKey: getGetTenantSettingsQueryKey() } });
  const { data: users } = useListUsers({ query: { queryKey: getListUsersQueryKey() } });
  const { data: plans } = useListPlans({ query: { enabled: isSuperAdmin, queryKey: getListPlansQueryKey() } });
  const { data: chemProducts } = useListChemicalProducts({ query: { queryKey: getListChemicalProductsQueryKey() } });
  const { data: chemMixtures } = useListChemicalMixtures({ query: { queryKey: getListChemicalMixturesQueryKey() } });

  const updateSettings = useUpdateTenantSettings();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const createChemProduct = useCreateChemicalProduct();
  const updateChemProduct = useUpdateChemicalProduct();
  const deleteChemProduct = useDeleteChemicalProduct();
  const createChemMixture = useCreateChemicalMixture();
  const updateChemMixture = useUpdateChemicalMixture();
  const deleteChemMixture = useDeleteChemicalMixture();
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
  const [autoInvoiceFrequency, setAutoInvoiceFrequency] = useState<'off' | 'daily' | 'weekly' | 'bi_monthly' | 'monthly'>('off');
  const [nonRecurringInvoiceCadence, setNonRecurringInvoiceCadence] = useState<'immediate' | 'weekly'>('immediate');
  const [maxClockInHours, setMaxClockInHours] = useState('');
  const [p4pMasterPct, setP4pMasterPct] = useState('0');
  const [dailyTaskHourlyRate, setDailyTaskHourlyRate] = useState('0');
  // Estimate & Invoice defaults
  const [estimateExpiryDays, setEstimateExpiryDays] = useState('30');
  const [invoiceDueDays, setInvoiceDueDays] = useState('30');
  const [taxEnabled, setTaxEnabled] = useState(true);
  // Callback due-date defaults
  const [callbackDueDaysHigh, setCallbackDueDaysHigh] = useState('1');
  const [callbackDueDaysNormal, setCallbackDueDaysNormal] = useState('3');
  const [callbackDueDaysLow, setCallbackDueDaysLow] = useState('7');

  // Equipment thresholds
  const [equipRepairPct, setEquipRepairPct] = useState('50');
  const [equipResalePct, setEquipResalePct] = useState('20');

  // Equipment types
  const { data: equipmentTypes = [] } = useListEquipmentTypes({ query: { queryKey: getListEquipmentTypesQueryKey() } });
  const createEquipmentType = useCreateEquipmentType();
  const updateEquipmentType = useUpdateEquipmentType();
  const deleteEquipmentType = useDeleteEquipmentType();
  const [newTypeLabel, setNewTypeLabel] = useState('');
  const [editingTypeId, setEditingTypeId] = useState<number | null>(null);
  const [editingTypeLabel, setEditingTypeLabel] = useState('');

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
  const [zoneTypes, setZoneTypes] = useState<Array<{ id: string; name: string; color: string }>>([
    { id: '1', name: 'Front Lawn', color: '#3B82F6' },
    { id: '2', name: 'Back Yard', color: '#10B981' },
    { id: '3', name: 'Bed Areas', color: '#F59E0B' },
    { id: '4', name: 'Side Yard', color: '#EF4444' },
    { id: '5', name: 'Common Area', color: '#8B5CF6' },
  ]);

  // Team
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({ name: '', email: '', role: 'technician', password: '', hourlyRate: '', hireDate: '' });
  const [editUserOpen, setEditUserOpen] = useState(false);
  const [editUserForm, setEditUserForm] = useState<{ id: number; name: string; role: string; hourlyRate: string; hireDate: string; applicatorLicense: string } | null>(null);

  // Chemicals – Product form
  const [prodFormOpen, setProdFormOpen] = useState(false);
  const [editingProd, setEditingProd] = useState<ChemicalProduct | null>(null);
  const [prodForm, setProdForm] = useState({ name: '', epaRegNumber: '', activeIngredients: '', signalWord: '', rei: '', phi: '', labelSdsUrl: '', unit: 'oz' });

  // Branding
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const logoFileRef = useRef<HTMLInputElement>(null);
  const [businessPhone, setBusinessPhone] = useState('');
  const [businessEmail, setBusinessEmail] = useState('');
  const [businessWebsite, setBusinessWebsite] = useState('');
  const [businessAddress, setBusinessAddress] = useState('');
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

  // Chemicals – Mixture form
  const [mixFormOpen, setMixFormOpen] = useState(false);
  const [editingMix, setEditingMix] = useState<ChemicalMixture | null>(null);
  const [mixForm, setMixForm] = useState({ name: '', description: '' });
  const [mixItems, setMixItems] = useState<Array<{ productId: string; ratioAmount: string; ratioUnit: string }>>([]);

  useEffect(() => {
    if (settings) {
      setCompanyName(settings.companyName ?? '');
      setTimezone(settings.timezone ?? 'America/Los_Angeles');
      setTaxRate(String(settings.taxRate ?? 8.5));
      setBuffer(String(settings.overageMaterialBuffer ?? 10));
      setMarkupPct(String(settings.defaultMarkupPct ?? 20));
      setShowCostToTech(settings.showCostPriceToTech ?? false);
      setDurationUnit((settings.durationUnit as 'minutes' | 'hours') ?? 'minutes');
      setAutoInvoiceFrequency((settings.autoInvoiceFrequency as 'off' | 'daily' | 'weekly' | 'bi_monthly' | 'monthly') ?? 'off');
      setNonRecurringInvoiceCadence(((settings as any).nonRecurringInvoiceCadence as 'immediate' | 'weekly') ?? 'immediate');
      setMaxClockInHours((settings as any).maxClockInHours != null ? String((settings as any).maxClockInHours) : '');
      setP4pMasterPct(String((settings as any).p4pMasterPercentage ?? 0));
      setDailyTaskHourlyRate(String(settings.dailyTaskHourlyRate ?? 0));
      setEstimateExpiryDays(String((settings as any).estimateExpiryDays ?? 30));
      setInvoiceDueDays(String((settings as any).invoiceDueDays ?? 30));
      setTaxEnabled((settings as any).taxEnabled ?? true);
      setCallbackDueDaysHigh(String((settings as any).callbackDueDaysHigh ?? 1));
      setCallbackDueDaysNormal(String((settings as any).callbackDueDaysNormal ?? 3));
      setCallbackDueDaysLow(String((settings as any).callbackDueDaysLow ?? 7));
      setEquipRepairPct(String((settings as any).equipmentRepairThresholdPct ?? 50));
      setEquipResalePct(String((settings as any).equipmentResaleThresholdPct ?? 20));
      setDefaultGeofenceRadius(String((settings as any).defaultGeofenceRadius ?? 100));
      setDefaultGeofenceUnit(((settings as any).defaultGeofenceUnit as 'm' | 'ft') ?? 'm');
      setAutoCreateGeofence((settings as any).autoCreateGeofence ?? false);
      setPreferredAreaUnit(((settings as any).preferredAreaUnit as 'sqft' | 'acres') ?? 'sqft');
      const rawZoneTypes = (settings as any).measurementZoneTypes as Array<{ id: string; name: string; color: string }> | undefined;
      if (rawZoneTypes && rawZoneTypes.length > 0) {
        setZoneTypes(rawZoneTypes);
      } else {
        // Derive from legacy labels with default colors
        const ZONE_COLORS = ['#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6','#06B6D4','#84CC16','#F97316','#EC4899','#6366F1'];
        const labels: string[] = (settings as any).measurementZoneLabels ?? ['Front Lawn', 'Back Yard', 'Bed Areas', 'Side Yard', 'Common Area'];
        setZoneTypes(labels.map((name, i) => ({ id: String(i + 1), name, color: ZONE_COLORS[i % ZONE_COLORS.length] })));
      }
      setCustomerFields(getActiveCustomerFields(settings));
      // Branding
      setLogoUrl(settings.logoUrl ?? null);
      setBusinessPhone((settings as any).businessPhone ?? '');
      setBusinessEmail((settings as any).businessEmail ?? '');
      setBusinessWebsite((settings as any).businessWebsite ?? '');
      setBusinessAddress((settings as any).businessAddress ?? '');
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

  const saveBranding = () => {
    updateSettings.mutate(
      { data: { businessPhone: businessPhone || undefined, businessEmail: businessEmail || undefined, businessWebsite: businessWebsite || undefined, businessAddress: businessAddress || undefined, businessLicenseNumber: businessLicenseNumber || undefined, businessTagline: businessTagline || undefined, invoiceFooterText: invoiceFooterText || undefined } as Parameters<typeof updateSettings.mutate>[0]['data'] },
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
      { data: { companyName, timezone, taxRate: parseFloat(taxRate), overageMaterialBuffer: parseFloat(buffer), taxEnabled, estimateExpiryDays: parseInt(estimateExpiryDays, 10) || 30, invoiceDueDays: parseInt(invoiceDueDays, 10) || 30, callbackDueDaysHigh: parseInt(callbackDueDaysHigh, 10) || 1, callbackDueDaysNormal: parseInt(callbackDueDaysNormal, 10) || 3, callbackDueDaysLow: parseInt(callbackDueDaysLow, 10) || 7 } as Parameters<typeof updateSettings.mutate>[0]['data'] },
      {
        onSuccess: () => { toast.success('Settings saved'); qc.invalidateQueries({ queryKey: getGetTenantSettingsQueryKey() }); },
        onError: () => toast.error('Failed to save settings'),
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
      { data: { durationUnit, autoInvoiceFrequency, nonRecurringInvoiceCadence, maxClockInHours: maxClockInHours ? parseFloat(maxClockInHours) : null, p4pMasterPercentage: parseFloat(p4pMasterPct) || 0, dailyTaskHourlyRate: parseFloat(dailyTaskHourlyRate) || 0 } as Parameters<typeof updateSettings.mutate>[0]['data'] },
      {
        onSuccess: () => { toast.success('Operational settings saved'); qc.invalidateQueries({ queryKey: getGetTenantSettingsQueryKey() }); },
        onError: () => toast.error('Failed to save settings'),
      },
    );
  };

  const saveEquipmentThresholds = () => {
    updateSettings.mutate(
      { data: { equipmentRepairThresholdPct: parseFloat(equipRepairPct) || 50, equipmentResaleThresholdPct: parseFloat(equipResalePct) || 20 } as Parameters<typeof updateSettings.mutate>[0]['data'] },
      {
        onSuccess: () => { toast.success('Equipment thresholds saved'); qc.invalidateQueries({ queryKey: getGetTenantSettingsQueryKey() }); },
        onError: () => toast.error('Failed to save equipment thresholds'),
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

  const handleDeleteUser = (id: number, name: string) => {
    if (!window.confirm(`Remove ${name} from your team?`)) return;
    deleteUser.mutate({ id }, {
      onSuccess: () => {
        toast.success(`${name} removed`);
        qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
      },
      onError: () => toast.error('Failed to remove user'),
    });
  };

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

      <Tabs defaultValue="general" className="w-full">
        <TabsList className="flex flex-wrap gap-1 h-auto mb-6">
          <TabsTrigger value="general"><Building className="w-4 h-4 mr-2" />General</TabsTrigger>
          <TabsTrigger value="customer-fields"><SettingsIcon className="w-4 h-4 mr-2" />Customer Fields</TabsTrigger>
          <TabsTrigger value="payments"><CreditCard className="w-4 h-4 mr-2" />Integrations</TabsTrigger>
          <TabsTrigger value="communications"><MessageSquare className="w-4 h-4 mr-2" />Communications</TabsTrigger>
          <TabsTrigger value="users"><Users className="w-4 h-4 mr-2" />Team</TabsTrigger>
          {isSuperAdmin && <TabsTrigger value="plans"><Shield className="w-4 h-4 mr-2" />Plans</TabsTrigger>}
          <TabsTrigger value="service-plans"><RepeatIcon className="w-4 h-4 mr-2" />Service Plans</TabsTrigger>
          <TabsTrigger value="estimate-templates"><FileText className="w-4 h-4 mr-2" />Estimate Templates</TabsTrigger>
          <TabsTrigger value="routing"><MapPin className="w-4 h-4 mr-2" />Routing</TabsTrigger>
          <TabsTrigger value="operational"><SettingsIcon className="w-4 h-4 mr-2" />Operational</TabsTrigger>
          <TabsTrigger value="measurements"><MapPin className="w-4 h-4 mr-2" />Maps & Quotes</TabsTrigger>
          <TabsTrigger value="chemicals"><FlaskConical className="w-4 h-4 mr-2" />Chemicals</TabsTrigger>
          <TabsTrigger value="branding"><ImageIcon className="w-4 h-4 mr-2" />Branding</TabsTrigger>
          <TabsTrigger value="payment-reminders"><Bell className="w-4 h-4 mr-2" />Payment Reminders</TabsTrigger>
          <TabsTrigger value="followups"><PhoneMissedIcon className="w-4 h-4 mr-2" />Follow-Ups</TabsTrigger>
          <TabsTrigger value="notification-templates"><MessageSquare className="w-4 h-4 mr-2" />Msg Templates</TabsTrigger>
          <TabsTrigger value="reviews"><StarIcon className="w-4 h-4 mr-2" />Reviews</TabsTrigger>
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
                  <Input value={companyName} onChange={e => setCompanyName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Timezone</label>
                  <Input value={timezone} onChange={e => setTimezone(e.target.value)} />
                </div>
              </div>
              <Button onClick={saveGeneral} disabled={updateSettings.isPending}>
                {updateSettings.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Operational Defaults</CardTitle></CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Default Tax Rate (%)</label>
                  <Input type="number" min={0} step={0.1} value={taxRate} onChange={e => setTaxRate(e.target.value)} disabled={!taxEnabled} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Default Material Buffer (%)</label>
                  <Input type="number" value={buffer} onChange={e => setBuffer(e.target.value)} />
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
                  <label className="text-sm font-medium">Estimate Expiry (days)</label>
                  <p className="text-xs text-muted-foreground">Auto-sets expiry date on new estimates. 0 = no expiry.</p>
                  <Input type="number" min={0} value={estimateExpiryDays} onChange={e => setEstimateExpiryDays(e.target.value)} className="w-28" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Invoice Net Terms (days)</label>
                  <p className="text-xs text-muted-foreground">Default due date on new invoices. 0 = due on receipt.</p>
                  <Input type="number" min={0} value={invoiceDueDays} onChange={e => setInvoiceDueDays(e.target.value)} className="w-28" />
                </div>
              </div>
              <div className="space-y-3 pt-2 border-t">
                <div>
                  <p className="text-sm font-medium">Callback Due-Date Defaults</p>
                  <p className="text-xs text-muted-foreground">Days from today a callback fix is due based on priority.</p>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-red-600">High priority</label>
                    <div className="flex items-center gap-1">
                      <Input type="number" min={1} value={callbackDueDaysHigh} onChange={e => setCallbackDueDaysHigh(e.target.value)} className="w-16 text-sm" />
                      <span className="text-xs text-muted-foreground">days</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-amber-600">Normal priority</label>
                    <div className="flex items-center gap-1">
                      <Input type="number" min={1} value={callbackDueDaysNormal} onChange={e => setCallbackDueDaysNormal(e.target.value)} className="w-16 text-sm" />
                      <span className="text-xs text-muted-foreground">days</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Low priority</label>
                    <div className="flex items-center gap-1">
                      <Input type="number" min={1} value={callbackDueDaysLow} onChange={e => setCallbackDueDaysLow(e.target.value)} className="w-16 text-sm" />
                      <span className="text-xs text-muted-foreground">days</span>
                    </div>
                  </div>
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
              <Button size="sm" onClick={() => setAddFieldOpen(true)} className="gap-2 shrink-0 ml-4">
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
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-2 py-1">Core Fields (always active)</p>
                {['name', 'email', 'phone'].map(key => (
                  <div key={key} className="flex items-center gap-4 px-3 py-2.5 rounded-lg bg-muted/30 border">
                    <div className="flex-1">
                      <span className="font-medium text-sm capitalize">{key === 'name' ? 'Full Name' : key}</span>
                      <Badge variant="outline" className="ml-2 text-[10px] px-1">Built-in</Badge>
                    </div>
                    <Switch checked disabled />
                    <Switch checked disabled />
                    <div className="w-8" />
                  </div>
                ))}
              </div>
              <div className="space-y-1 pt-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-2 py-1">Configurable Fields</p>
                {customerFields.map(field => (
                  <div
                    key={field.key}
                    className={`flex items-center gap-4 px-3 py-2.5 rounded-lg border transition-colors ${field.visible ? 'bg-background' : 'bg-muted/20 opacity-60'}`}
                  >
                    <GripVertical className="w-4 h-4 text-muted-foreground/40 cursor-grab shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{field.label}</span>
                        {field.isBuiltIn && <Badge variant="outline" className="text-[10px] px-1">Built-in</Badge>}
                        <span className="text-xs text-muted-foreground capitalize">{field.type}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {field.visible ? <Eye className="w-3.5 h-3.5 text-muted-foreground" /> : <EyeOff className="w-3.5 h-3.5 text-muted-foreground/40" />}
                      <Switch checked={field.visible} onCheckedChange={() => toggleFieldProp(field.key, 'visible')} />
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Star className={`w-3.5 h-3.5 ${field.required ? 'text-amber-500' : 'text-muted-foreground/40'}`} />
                      <Switch checked={field.required} disabled={!field.visible} onCheckedChange={() => toggleFieldProp(field.key, 'required')} />
                    </div>
                    {!field.isBuiltIn ? (
                      <Button variant="ghost" size="icon" className="w-8 h-8 text-muted-foreground hover:text-destructive" onClick={() => removeCustomField(field.key)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    ) : <div className="w-8" />}
                  </div>
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
                    placeholder="e.g. License Number"
                    value={newField.label ?? ''}
                    onChange={e => setNewField(f => ({ ...f, label: e.target.value, key: e.target.value.replace(/\s+/g, '_').toLowerCase() }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Field Key <span className="text-destructive">*</span></label>
                  <Input
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
                    <SelectTrigger><SelectValue /></SelectTrigger>
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
                    <Input placeholder="Option 1, Option 2, Option 3" value={newOptions} onChange={e => setNewOptions(e.target.value)} />
                    <p className="text-xs text-muted-foreground">Comma-separated list of dropdown options.</p>
                  </div>
                )}
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">Required field</p>
                    <p className="text-xs text-muted-foreground">Team must fill this in to save a customer</p>
                  </div>
                  <Switch checked={newField.required ?? false} onCheckedChange={v => setNewField(f => ({ ...f, required: v }))} />
                </div>
                <Separator />
                <div className="flex gap-3 justify-end">
                  <Button variant="outline" onClick={() => setAddFieldOpen(false)}>Cancel</Button>
                  <Button onClick={addCustomField}>Add Field</Button>
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
                    value={defaultGeofenceRadius}
                    onChange={e => setDefaultGeofenceRadius(e.target.value)}
                    placeholder="100"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Unit</label>
                  <Select value={defaultGeofenceUnit} onValueChange={v => setDefaultGeofenceUnit(v as 'm' | 'ft')}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
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
                    className="gap-1 text-xs h-7"
                    onClick={() => {
                      const ZONE_COLORS = ['#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6','#06B6D4','#84CC16','#F97316','#EC4899','#6366F1'];
                      const color = ZONE_COLORS[zoneTypes.length % ZONE_COLORS.length];
                      setZoneTypes(z => [...z, { id: crypto.randomUUID(), name: 'New Zone', color }]);
                    }}
                  >
                    <Plus className="w-3 h-3" /> Add Zone Type
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Define the zone types available when drawing measurement areas on the satellite map. Each type gets a unique color.
                </p>
                <div className="space-y-2">
                  {zoneTypes.map((zt, idx) => (
                    <div key={zt.id} className="flex items-center gap-2 p-2 border rounded-lg bg-muted/20">
                      {/* Color swatch / picker */}
                      <div className="relative shrink-0">
                        <div
                          className="w-7 h-7 rounded-md border-2 border-white shadow-sm cursor-pointer ring-1 ring-border"
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
                        value={zt.name}
                        onChange={e => setZoneTypes(z => z.map(z2 => z2.id === zt.id ? { ...z2, name: e.target.value } : z2))}
                        placeholder="Zone name"
                      />
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
                onClick={() => {
                  const validZoneTypes = zoneTypes.filter(z => z.name.trim());
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
                <Switch checked={settings?.stripeEnabled} onCheckedChange={v => updateSettings.mutate({ data: { stripeEnabled: v } }, { onSuccess: () => qc.invalidateQueries({ queryKey: getGetTenantSettingsQueryKey() }) })} />
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
                <Switch checked={settings?.quickbooksEnabled} onCheckedChange={v => updateSettings.mutate({ data: { quickbooksEnabled: v } }, { onSuccess: () => qc.invalidateQueries({ queryKey: getGetTenantSettingsQueryKey() }) })} />
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
                    placeholder="+15551234567"
                    value={mainPhoneNumber}
                    onChange={e => setMainPhoneNumber(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Marketing Number <span className="text-xs text-muted-foreground">(campaigns)</span></label>
                  <Input
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
              {isOwner && (
                <Button size="sm" onClick={() => setInviteOpen(true)} className="gap-2">
                  <Plus className="w-4 h-4" /> Add Member
                </Button>
              )}
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
                  {(users ?? []).map(u => (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">{u.name}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{u.email}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="capitalize">{u.role.replace(/_/g, ' ')}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{(u as any).hourlyRate != null ? `${(u as any).hourlyRate.toFixed(2)}/hr` : '—'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{(u as any).hireDate ? format(new Date((u as any).hireDate), 'MMM d, yyyy') : '—'}</TableCell>
                      <TableCell>
                        {u.isActive !== false ? (
                          <Badge className="bg-emerald-500/10 text-emerald-600 border-transparent">Active</Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">Inactive</Badge>
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
                                onClick={() => openEditUser(u as any)}
                              >
                                Edit
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs px-2"
                                onClick={() => toggleUserActive(u.id, u.isActive !== false)}
                                disabled={updateUser.isPending}
                              >
                                {u.isActive !== false ? 'Deactivate' : 'Activate'}
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
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
                  ))}
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
                  <Input value={inviteForm.name} onChange={e => setInviteForm(f => ({ ...f, name: e.target.value }))} placeholder="Jane Smith" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Email <span className="text-destructive">*</span></label>
                  <Input type="email" value={inviteForm.email} onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))} placeholder="jane@company.com" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Role</label>
                  <Select value={inviteForm.role} onValueChange={v => setInviteForm(f => ({ ...f, role: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
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
                  <Input type="password" value={inviteForm.password} onChange={e => setInviteForm(f => ({ ...f, password: e.target.value }))} placeholder="Min. 8 characters" autoComplete="new-password" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Hourly Pay Rate</label>
                  <Input type="number" min="0" step="0.01" value={inviteForm.hourlyRate} onChange={e => setInviteForm(f => ({ ...f, hourlyRate: e.target.value }))} placeholder="e.g. 22.50" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Hire Date</label>
                  <Input type="date" value={inviteForm.hireDate} onChange={e => setInviteForm(f => ({ ...f, hireDate: e.target.value }))} />
                </div>
                <Separator />
                <div className="flex gap-3 justify-end">
                  <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
                  <Button onClick={handleInvite} disabled={createUser.isPending}>
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
                    <Input value={editUserForm.name} onChange={e => setEditUserForm(f => f && ({ ...f, name: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Role</label>
                    <Select value={editUserForm.role} onValueChange={v => setEditUserForm(f => f && ({ ...f, role: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
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
                    <Input type="number" min="0" step="0.01" value={editUserForm.hourlyRate} onChange={e => setEditUserForm(f => f && ({ ...f, hourlyRate: e.target.value }))} placeholder="e.g. 22.50" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Hire Date</label>
                    <Input type="date" value={editUserForm.hireDate} onChange={e => setEditUserForm(f => f && ({ ...f, hireDate: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Pesticide Applicator License #</label>
                    <Input placeholder="e.g. LIC-12345" value={editUserForm.applicatorLicense} onChange={e => setEditUserForm(f => f && ({ ...f, applicatorLicense: e.target.value }))} />
                    <p className="text-xs text-muted-foreground">Required before assigning this person to chemical application jobs.</p>
                  </div>
                  <Separator />
                  <div className="flex gap-3 justify-end">
                    <Button variant="outline" onClick={() => setEditUserOpen(false)}>Cancel</Button>
                    <Button onClick={handleSaveEditUser} disabled={updateUser.isPending}>
                      {updateUser.isPending ? 'Saving...' : 'Save Changes'}
                    </Button>
                  </div>
                </div>
              )}
            </SheetContent>
          </Sheet>
        </TabsContent>

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

        {/* ── Service Plans ── */}
        <TabsContent value="service-plans" className="focus-visible:outline-none">
          <PlanTemplatesSettings />
        </TabsContent>

        {/* ── Estimate Templates ── */}
        <TabsContent value="estimate-templates" className="focus-visible:outline-none">
          <EstimateTemplatesSettings />
        </TabsContent>

        {/* ── Routing ── */}
        <TabsContent value="routing" className="focus-visible:outline-none">
          <RoutingSettings />
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
                      variant={durationUnit === 'minutes' ? 'secondary' : 'ghost'}
                      className="h-8 px-4 text-sm"
                      onClick={() => setDurationUnit('minutes')}
                    >Minutes</Button>
                    <Button
                      size="sm"
                      variant={durationUnit === 'hours' ? 'secondary' : 'ghost'}
                      className="h-8 px-4 text-sm"
                      onClick={() => setDurationUnit('hours')}
                    >Hours</Button>
                  </div>
                </div>

                {/* Auto-invoice frequency */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Auto-Invoice Frequency</label>
                  <p className="text-xs text-muted-foreground">Automatically generate invoices for completed jobs on a schedule.</p>
                  <Select value={autoInvoiceFrequency} onValueChange={v => setAutoInvoiceFrequency(v as typeof autoInvoiceFrequency)}>
                    <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="off">Off (manual only)</SelectItem>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly (every Monday)</SelectItem>
                      <SelectItem value="bi_monthly">Bi-monthly (every 2 months)</SelectItem>
                      <SelectItem value="monthly">Monthly (1st of month)</SelectItem>
                      <SelectItem value="biweekly">Bi-weekly (every 2 weeks)</SelectItem>
                      <SelectItem value="weekly_friday">Weekly (every Friday)</SelectItem>
                      <SelectItem value="monthly_15">Monthly (15th of month)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Non-recurring job invoicing cadence */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Invoicing for Completed (Non-Recurring) Jobs</label>
                  <p className="text-xs text-muted-foreground">Controls when an invoice is generated after a one-off job with auto-invoicing is completed.</p>
                  <Select value={nonRecurringInvoiceCadence} onValueChange={v => setNonRecurringInvoiceCadence(v as typeof nonRecurringInvoiceCadence)}>
                    <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="immediate">Immediately on completion</SelectItem>
                      <SelectItem value="weekly">Batch weekly (every Monday)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Hard clock-out */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Max Clock-In Duration (hours)</label>
                  <p className="text-xs text-muted-foreground">Auto clock-out staff who forget to clock out after this many hours. Leave blank to disable.</p>
                  <Input
                    type="number" min="0" step="0.5" className="w-40"
                    value={maxClockInHours}
                    onChange={e => setMaxClockInHours(e.target.value)}
                    placeholder="e.g. 12"
                  />
                </div>
              </div>

              {/* P4P Master Percentage */}
              <div className="col-span-2 space-y-2 pt-2 border-t">
                <label className="text-sm font-medium flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-primary" />
                  Global P4P Master Payout Percentage
                </label>
                <p className="text-xs text-muted-foreground">
                  Default Pay-for-Performance rate applied to all services. Individual service blueprints can override this with their own percentage.
                  Set to 0 to disable P4P calculations.
                </p>
                <div className="flex items-center gap-2 w-fit">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    className="w-24 text-right"
                    value={p4pMasterPct}
                    onChange={e => setP4pMasterPct(e.target.value)}
                  />
                  <span className="text-sm font-medium text-muted-foreground">%</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    {parseFloat(p4pMasterPct) > 0 ? `= ${parseFloat(p4pMasterPct)} per $100 of net labor revenue` : 'P4P disabled'}
                  </span>
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

          {/* Equipment Sell Thresholds */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">Equipment Sell Thresholds</CardTitle>
              <CardDescription>
                Configure when the system should recommend selling a piece of equipment.
                A sell badge appears when either condition is met.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Repair Cost Threshold (%)</label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number" min={0} max={200} step={5}
                      className="w-24 text-right"
                      value={equipRepairPct}
                      onChange={e => setEquipRepairPct(e.target.value)}
                    />
                    <span className="text-sm text-muted-foreground">% of purchase price</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Flag when total repair cost exceeds this % of the original purchase price.
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Resale Value Threshold (%)</label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number" min={0} max={100} step={5}
                      className="w-24 text-right"
                      value={equipResalePct}
                      onChange={e => setEquipResalePct(e.target.value)}
                    />
                    <span className="text-sm text-muted-foreground">% of purchase price</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Flag when estimated resale value (age-depreciated) falls below this %.
                  </p>
                </div>
              </div>
              <Button onClick={saveEquipmentThresholds} disabled={updateSettings.isPending} variant="outline">
                Save Equipment Thresholds
              </Button>
            </CardContent>
          </Card>

          {/* Equipment Types */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">Equipment Types</CardTitle>
              <CardDescription>
                Define the type labels available when adding or editing equipment.
                Staff can still type a custom value if a type isn't listed here.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Existing types list */}
              {equipmentTypes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No types defined yet. Add your first type below.</p>
              ) : (
                <div className="divide-y border rounded-lg">
                  {equipmentTypes.map((et: EquipmentType) => (
                    <div key={et.id} className="flex items-center gap-2 px-3 py-2">
                      {editingTypeId === et.id ? (
                        <>
                          <Input
                            className="h-7 text-sm flex-1"
                            value={editingTypeLabel}
                            onChange={e => setEditingTypeLabel(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                if (!editingTypeLabel.trim()) return;
                                updateEquipmentType.mutate(
                                  { id: et.id, data: { label: editingTypeLabel.trim() } },
                                  {
                                    onSuccess: () => {
                                      qc.invalidateQueries({ queryKey: getListEquipmentTypesQueryKey() });
                                      setEditingTypeId(null);
                                    },
                                    onError: () => toast.error('Failed to rename type'),
                                  }
                                );
                              }
                              if (e.key === 'Escape') setEditingTypeId(null);
                            }}
                            autoFocus
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() => {
                              if (!editingTypeLabel.trim()) return;
                              updateEquipmentType.mutate(
                                { id: et.id, data: { label: editingTypeLabel.trim() } },
                                {
                                  onSuccess: () => {
                                    qc.invalidateQueries({ queryKey: getListEquipmentTypesQueryKey() });
                                    setEditingTypeId(null);
                                  },
                                  onError: () => toast.error('Failed to rename type'),
                                }
                              );
                            }}
                          >Save</Button>
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditingTypeId(null)}>Cancel</Button>
                        </>
                      ) : (
                        <>
                          <span className="flex-1 text-sm">{et.label}</span>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => { setEditingTypeId(et.id); setEditingTypeLabel(et.label); }}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => {
                              if (!window.confirm(`Remove "${et.label}" from the list? Existing equipment with this type will still display correctly.`)) return;
                              deleteEquipmentType.mutate(
                                { id: et.id },
                                {
                                  onSuccess: () => qc.invalidateQueries({ queryKey: getListEquipmentTypesQueryKey() }),
                                  onError: () => toast.error('Failed to delete type'),
                                }
                              );
                            }}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Add new type */}
              <div className="flex gap-2">
                <Input
                  className="flex-1"
                  placeholder="New type label (e.g. Riding Mower)"
                  value={newTypeLabel}
                  onChange={e => setNewTypeLabel(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      if (!newTypeLabel.trim()) return;
                      createEquipmentType.mutate(
                        { data: { label: newTypeLabel.trim(), sortOrder: equipmentTypes.length } },
                        {
                          onSuccess: () => {
                            qc.invalidateQueries({ queryKey: getListEquipmentTypesQueryKey() });
                            setNewTypeLabel('');
                          },
                          onError: () => toast.error('Failed to add type'),
                        }
                      );
                    }
                  }}
                />
                <Button
                  variant="outline"
                  disabled={!newTypeLabel.trim() || createEquipmentType.isPending}
                  onClick={() => {
                    if (!newTypeLabel.trim()) return;
                    createEquipmentType.mutate(
                      { data: { label: newTypeLabel.trim(), sortOrder: equipmentTypes.length } },
                      {
                        onSuccess: () => {
                          qc.invalidateQueries({ queryKey: getListEquipmentTypesQueryKey() });
                          setNewTypeLabel('');
                        },
                        onError: () => toast.error('Failed to add type'),
                      }
                    );
                  }}
                >
                  <Plus className="w-4 h-4 mr-1" /> Add
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

        <TabsContent value="chemicals" className="space-y-6 focus-visible:outline-none">
          {/* Products Library */}
          <Card>
            <CardHeader className="flex flex-row items-start justify-between pb-2">
              <div>
                <CardTitle className="flex items-center gap-2"><FlaskConical className="w-5 h-5" /> Chemical Products</CardTitle>
                <CardDescription>Pesticides, herbicides, and fertilizers with EPA registration and safety data.</CardDescription>
              </div>
              <Button size="sm" className="gap-2 ml-4 shrink-0" onClick={() => { setEditingProd(null); setProdForm({ name: '', epaRegNumber: '', activeIngredients: '', signalWord: '', rei: '', phi: '', labelSdsUrl: '', unit: 'oz' }); setProdFormOpen(true); }}>
                <Plus className="w-4 h-4" /> Add Product
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {(chemProducts ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground px-6 py-4">No chemical products yet. Add your first product to build your library.</p>
              ) : (
                <div className="divide-y">
                  {(chemProducts ?? []).map(p => (
                    <div key={p.id} className={`flex items-start gap-4 px-6 py-3 ${!p.isActive ? 'opacity-50' : ''}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{p.name}</span>
                          {p.signalWord && (
                            <Badge variant="outline" className={`text-[10px] px-1.5 ${p.signalWord === 'DANGER' ? 'bg-red-50 text-red-700 border-red-200' : p.signalWord === 'WARNING' ? 'bg-orange-50 text-orange-700 border-orange-200' : 'bg-yellow-50 text-yellow-700 border-yellow-200'}`}>
                              {p.signalWord}
                            </Badge>
                          )}
                          {!p.isActive && <Badge variant="outline" className="text-[10px] px-1.5">Inactive</Badge>}
                        </div>
                        {p.epaRegNumber && <p className="text-xs text-muted-foreground mt-0.5">EPA #{p.epaRegNumber}</p>}
                        {p.activeIngredients && <p className="text-xs text-muted-foreground">{p.activeIngredients}</p>}
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                          <span>Unit: {p.unit}</span>
                          {p.rei != null && <span>REI: {p.rei}h</span>}
                          {p.phi != null && <span>PHI: {p.phi}d</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button variant="ghost" size="icon" className="w-7 h-7" onClick={() => {
                          setEditingProd(p);
                          setProdForm({ name: p.name, epaRegNumber: p.epaRegNumber ?? '', activeIngredients: p.activeIngredients ?? '', signalWord: p.signalWord ?? '', rei: p.rei != null ? String(p.rei) : '', phi: p.phi != null ? String(p.phi) : '', labelSdsUrl: p.labelSdsUrl ?? '', unit: p.unit });
                          setProdFormOpen(true);
                        }}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:text-destructive" onClick={() => {
                          if (!window.confirm(`Delete ${p.name}?`)) return;
                          deleteChemProduct.mutate({ id: p.id }, {
                            onSuccess: () => { toast.success('Product deleted'); qc.invalidateQueries({ queryKey: getListChemicalProductsQueryKey() }); },
                            onError: () => toast.error('Failed to delete'),
                          });
                        }}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Mixtures Library */}
          <Card>
            <CardHeader className="flex flex-row items-start justify-between pb-2">
              <div>
                <CardTitle>Tank Mixtures</CardTitle>
                <CardDescription>Named mixes (e.g. "Broadleaf Control Mix") that auto-expand to per-product breakdown when applied.</CardDescription>
              </div>
              <Button size="sm" className="gap-2 ml-4 shrink-0" onClick={() => { setEditingMix(null); setMixForm({ name: '', description: '' }); setMixItems([]); setMixFormOpen(true); }}>
                <Plus className="w-4 h-4" /> Add Mixture
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {(chemMixtures ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground px-6 py-4">No mixtures yet. Create a mixture to let field staff log complex applications as a single entry.</p>
              ) : (
                <div className="divide-y">
                  {(chemMixtures ?? []).map(m => (
                    <div key={m.id} className={`px-6 py-3 ${!m.isActive ? 'opacity-50' : ''}`}>
                      <div className="flex items-start gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{m.name}</span>
                            {!m.isActive && <Badge variant="outline" className="text-[10px] px-1.5">Inactive</Badge>}
                          </div>
                          {m.description && <p className="text-xs text-muted-foreground mt-0.5">{m.description}</p>}
                          {m.items.length > 0 && (
                            <div className="mt-1.5 space-y-0.5">
                              {m.items.map((item: ChemicalMixtureItem) => (
                                <p key={item.id} className="text-xs text-muted-foreground">
                                  {item.productName ?? `Product #${item.productId}`}: {item.ratioAmount} {item.ratioUnit} per gal
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button variant="ghost" size="icon" className="w-7 h-7" onClick={() => {
                            setEditingMix(m);
                            setMixForm({ name: m.name, description: m.description ?? '' });
                            setMixItems(m.items.map((i: ChemicalMixtureItem) => ({ productId: String(i.productId), ratioAmount: String(i.ratioAmount), ratioUnit: i.ratioUnit })));
                            setMixFormOpen(true);
                          }}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:text-destructive" onClick={() => {
                            if (!window.confirm(`Delete ${m.name}?`)) return;
                            deleteChemMixture.mutate({ id: m.id }, {
                              onSuccess: () => { toast.success('Mixture deleted'); qc.invalidateQueries({ queryKey: getListChemicalMixturesQueryKey() }); },
                              onError: () => toast.error('Failed to delete'),
                            });
                          }}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Product Form Sheet */}
          <Sheet open={prodFormOpen} onOpenChange={open => { if (!open) { setProdFormOpen(false); setEditingProd(null); } }}>
            <SheetContent className="w-full sm:max-w-md overflow-y-auto">
              <SheetHeader className="pb-4">
                <SheetTitle>{editingProd ? 'Edit Product' : 'Add Chemical Product'}</SheetTitle>
                <SheetDescription>Fill in the product details for your chemical library.</SheetDescription>
              </SheetHeader>
              <div className="space-y-4 pb-6">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Product Name <span className="text-destructive">*</span></label>
                  <Input placeholder="e.g. RoundUp Pro Concentrate" value={prodForm.name} onChange={e => setProdForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">EPA Reg #</label>
                    <Input placeholder="524-343" value={prodForm.epaRegNumber} onChange={e => setProdForm(f => ({ ...f, epaRegNumber: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Signal Word</label>
                    <Select value={prodForm.signalWord} onValueChange={v => setProdForm(f => ({ ...f, signalWord: v }))}>
                      <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="CAUTION">CAUTION</SelectItem>
                        <SelectItem value="WARNING">WARNING</SelectItem>
                        <SelectItem value="DANGER">DANGER</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Active Ingredients</label>
                  <Input placeholder="e.g. Glyphosate 41%" value={prodForm.activeIngredients} onChange={e => setProdForm(f => ({ ...f, activeIngredients: e.target.value }))} />
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Unit</label>
                    <Select value={prodForm.unit} onValueChange={v => setProdForm(f => ({ ...f, unit: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="oz">oz</SelectItem>
                        <SelectItem value="fl oz">fl oz</SelectItem>
                        <SelectItem value="lb">lb</SelectItem>
                        <SelectItem value="gal">gal</SelectItem>
                        <SelectItem value="l">L</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">REI (hrs)</label>
                    <Input type="number" min={0} placeholder="4" value={prodForm.rei} onChange={e => setProdForm(f => ({ ...f, rei: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">PHI (days)</label>
                    <Input type="number" min={0} placeholder="0" value={prodForm.phi} onChange={e => setProdForm(f => ({ ...f, phi: e.target.value }))} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Label / SDS URL</label>
                  <Input placeholder="https://…" value={prodForm.labelSdsUrl} onChange={e => setProdForm(f => ({ ...f, labelSdsUrl: e.target.value }))} />
                </div>
                <Separator />
                <div className="flex gap-3 justify-end">
                  <Button variant="outline" onClick={() => setProdFormOpen(false)}>Cancel</Button>
                  <Button onClick={() => {
                    if (!prodForm.name) { toast.error('Name is required'); return; }
                    const data = {
                      name: prodForm.name,
                      epaRegNumber: prodForm.epaRegNumber || undefined,
                      activeIngredients: prodForm.activeIngredients || undefined,
                      signalWord: (prodForm.signalWord && prodForm.signalWord !== 'none') ? prodForm.signalWord as 'CAUTION' | 'WARNING' | 'DANGER' : undefined,
                      rei: prodForm.rei ? parseInt(prodForm.rei, 10) : undefined,
                      phi: prodForm.phi ? parseInt(prodForm.phi, 10) : undefined,
                      labelSdsUrl: prodForm.labelSdsUrl || undefined,
                      unit: prodForm.unit,
                    };
                    if (editingProd) {
                      updateChemProduct.mutate({ id: editingProd.id, data }, {
                        onSuccess: () => { toast.success('Product updated'); qc.invalidateQueries({ queryKey: getListChemicalProductsQueryKey() }); setProdFormOpen(false); },
                        onError: () => toast.error('Failed to update'),
                      });
                    } else {
                      createChemProduct.mutate({ data }, {
                        onSuccess: () => { toast.success('Product added'); qc.invalidateQueries({ queryKey: getListChemicalProductsQueryKey() }); setProdFormOpen(false); },
                        onError: () => toast.error('Failed to add product'),
                      });
                    }
                  }} disabled={createChemProduct.isPending || updateChemProduct.isPending}>
                    {editingProd ? 'Save Changes' : 'Add Product'}
                  </Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>

          {/* Mixture Form Sheet */}
          <Sheet open={mixFormOpen} onOpenChange={open => { if (!open) { setMixFormOpen(false); setEditingMix(null); } }}>
            <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
              <SheetHeader className="pb-4">
                <SheetTitle>{editingMix ? 'Edit Mixture' : 'Add Tank Mixture'}</SheetTitle>
                <SheetDescription>Define a named mix by specifying how much of each product goes into a gallon of solution.</SheetDescription>
              </SheetHeader>
              <div className="space-y-4 pb-6">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Mixture Name <span className="text-destructive">*</span></label>
                  <Input placeholder="e.g. Broadleaf Control Mix" value={mixForm.name} onChange={e => setMixForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Description</label>
                  <Input placeholder="What is this mixture used for?" value={mixForm.description} onChange={e => setMixForm(f => ({ ...f, description: e.target.value }))} />
                </div>

                <Separator />
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Products in this mixture</p>
                  <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setMixItems(items => [...items, { productId: '', ratioAmount: '', ratioUnit: 'oz' }])}>
                    <Plus className="w-3 h-3" /> Add Product
                  </Button>
                </div>
                {mixItems.length === 0 && <p className="text-sm text-muted-foreground">Add at least one product to define the mixture ratio.</p>}
                <div className="space-y-3">
                  {mixItems.map((item, i) => (
                    <div key={i} className="flex gap-2 items-end">
                      <div className="flex-1 space-y-1">
                        <label className="text-xs text-muted-foreground">Product</label>
                        <Select value={item.productId} onValueChange={v => setMixItems(items => items.map((x, j) => j === i ? { ...x, productId: v } : x))}>
                          <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select…" /></SelectTrigger>
                          <SelectContent>
                            {(chemProducts ?? []).filter(p => p.isActive).map(p => (
                              <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="w-20 space-y-1">
                        <label className="text-xs text-muted-foreground">Amount</label>
                        <Input className="h-8 text-sm" type="number" min={0} step={0.1} placeholder="2" value={item.ratioAmount} onChange={e => setMixItems(items => items.map((x, j) => j === i ? { ...x, ratioAmount: e.target.value } : x))} />
                      </div>
                      <div className="w-24 space-y-1">
                        <label className="text-xs text-muted-foreground">Unit/gal</label>
                        <Select value={item.ratioUnit} onValueChange={v => setMixItems(items => items.map((x, j) => j === i ? { ...x, ratioUnit: v } : x))}>
                          <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="oz">oz</SelectItem>
                            <SelectItem value="fl oz">fl oz</SelectItem>
                            <SelectItem value="lb">lb</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive mb-0.5" onClick={() => setMixItems(items => items.filter((_, j) => j !== i))}>
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>

                <Separator />
                <div className="flex gap-3 justify-end">
                  <Button variant="outline" onClick={() => setMixFormOpen(false)}>Cancel</Button>
                  <Button onClick={() => {
                    if (!mixForm.name) { toast.error('Name is required'); return; }
                    const data = {
                      name: mixForm.name,
                      description: mixForm.description || undefined,
                      items: mixItems.filter(i => i.productId && i.ratioAmount).map(i => ({
                        productId: parseInt(i.productId, 10),
                        ratioAmount: parseFloat(i.ratioAmount),
                        ratioUnit: i.ratioUnit,
                      })),
                    };
                    if (editingMix) {
                      updateChemMixture.mutate({ id: editingMix.id, data }, {
                        onSuccess: () => { toast.success('Mixture updated'); qc.invalidateQueries({ queryKey: getListChemicalMixturesQueryKey() }); setMixFormOpen(false); },
                        onError: () => toast.error('Failed to update'),
                      });
                    } else {
                      createChemMixture.mutate({ data }, {
                        onSuccess: () => { toast.success('Mixture created'); qc.invalidateQueries({ queryKey: getListChemicalMixturesQueryKey() }); setMixFormOpen(false); },
                        onError: () => toast.error('Failed to create'),
                      });
                    }
                  }} disabled={createChemMixture.isPending || updateChemMixture.isPending}>
                    {editingMix ? 'Save Changes' : 'Create Mixture'}
                  </Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </TabsContent>

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
                    placeholder="https://yourcompany.com"
                    value={businessWebsite}
                    onChange={e => setBusinessWebsite(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bp-license">License Number</Label>
                  <Input
                    id="bp-license"
                    placeholder="LIC-123456"
                    value={businessLicenseNumber}
                    onChange={e => setBusinessLicenseNumber(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bp-address">Business Address</Label>
                <Input
                  id="bp-address"
                  placeholder="123 Main St, City, State 00000"
                  value={businessAddress}
                  onChange={e => setBusinessAddress(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bp-tagline">Tagline</Label>
                <Input
                  id="bp-tagline"
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
        <TabsContent value="payment-reminders" className="space-y-6 focus-visible:outline-none">
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
                <Switch checked={paymentRemindersEnabled} onCheckedChange={setPaymentRemindersEnabled} />
              </div>

              {/* Default channels for newly-added rules */}
              <div className="space-y-2">
                <p className="text-sm font-medium">Default Channels</p>
                <p className="text-xs text-muted-foreground">Used as the starting selection for new rules below. Each rule's channels can be customized individually.</p>
                <div className="flex items-center gap-6 mt-2">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="channel-email"
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
                    checked={followupConfig.sentEstimate?.enabled ?? true}
                    onCheckedChange={(v) => setFollowupConfig(c => ({ ...c, sentEstimate: { ...c.sentEstimate, enabled: v } }))}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Wait before flagging (days)</Label>
                    <Input type="number" min={1} value={followupConfig.sentEstimate?.delayDays ?? 3}
                      onChange={e => setFollowupConfig(c => ({ ...c, sentEstimate: { ...c.sentEstimate, delayDays: parseInt(e.target.value, 10) || 1 } }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Re-surface every (days)</Label>
                    <Input type="number" min={1} value={followupConfig.sentEstimate?.repeatDays ?? 4}
                      onChange={e => setFollowupConfig(c => ({ ...c, sentEstimate: { ...c.sentEstimate, repeatDays: parseInt(e.target.value, 10) || 1 } }))} />
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
                    checked={followupConfig.sentInvoice?.enabled ?? true}
                    onCheckedChange={(v) => setFollowupConfig(c => ({ ...c, sentInvoice: { ...c.sentInvoice, enabled: v } }))}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Wait before flagging (days)</Label>
                    <Input type="number" min={1} value={followupConfig.sentInvoice?.delayDays ?? 5}
                      onChange={e => setFollowupConfig(c => ({ ...c, sentInvoice: { ...c.sentInvoice, delayDays: parseInt(e.target.value, 10) || 1 } }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Re-surface every (days)</Label>
                    <Input type="number" min={1} value={followupConfig.sentInvoice?.repeatDays ?? 5}
                      onChange={e => setFollowupConfig(c => ({ ...c, sentInvoice: { ...c.sentInvoice, repeatDays: parseInt(e.target.value, 10) || 1 } }))} />
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
                    checked={followupConfig.unansweredEmail?.enabled ?? true}
                    onCheckedChange={(v) => setFollowupConfig(c => ({ ...c, unansweredEmail: { ...c.unansweredEmail, enabled: v } }))}
                  />
                </div>
                <div className="space-y-1 w-1/2">
                  <Label className="text-xs">Wait before flagging (hours)</Label>
                  <Input type="number" min={1} value={followupConfig.unansweredEmail?.hours ?? 48}
                    onChange={e => setFollowupConfig(c => ({ ...c, unansweredEmail: { ...c.unansweredEmail, hours: parseInt(e.target.value, 10) || 1 } }))} />
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <p className="text-sm font-medium">Missed calls & voicemails</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Immediately flag missed calls and voicemails from known customers.</p>
                </div>
                <Switch
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
                <Switch checked={reviewRequestOnInvoicePaid} onCheckedChange={setReviewRequestOnInvoicePaid} />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <p className="text-sm font-medium">Send review request when estimate is approved</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Automatically sends a review request when a customer approves an estimate.
                  </p>
                </div>
                <Switch checked={reviewRequestOnEstimateApproved} onCheckedChange={setReviewRequestOnEstimateApproved} />
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
                    placeholder={'Default: Hi {{firstName}}, reminder: {{companyName}} will be at your property on {{date}} at {{time}} for "{{jobTitle}}". Reply STOP to opt out.'}
                    value={notificationTemplates.serviceReminderSms ?? ''}
                    onChange={e => setNotificationTemplates(t => ({ ...t, serviceReminderSms: e.target.value || undefined as any }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Email Subject</Label>
                  <Input
                    placeholder="Default: Upcoming Service Reminder — {{jobTitle}} on {{date}}"
                    value={notificationTemplates.serviceReminderEmailSubject ?? ''}
                    onChange={e => setNotificationTemplates(t => ({ ...t, serviceReminderEmailSubject: e.target.value || undefined as any }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Email Body</Label>
                  <Textarea
                    rows={6}
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
                    placeholder="Default: Payment reminder — Invoice {{invoiceNumber}} (or 'Payment overdue' when past due)"
                    value={notificationTemplates.paymentReminderEmailSubject ?? ''}
                    onChange={e => setNotificationTemplates(t => ({ ...t, paymentReminderEmailSubject: e.target.value || undefined as any }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Email Body</Label>
                  <Textarea
                    rows={6}
                    placeholder={'Default: Hi {{firstName}},\n\nInvoice {{invoiceNumber}} for ${{amount}} {{dueMessage}}.\n\nPlease arrange payment at your earliest convenience.\n\nThank you,\n{{companyName}}'}
                    value={notificationTemplates.paymentReminderEmailBody ?? ''}
                    onChange={e => setNotificationTemplates(t => ({ ...t, paymentReminderEmailBody: e.target.value || undefined as any }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>SMS Body</Label>
                  <Textarea
                    rows={2}
                    placeholder="Default: Hi {{firstName}}, reminder: invoice {{invoiceNumber}} (${{amount}}) from {{companyName}} {{dueMessage}}. Reply STOP to opt out."
                    value={notificationTemplates.paymentReminderSms ?? ''}
                    onChange={e => setNotificationTemplates(t => ({ ...t, paymentReminderSms: e.target.value || undefined as any }))}
                  />
                </div>
              </div>

              <Button onClick={saveNotificationTemplates} disabled={updateSettings.isPending} variant="outline">
                {updateSettings.isPending ? 'Saving…' : 'Save Templates'}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
