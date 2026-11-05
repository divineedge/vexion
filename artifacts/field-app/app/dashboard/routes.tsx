import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import Svg, { Circle, Polyline, Text as SvgText } from 'react-native-svg';
import { DemoCard, DemoFrame, StatusPill } from '@/components/demo/DemoFrame';
import { useDemoSandbox } from '@/components/demo/useDemoSandbox';
import { jobStatusLabel } from '@/components/demo/format';
import { useColors } from '@/hooks/useColors';
import { propertyById, type JobStatus } from '@/utils/demoSandbox';

function tone(status: JobStatus): 'good' | 'warn' | 'info' | 'muted' {
  if (status === 'completed') return 'good';
  if (status === 'in_progress') return 'warn';
  if (status === 'en_route') return 'info';
  return 'muted';
}

export default function RoutesScreen() {
  const colors = useColors();
  const sandbox = useDemoSandbox();
  return (
    <DemoFrame title="Routes">
      {sandbox?.routes.map(route => {
        const crew = sandbox.crews.find(item => item.id === route.crewId);
        const stops = route.jobIds.map(id => sandbox.jobs.find(job => job.id === id)).filter(Boolean).map(job => {
          const property = propertyById(sandbox, job!.propertyId);
          return { job: job!, property };
        });
        const points = project(stops.map(stop => ({ lat: stop.property?.lat ?? 0, lng: stop.property?.lng ?? 0 })));
        return (
          <DemoCard key={route.id}>
            <Text style={[styles.title, { color: colors.foreground }]}>{route.name}</Text>
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>{crew?.name} · {crew?.focus}</Text>
            <Svg width="100%" height={240} viewBox="0 0 320 240">
              <Polyline points={points.map(point => `${point.x},${point.y}`).join(' ')} stroke={colors.primary} strokeWidth={3} fill="none" />
              {points.map((point, index) => (
                <React.Fragment key={stops[index].job.id}>
                  <Circle cx={point.x} cy={point.y} r={12} fill={colors.primary} />
                  <SvgText x={point.x} y={point.y + 4} fill="#ffffff" fontSize="11" textAnchor="middle">{index + 1}</SvgText>
                </React.Fragment>
              ))}
            </Svg>
            {stops.map((stop, index) => (
              <View key={stop.job.id} style={styles.stop}>
                <Text style={[styles.stopIndex, { color: colors.primary }]}>{index + 1}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.stopTitle, { color: colors.foreground }]}>{stop.property?.address}</Text>
                  <Text style={[styles.meta, { color: colors.mutedForeground }]}>{stop.job.title}</Text>
                </View>
                <StatusPill label={jobStatusLabel[stop.job.status]} tone={tone(stop.job.status)} />
              </View>
            ))}
          </DemoCard>
        );
      })}
    </DemoFrame>
  );
}

function project(stops: { lat: number; lng: number }[]) {
  const lats = stops.map(stop => stop.lat);
  const lngs = stops.map(stop => stop.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  return stops.map(stop => ({
    x: 28 + ((stop.lng - minLng) / Math.max(maxLng - minLng, 0.001)) * 264,
    y: 24 + ((maxLat - stop.lat) / Math.max(maxLat - minLat, 0.001)) * 180,
  }));
}

const styles = StyleSheet.create({
  title: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  meta: { fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 2 },
  stop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  stopIndex: { fontFamily: 'Inter_700Bold', fontSize: 16, width: 18 },
  stopTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
});
