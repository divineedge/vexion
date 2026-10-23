import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  getListJobMessagesQueryKey,
  getListStaffConversationMessagesQueryKey,
  getListStaffMessageAudiencesQueryKey,
  getListStaffMessageThreadsQueryKey,
  getListStaffMessagesQueryKey,
  getGetJobMessagesUnreadSummaryQueryKey,
  getGetStaffMessagesUnreadSummaryQueryKey,
  listJobMessages,
  listStaffMessages,
  listStaffConversationMessages,
  createJobMessage,
  createStaffMessage,
  createStaffConversationMessage,
  sendStaffMessageToAudience,
  useListJobMessages,
  useListStaffConversationMessages,
  useListStaffMessageAudiences,
  useListStaffMessageThreads,
  useListStaffMessages,
  type StaffMessageAudience,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useColors } from '@/hooks/useColors';
import { useOffline } from '@/contexts/OfflineContext';
import { hasEarlierMessagePage, mergeMessagePages, messageBeforeId, messagePollInterval } from '@/utils/messages';
import {
  enqueueOutbox,
  flushOutbox,
  loadOutbox,
  mergeMessagesByClientId,
  messageOutboxKey,
  retryOutbox,
  type OutboxMessage,
} from '@/utils/messageOutbox';

type ServerMessage = {
  id: number; clientMessageId: string | null; senderId: number; senderName: string;
  senderRole: string; body: string; createdAt: string; readByOthers: boolean;
};

