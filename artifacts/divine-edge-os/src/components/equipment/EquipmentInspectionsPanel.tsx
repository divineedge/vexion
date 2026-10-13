import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useListEquipmentInspections, getListEquipmentInspectionsQueryKey, useReviewEquipmentInspection, useListEquipmentPreTripMedia, getListEquipmentPreTripMediaQueryKey } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import MediaGallery from '@/components/media/MediaGallery';
import { toast } from 'sonner';

function InspectionMedia({ reference }: { reference: string }) {
  const media = useListEquipmentPreTripMedia(reference, { query: { queryKey: getListEquipmentPreTripMediaQueryKey(reference) } });
  if (media.isLoading) return <p>Loading photos…</p>;
  if (media.isError) return <p>Could not load inspection photos. <Button variant="outline" onClick={() => media.refetch()}>Retry</Button></p>;
  return <MediaGallery entityType="pre_trip_inspection" entityId={reference} media={media.data ?? []} onMediaAdded={() => media.refetch()} onMediaDeleted={() => media.refetch()} readOnly />;
}

export default function EquipmentInspectionsPanel({ equipmentId }: { equipmentId: number }) {
  const query = useListEquipmentInspections(equipmentId, { query: { queryKey: getListEquipmentInspectionsQueryKey(equipmentId), refetchInterval: 30000 } });
  const review = useReviewEquipmentInspection();
  const qc = useQueryClient();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  if (query.isLoading) return <p className="p-4 text-sm">Loading inspection records…</p>;
  if (query.isError) return <div className="p-4 text-sm">Could not load inspections. <Button variant="outline" onClick={() => query.refetch()}>Retry</Button></div>;
  return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">Latest 200 recorded checks. Fuel is included in this equipment’s operating costs—not assigned as a task. Reviewing a check does not clear an unsafe condition.</p>
    {!query.data?.records.length && <p className="text-sm py-4">No inspection records yet.</p>}
    {query.data?.records.map(record => <details key={record.ref} className="rounded-lg border p-3" onToggle={event => { const open = event.currentTarget.open; setExpanded(current => ({ ...current, [record.ref]: open })); }}>
      <summary className="cursor-pointer font-medium">{record.title} · {new Date(record.recordedAt).toLocaleString()} · {record.reviews.length ? 'Reviewed' : 'Awaiting review'}</summary>
      <div className="space-y-3 pt-3 text-sm">
        <p>Recorded by {record.recordedBy}</p>
        <p className="whitespace-pre-wrap">{record.description}</p>
        {record.fuel && <p>Fuel: {record.fuel.gallons} gallons · ${(record.fuel.cost ?? 0).toFixed(2)}{record.fuel.bulkFuelTankName ? ` · ${record.fuel.bulkFuelTankName}` : ''}</p>}
        {record.reading && <p>{record.reading.readingType}: {record.reading.value}</p>}
        <ul>{record.checklist.map(item => <li key={item.id}>{item.checked ? 'Checked' : 'Not checked'} — {item.label}</li>)}</ul>
        {expanded[record.ref] && <InspectionMedia reference={record.ref} />}
        {record.reviews.map(item => <div key={item.id} className="rounded bg-muted p-2">
          <p>Reviewed by {item.reviewedBy} · {new Date(item.reviewedAt).toLocaleString()}</p>
          <p className="whitespace-pre-wrap">{item.notes || 'Reviewed without additional notes.'}</p>
        </div>)}
        {query.data?.canReview && <div className="space-y-2">
          <Textarea aria-label="Inspection review notes" placeholder="Crew-manager review notes (optional)" maxLength={4000} value={notes[record.ref] ?? ''} onChange={e => setNotes(current => ({ ...current, [record.ref]: e.target.value }))} />
          <Button disabled={review.isPending} onClick={() => review.mutate({ id: equipmentId, ref: record.ref, data: { notes: notes[record.ref] ?? '' } }, {
            onSuccess: () => { setNotes(current => ({ ...current, [record.ref]: '' })); qc.invalidateQueries({ queryKey: getListEquipmentInspectionsQueryKey(equipmentId) }); toast.success('Manager review recorded'); },
            onError: () => toast.error('Could not record review. Your notes are kept.'),
          })}>Record manager review</Button>
        </div>}
      </div>
    </details>)}
  </div>;
}
