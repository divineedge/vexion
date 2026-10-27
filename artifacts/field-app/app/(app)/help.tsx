import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetExperienceHubQueryKey,
  useGetExperienceHub,
  usePerformExperienceAction,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';

type Kind = 'problem' | 'feature' | 'help';
type Thread = { id: string; kind: Kind; title: string; status: string; createdAt: string; updatedAt: string };
type Message = { id: string; threadId: string; userId: number; body: string; internal: boolean; createdAt: string };
type Content = { id: string; kind: 'help' | 'release'; title: string; body: string; published: boolean; updatedAt: string };
type Hub = { threads?: Thread[]; messages?: Message[]; content?: Content[] };

const KINDS: { key: Kind; label: string }[] = [
  { key: 'problem', label: 'Problem' },
  { key: 'feature', label: 'Idea' },
  { key: 'help', label: 'Question' },
];

export default function HelpScreen() {
  const colors = useColors();
  const qc = useQueryClient();
  const hub = useGetExperienceHub({ query: { queryKey: getGetExperienceHubQueryKey(), refetchInterval: 30000 } });
  const action = usePerformExperienceAction();
  const data = (hub.data ?? {}) as Hub;
  const threads = data.threads ?? [];
  const messages = data.messages ?? [];
  const content = (data.content ?? []).filter(c => c.published);

  const [kind, setKind] = useState<Kind>('problem');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});

  const byThread = useMemo(() => {
    const m: Record<string, Message[]> = {};
    for (const msg of messages) if (!msg.internal) (m[msg.threadId] ??= []).push(msg);
    return m;
  }, [messages]);

  const refresh = () => qc.invalidateQueries({ queryKey: getGetExperienceHubQueryKey() });

  const submit = () => {
    if (!title.trim() || !body.trim()) { Alert.alert('Add a title and details first.'); return; }
    action.mutate({ data: { action: 'createThread', payload: { kind, title: title.trim(), body: body.trim(), page: '/field-app', clientVersion: 'field-app' } } }, {
      onSuccess: () => { setTitle(''); setBody(''); void refresh(); },
      onError: () => Alert.alert('Could not send', 'Your message is still here. Try again.'),
    });
  };

  const reply = (threadId: string) => {
    const text = (replyDrafts[threadId] ?? '').trim();
    if (!text) return;
    action.mutate({ data: { action: 'replyThread', payload: { threadId, body: text } } }, {
      onSuccess: () => { setReplyDrafts(d => ({ ...d, [threadId]: '' })); void refresh(); },
      onError: () => Alert.alert('Reply not sent', 'Try again in a moment.'),
    });
  };

  const card = [styles.card, { backgroundColor: colors.card, borderColor: colors.border }];
  const input = [styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.muted }];

  if (hub.isLoading) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
  if (hub.isError) return (
    <View style={styles.center}>
      <Text style={{ color: colors.mutedForeground }}>Help could not load.</Text>
      <TouchableOpacity onPress={() => hub.refetch()} testID="help-retry"><Text style={{ color: colors.primary, marginTop: 8 }}>Retry</Text></TouchableOpacity>
    </View>
  );

  return (
    <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
      <View style={card}>
        <Text style={[styles.h, { color: colors.foreground }]}>Tell the software team</Text>
        <Text style={{ color: colors.mutedForeground }}>For app problems and ideas. Customer feedback goes through Reviews.</Text>
        <View style={styles.row}>
          {KINDS.map(k => (
            <TouchableOpacity key={k.key} testID={`help-kind-${k.key}`} onPress={() => setKind(k.key)}
              style={[styles.chip, { borderColor: kind === k.key ? colors.primary : colors.border, backgroundColor: kind === k.key ? colors.primary : 'transparent' }]}>
              <Text style={{ color: kind === k.key ? colors.primaryForeground : colors.foreground }}>{k.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TextInput style={input} value={title} onChangeText={setTitle} placeholder="Short title" placeholderTextColor={colors.mutedForeground} testID="help-title" />
        <TextInput style={[input, { minHeight: 90, textAlignVertical: 'top' }]} value={body} onChangeText={setBody} multiline placeholder="What happened, or what would help?" placeholderTextColor={colors.mutedForeground} testID="help-body" />
        <TouchableOpacity testID="help-submit" onPress={submit} disabled={action.isPending} style={[styles.btn, { backgroundColor: colors.primary, opacity: action.isPending ? 0.6 : 1 }]}>
          <Text style={{ color: colors.primaryForeground, fontFamily: 'Inter_600SemiBold' }}>{action.isPending ? 'Sending...' : 'Send'}</Text>
        </TouchableOpacity>
      </View>

      <Text style={[styles.section, { color: colors.mutedForeground }]}>MY REQUESTS</Text>
      {threads.length === 0 ? <Text style={{ color: colors.mutedForeground }}>Nothing sent yet.</Text> : threads.map(t => (
        <View key={t.id} style={card}>
          <TouchableOpacity onPress={() => setOpenId(openId === t.id ? null : t.id)} testID={`help-thread-${t.id}`}>
            <View style={styles.between}>
              <Text style={[styles.title, { color: colors.foreground }]}>{t.title}</Text>
              <Text style={{ color: colors.primary, textTransform: 'capitalize' }}>{t.status.replace('_', ' ')}</Text>
            </View>
            <Text style={{ color: colors.mutedForeground }}>{t.kind} · updated {new Date(t.updatedAt).toLocaleDateString()}</Text>
          </TouchableOpacity>
          {openId === t.id ? (
            <View style={{ gap: 8, marginTop: 6 }}>
              {(byThread[t.id] ?? []).map(m => (
                <View key={m.id} style={[styles.msg, { borderColor: colors.border }]}>
                  <Text style={{ color: colors.foreground }}>{m.body}</Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>{new Date(m.createdAt).toLocaleString()}</Text>
                </View>
              ))}
              <TextInput style={input} value={replyDrafts[t.id] ?? ''} onChangeText={v => setReplyDrafts(d => ({ ...d, [t.id]: v }))} placeholder="Reply" placeholderTextColor={colors.mutedForeground} testID={`help-reply-${t.id}`} />
              <TouchableOpacity onPress={() => reply(t.id)} disabled={action.isPending} testID={`help-reply-send-${t.id}`}>
                <Text style={{ color: colors.primary, fontFamily: 'Inter_600SemiBold' }}>Send reply</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      ))}

      <Text style={[styles.section, { color: colors.mutedForeground }]}>GUIDES AND RELEASE NOTES</Text>
      {content.length === 0 ? <Text style={{ color: colors.mutedForeground }}>No published notes yet.</Text> : content.map(c => (
        <View key={c.id} style={card}>
          <Text style={{ color: colors.primary, fontSize: 11 }}>{c.kind === 'release' ? 'RELEASE' : 'GUIDE'}</Text>
          <Text style={[styles.title, { color: colors.foreground }]}>{c.title}</Text>
          <Text style={{ color: colors.foreground }}>{c.body}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 10, paddingBottom: 48 },
  card: { borderWidth: 1, borderRadius: 10, padding: 13, gap: 8 },
  h: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  title: { fontFamily: 'Inter_600SemiBold', flex: 1 },
  section: { fontFamily: 'Inter_600SemiBold', fontSize: 11, letterSpacing: 1, marginTop: 10 },
  row: { flexDirection: 'row', gap: 8 },
  between: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  input: { borderWidth: 1, borderRadius: 8, padding: 10 },
  btn: { borderRadius: 8, padding: 12, alignItems: 'center' },
  msg: { borderLeftWidth: 2, paddingLeft: 8, gap: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
});