export default function MessagesScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { isOffline, reportNetworkStatus } = useOffline();
  const params = useLocalSearchParams<{ jobId?: string; title?: string }>();
  const jobId = params.jobId ? Number(params.jobId) : null;
  const isJob = Number.isInteger(jobId);
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState('');
  const [outbox, setOutbox] = useState<OutboxMessage[]>([]);
  const [olderPages, setOlderPages] = useState<ServerMessage[][]>([]);
  const [newestHistory, setNewestHistory] = useState<ServerMessage[]>([]);
  const [earlierLoading, setEarlierLoading] = useState(false);
  const [earlierError, setEarlierError] = useState('');
  const [selectedAudience, setSelectedAudience] = useState<StaffMessageAudience | null>(null);
  const [recipientPickerOpen, setRecipientPickerOpen] = useState(false);
  const [recipientSearch, setRecipientSearch] = useState('');
  const listRef = useRef<FlatList>(null);
  const flushingRef = useRef(false);

  const generalParams = { limit: 100 };
  const jobParams = { limit: 100 };
  const threadsQuery = useListStaffMessageThreads({
    query: { enabled: !!user && !isJob, queryKey: getListStaffMessageThreadsQueryKey(), refetchInterval: !isJob ? messagePollInterval(focused, isOffline) : false },
  });
  const audiencesQuery = useListStaffMessageAudiences({
    query: { enabled: !!user && !isJob, queryKey: getListStaffMessageAudiencesQueryKey(), staleTime: 30000 },
  });
  const matchingThreads = selectedAudience
    ? (threadsQuery.data ?? []).filter(thread => thread.audienceType === selectedAudience.audienceType && (thread.audienceId ?? null) === selectedAudience.audienceId)
    : [];
  const selectedThread = matchingThreads.find(thread => thread.isSharedAudience) ?? matchingThreads[0] ?? null;
  const selectedConversationId = selectedThread?.conversationId ?? null;
  const selectedLegacyThreadId = selectedThread && !selectedConversationId ? selectedThread.threadUserId : null;
  const general = useListStaffMessages(selectedLegacyThreadId ?? 0, generalParams, {
    query: {
      enabled: !!user && !isJob && selectedLegacyThreadId != null,
      queryKey: getListStaffMessagesQueryKey(selectedLegacyThreadId ?? 0, generalParams),
      refetchInterval: !isJob && selectedLegacyThreadId != null ? messagePollInterval(focused, isOffline) : false,
    },
  });
  const group = useListStaffConversationMessages(selectedConversationId ?? 0, generalParams, {
    query: {
      enabled: !!user && !isJob && selectedConversationId != null,
      queryKey: getListStaffConversationMessagesQueryKey(selectedConversationId ?? 0, generalParams),
      refetchInterval: !isJob && selectedConversationId != null ? messagePollInterval(focused, isOffline) : false,
    },
  });
  const job = useListJobMessages(jobId ?? 0, jobParams, {
    query: {
      enabled: isJob,
      queryKey: getListJobMessagesQueryKey(jobId ?? 0, jobParams),
      refetchInterval: isJob ? messagePollInterval(focused, isOffline) : false,
    },
  });
  const activeQuery = isJob ? job : selectedConversationId ? group : general;
  const hasGeneralTarget = isJob || !!selectedAudience;
  const context = isJob
    ? { kind: 'job' as const, jobId: jobId! }
    : { kind: 'audience' as const, audienceType: selectedAudience?.audienceType ?? 'none', audienceId: selectedAudience?.audienceId ?? null };
  const outboxKey = user && hasGeneralTarget ? messageOutboxKey(user.tenantId, user.id, context) : '';
  const serverMessages = (activeQuery.data ?? []) as ServerMessage[];
  const loadedServerMessages = mergeMessagePages(serverMessages, [...olderPages, newestHistory]);
  const messages = mergeMessagesByClientId(loadedServerMessages, outbox);
  const canLoadEarlier = hasEarlierMessagePage(serverMessages, olderPages);
  const sending = outbox.some(item => item.status === 'sending');

  const refresh = useCallback(() => {
    if (!hasGeneralTarget) return;
    void activeQuery.refetch();
  }, [activeQuery.refetch, hasGeneralTarget]);
  const loadEarlier = useCallback(async () => {
    const beforeId = messageBeforeId(loadedServerMessages);
    if (!beforeId || earlierLoading) return;
    setEarlierLoading(true);
    setEarlierError('');
    try {
      const page = (isJob
        ? await listJobMessages(jobId!, { limit: 100, beforeId })
        : selectedConversationId
          ? await listStaffConversationMessages(selectedConversationId, { limit: 100, beforeId })
          : await listStaffMessages(selectedLegacyThreadId!, { limit: 100, beforeId })) as ServerMessage[];
      setOlderPages(current => [...current, page]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetJobMessagesUnreadSummaryQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetStaffMessagesUnreadSummaryQueryKey() }),
      ]);
    } catch {
      setEarlierError('Couldn’t load earlier messages.');
    } finally {
      setEarlierLoading(false);
    }
  }, [loadedServerMessages, earlierLoading, isJob, jobId, selectedConversationId, selectedLegacyThreadId, queryClient]);
  const flush = useCallback(async (force = false) => {
    if (!outboxKey || !user || (isOffline && !force) || flushingRef.current) return;
    flushingRef.current = true;
    try {
      const remaining = await flushOutbox(outboxKey, async item => {
        setOutbox(current => current.map(entry => entry.clientMessageId === item.clientMessageId ? { ...entry, status: 'sending' } : entry));
        if (isJob) await createJobMessage(jobId!, { body: item.body, clientMessageId: item.clientMessageId });
        else if (selectedConversationId) await createStaffConversationMessage(selectedConversationId, { body: item.body, clientMessageId: item.clientMessageId });
        else if (selectedLegacyThreadId) await createStaffMessage(selectedLegacyThreadId, { body: item.body, clientMessageId: item.clientMessageId });
        else if (selectedAudience) await sendStaffMessageToAudience({
          audienceType: selectedAudience.audienceType,
          audienceId: selectedAudience.audienceId,
          body: item.body,
          clientMessageId: item.clientMessageId,
        });
        else throw new Error('Choose a staff audience');
      });
      if (remaining.some(item => item.status === 'failed')) {
        setOutbox(remaining);
        reportNetworkStatus(true);
      } else {
        reportNetworkStatus(false);
        await Promise.all([activeQuery.refetch(), threadsQuery.refetch()]);
        setOutbox(remaining);
      }
    } catch {
      setSendError('Could not process the saved message queue. It remains on this device.');
      setOutbox(await loadOutbox(outboxKey));
    } finally {
      flushingRef.current = false;
    }
  }, [outboxKey, user, isOffline, isJob, jobId, selectedConversationId, selectedLegacyThreadId, selectedAudience, activeQuery.refetch, threadsQuery.refetch, reportNetworkStatus]);
  useEffect(() => {
    let active = true;
    setOutbox([]);
    if (outboxKey) void loadOutbox(outboxKey).then(items => { if (active) setOutbox(items); });
    return () => { active = false; };
  }, [outboxKey]);
  useEffect(() => {
    setOlderPages([]);
    setNewestHistory([]);
    setEarlierError('');
    setEarlierLoading(false);
  }, [outboxKey, isJob, jobId, user?.id, user?.tenantId]);
  useEffect(() => {
    if (serverMessages.length) {
      setNewestHistory(current => mergeMessagePages(serverMessages, [current]));
    }
  }, [serverMessages]);
  useEffect(() => {
    if (!isOffline && focused && outbox.length) void flush();
  }, [isOffline, focused, outboxKey]);
  useEffect(() => {
    if (!focused) return;
    const next = outbox.find(item => item.status === 'failed' && item.nextAttemptAt);
    if (!next?.nextAttemptAt) return;
    const timer = setTimeout(() => { void flush(true); }, Math.max(0, next.nextAttemptAt - Date.now()));
    return () => clearTimeout(timer);
  }, [focused, outbox, flush]);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    refresh();
    void flush(true);
    return () => setFocused(false);
  }, [refresh, flush]));
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active' && focused) { refresh(); void flush(true); }
    });
    return () => subscription.remove();
  }, [focused, refresh, flush]);
  useEffect(() => {
    if (messages.length) requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, [messages.length]);

  const send = useCallback(() => {
    const body = draft.trim();
    if (!body || sending || !user || !outboxKey || !hasGeneralTarget) return;
    setSendError('');
    void enqueueOutbox(outboxKey, body).then(item => {
      setDraft('');
      setOutbox(current => [...current, item]);
      if (!isOffline) void flush();
    }).catch(() => setSendError('Could not save this message. Your draft was kept.'));
  }, [draft, sending, user, outboxKey, isOffline, flush, hasGeneralTarget]);

  return (
    <KeyboardAvoidingView style={[styles.container, { backgroundColor: colors.background }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.context, { borderBottomColor: colors.border, backgroundColor: colors.card }]}>
        <Ionicons name={isJob ? 'briefcase-outline' : 'people-outline'} size={18} color={colors.primary} />
        <View>
          <Text style={[styles.contextTitle, { color: colors.foreground }]}>{isJob ? (params.title || 'Job Messages') : `To: ${selectedAudience?.label ?? 'Choose recipient'}`}</Text>
          <Text style={[styles.contextHint, { color: colors.mutedForeground }]}>{isJob ? 'Job staff conversation' : selectedAudience?.audienceType === 'staff' ? 'Direct staff conversation' : 'Staff team conversation'} · refreshes about every 45 seconds</Text>
        </View>
      </View>
      {!isJob && (
        <View style={[styles.recipientBar, { borderBottomColor: colors.border, backgroundColor: colors.card }]}>
          <Text style={[styles.recipientLabel, { color: colors.mutedForeground }]}>TO</Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Choose a message recipient"
            onPress={() => setRecipientPickerOpen(true)}
            style={[styles.recipientButton, { borderColor: colors.border, backgroundColor: colors.background }]}
          >
            <Ionicons name={selectedAudience?.audienceType === 'staff' ? 'person-outline' : 'people-outline'} size={17} color={colors.primary} />
            <Text style={[styles.recipientValue, { color: selectedAudience ? colors.foreground : colors.mutedForeground }]} numberOfLines={1}>
              {audiencesQuery.isLoading ? 'Loading recipients…' : selectedAudience?.label ?? 'Choose a person or team'}
            </Text>
            <Ionicons name="chevron-down" size={17} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>
      )}
      {isOffline && (
        <View style={styles.offline}><Ionicons name="cloud-offline-outline" size={15} color="#fef3c7" /><Text style={styles.offlineText}>Offline · messages will be queued on this device</Text></View>
      )}
      {!hasGeneralTarget ? (
        <View style={styles.center}>
          <Ionicons name="person-add-outline" size={44} color={colors.mutedForeground} />
          <Text style={{ color: colors.foreground }}>Choose who to message</Text>
          <Text style={{ color: colors.mutedForeground, textAlign: 'center' }}>Select one person or a team using the To control above.</Text>
        </View>
      ) : activeQuery.isLoading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /><Text style={{ color: colors.mutedForeground }}>Loading messages…</Text></View>
      ) : activeQuery.isError ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={42} color={colors.mutedForeground} />
          <Text style={{ color: colors.foreground }}>Couldn’t load messages</Text>
          <TouchableOpacity onPress={refresh} style={[styles.retry, { borderColor: colors.border }]}><Text style={{ color: colors.primary }}>Try Again</Text></TouchableOpacity>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={item => 'id' in item ? String(item.id) : `local-${item.clientMessageId}`}
          contentContainerStyle={messages.length ? styles.list : styles.emptyList}
          refreshControl={<RefreshControl refreshing={activeQuery.isFetching && !activeQuery.isLoading} onRefresh={refresh} tintColor={colors.primary} />}
          ListHeaderComponent={canLoadEarlier || earlierError ? (
            <View style={styles.earlier}>
              <TouchableOpacity disabled={earlierLoading} onPress={() => void loadEarlier()} style={[styles.retry, { borderColor: colors.border }]}>
                {earlierLoading ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={{ color: colors.primary }}>{earlierError ? 'Retry loading earlier messages' : 'Load earlier messages'}</Text>}
              </TouchableOpacity>
              {!!earlierError && <Text style={styles.error}>{earlierError}</Text>}
            </View>
          ) : undefined}
          ListEmptyComponent={<View style={styles.center}><Ionicons name="chatbubbles-outline" size={44} color={colors.mutedForeground} /><Text style={{ color: colors.foreground }}>No messages yet</Text><Text style={{ color: colors.mutedForeground }}>Start the staff conversation below.</Text></View>}
          renderItem={({ item }) => {
            const local = !('id' in item);
            const own = local || item.senderId === user?.id;
            return (
              <View style={[styles.messageWrap, own ? styles.own : styles.other]}>
                <Text style={[styles.meta, { color: colors.mutedForeground }]}>{local ? user?.name : item.senderName} · {local ? user?.role.replaceAll('_', ' ') : item.senderRole.replaceAll('_', ' ')} · {new Date(item.createdAt).toLocaleString()}</Text>
                <View style={[styles.bubble, { backgroundColor: own ? colors.primary : colors.card, borderColor: colors.border }]}>
                  <Text style={{ color: own ? colors.primaryForeground : colors.foreground }}>{item.body}</Text>
                </View>
                {own && (
                  <View style={styles.deliveryRow}>
                    <Text style={[styles.meta, { color: local && item.status === 'failed' ? '#dc2626' : colors.mutedForeground }]}>
                      {local ? (item.status === 'sending' ? 'Sending…' : item.status === 'failed' ? `Failed · attempt ${item.attempts}` : 'Queued') : item.readByOthers ? 'Read' : 'Sent'}
                    </Text>
                    {local && item.status === 'failed' && (
                      <TouchableOpacity onPress={() => {
                        void retryOutbox(outboxKey, item.clientMessageId).then(next => { setOutbox(next); void flush(true); });
                      }}><Text style={{ color: colors.primary, fontSize: 11 }}>Retry</Text></TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            );
          }}
        />
      )}
      <View style={[styles.composer, { borderTopColor: colors.border, backgroundColor: colors.card }]}>
        {!!sendError && <Text style={styles.error}>{sendError}</Text>}
        <View style={styles.composeRow}>
          <TextInput
            value={draft}
            onChangeText={text => { setDraft(text); if (sendError) setSendError(''); }}
            editable={!sending && hasGeneralTarget}
            placeholder={!hasGeneralTarget ? 'Choose who to message first…' : isOffline ? 'Message will be queued…' : `Message ${selectedAudience?.label ?? 'staff'}…`}
            placeholderTextColor={colors.mutedForeground}
            multiline
            maxLength={4000}
            style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
          />
          <TouchableOpacity disabled={!draft.trim() || sending || !hasGeneralTarget} onPress={send} style={[styles.send, { backgroundColor: !draft.trim() || !hasGeneralTarget ? colors.mutedForeground : colors.primary }]}>
            {sending ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name={sendError ? 'refresh' : 'send'} size={19} color="#fff" />}
          </TouchableOpacity>
        </View>
      </View>
      {!isJob && (
        <Modal visible={recipientPickerOpen} transparent animationType="slide" onRequestClose={() => setRecipientPickerOpen(false)}>
          <View style={styles.modalBackdrop}>
            <View style={[styles.recipientSheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.modalHeader}>
                <View>
                  <Text style={[styles.modalTitle, { color: colors.foreground }]}>Choose recipient</Text>
                  <Text style={[styles.modalHint, { color: colors.mutedForeground }]}>Select one active person or a team</Text>
                </View>
                <TouchableOpacity accessibilityLabel="Close recipient picker" onPress={() => setRecipientPickerOpen(false)} style={styles.closeButton}>
                  <Ionicons name="close" size={24} color={colors.foreground} />
                </TouchableOpacity>
              </View>
              <View style={[styles.searchBox, { borderColor: colors.border, backgroundColor: colors.background }]}>
                <Ionicons name="search-outline" size={18} color={colors.mutedForeground} />
                <TextInput
                  value={recipientSearch}
                  onChangeText={setRecipientSearch}
                  placeholder="Search people and teams"
                  placeholderTextColor={colors.mutedForeground}
                  style={[styles.searchInput, { color: colors.foreground }]}
                  autoCapitalize="none"
                />
              </View>
              {audiencesQuery.isError ? (
                <View style={styles.pickerEmpty}>
                  <Text style={{ color: colors.foreground }}>Couldn’t load recipients</Text>
                  <TouchableOpacity onPress={() => void audiencesQuery.refetch()}><Text style={{ color: colors.primary }}>Try again</Text></TouchableOpacity>
                </View>
              ) : audiencesQuery.isLoading ? (
                <View style={styles.pickerEmpty}><ActivityIndicator color={colors.primary} /></View>
              ) : (
                <ScrollView style={styles.recipientList} keyboardShouldPersistTaps="handled">
                  {(['staff', 'groups'] as const).map(section => {
                    const query = recipientSearch.trim().toLowerCase();
                    const options = (audiencesQuery.data ?? []).filter(audience =>
                      (section === 'staff' ? audience.audienceType === 'staff' : audience.audienceType !== 'staff')
                      && (!query || `${audience.label} ${audience.description}`.toLowerCase().includes(query)),
                    );
                    if (!options.length) return null;
                    return (
                      <View key={section} style={styles.recipientSection}>
                        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>{section === 'staff' ? 'INDIVIDUALS' : 'TEAMS AND GROUPS'}</Text>
                        {options.map(audience => {
                          const active = selectedAudience?.audienceType === audience.audienceType && selectedAudience.audienceId === audience.audienceId;
                          return (
                            <TouchableOpacity
                              key={`${audience.audienceType}:${audience.audienceId ?? 'all'}`}
                              disabled={!audience.canSend}
                              onPress={() => {
                                setSelectedAudience(audience);
                                setRecipientSearch('');
                                setRecipientPickerOpen(false);
                              }}
                              style={[styles.recipientOption, { borderBottomColor: colors.border, opacity: audience.canSend ? 1 : 0.45 }]}
                            >
                              <Ionicons name={audience.audienceType === 'staff' ? 'person-circle-outline' : 'people-circle-outline'} size={28} color={colors.primary} />
                              <View style={styles.optionCopy}>
                                <Text style={[styles.optionTitle, { color: colors.foreground }]}>{audience.label}</Text>
                                <Text style={[styles.optionDescription, { color: colors.mutedForeground }]} numberOfLines={1}>
                                  {audience.description}{audience.audienceType === 'staff' ? '' : ` · ${audience.memberCount} members`}
                                </Text>
                              </View>
                              {active && <Ionicons name="checkmark-circle" size={22} color={colors.primary} />}
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    );
                  })}
                  {(audiencesQuery.data ?? []).length === 0 && (
                    <View style={styles.pickerEmpty}><Text style={{ color: colors.mutedForeground }}>No active staff or teams found.</Text></View>
                  )}
                </ScrollView>
              )}
            </View>
          </View>
        </Modal>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  context: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderBottomWidth: 1 },
  contextTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  contextHint: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 2 },
  recipientBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: 1 },
  recipientLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 11, letterSpacing: 0.8 },
  recipientButton: { flex: 1, minHeight: 42, borderWidth: 1, borderRadius: 10, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 8 },
  recipientValue: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 14 },
  offline: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, backgroundColor: '#92400e', padding: 7 },
  offlineText: { color: '#fef3c7', fontSize: 12 },
  list: { padding: 14, gap: 12 },
  emptyList: { flexGrow: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  retry: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 18, paddingVertical: 9 },
  messageWrap: { maxWidth: '88%', gap: 4 },
  own: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  other: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  meta: { fontFamily: 'Inter_400Regular', fontSize: 10 },
  bubble: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9 },
  composer: { borderTopWidth: 1, padding: 10, gap: 6 },
  composeRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: { flex: 1, minHeight: 42, maxHeight: 110, borderWidth: 1, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9 },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  error: { color: '#dc2626', fontSize: 12 },
  deliveryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  earlier: { alignItems: 'center', gap: 6, marginBottom: 8 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  recipientSheet: { maxHeight: '82%', minHeight: '58%', borderWidth: 1, borderBottomWidth: 0, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 18, paddingHorizontal: 16, paddingBottom: 24 },
  modalHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 },
  modalTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 20 },
  modalHint: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 3 },
  closeButton: { padding: 4 },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 11, marginBottom: 10 },
  searchInput: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 14, paddingVertical: 9 },
  recipientList: { flex: 1 },
  recipientSection: { marginBottom: 14 },
  sectionLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 10, letterSpacing: 0.8, paddingHorizontal: 4, paddingVertical: 8 },
  recipientOption: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 4, paddingVertical: 9 },
  optionCopy: { flex: 1 },
  optionTitle: { fontFamily: 'Inter_500Medium', fontSize: 14 },
  optionDescription: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 2 },
  pickerEmpty: { minHeight: 160, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
});