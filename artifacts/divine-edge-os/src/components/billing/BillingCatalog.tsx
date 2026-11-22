import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { toast } from "sonner";
import { customFetch, useListInventoryItems, getListInventoryItemsQueryKey, type InventoryItem } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { customerPriceFromMarkup } from "@/lib/lineEntry";
import type { PassThroughRow } from "./LineCatalogSearch";

const emptyForm = { description: "", unit: "", internalCost: "", markup: "0", unitPrice: "" };

export function BillingCatalog({ tab }: { tab: "passthrough" | "kits" }) {
  if (tab === "kits") return <KitsTab />;
  return <PassThroughTab />;
}

function PassThroughTab() {
  const qc = useQueryClient();
  const rows = useQuery({
    queryKey: ["line-catalog"],
    queryFn: () => customFetch<PassThroughRow[]>("/api/line-catalog"),
  });
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [priceTouched, setPriceTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  function setCost(internalCost: string) {
    setForm(current => {
      const markup = parseFloat(current.markup) || 0;
      const cost = internalCost === "" ? null : parseFloat(internalCost);
      const unitPrice = !priceTouched && cost != null && Number.isFinite(cost)
        ? String(customerPriceFromMarkup(cost, markup))
        : current.unitPrice;
      return { ...current, internalCost, unitPrice };
    });
  }
  function setMarkup(markup: string) {
    setForm(current => {
      const cost = current.internalCost === "" ? null : parseFloat(current.internalCost);
      const pct = parseFloat(markup) || 0;
      const unitPrice = !priceTouched && cost != null && Number.isFinite(cost)
        ? String(customerPriceFromMarkup(cost, pct))
        : current.unitPrice;
      return { ...current, markup, unitPrice };
    });
  }

  async function save() {
    if (!form.description.trim()) {
      toast.error("Description is required");
      return;
    }
    const body = {
      description: form.description.trim(),
      unit: form.unit.trim() || null,
      internalCost: form.internalCost === "" ? null : parseFloat(form.internalCost),
      markup: parseFloat(form.markup) || 0,
      unitPrice: form.unitPrice === "" ? 0 : parseFloat(form.unitPrice),
    };
    setSaving(true);
    try {
      if (editingId) await customFetch(`/api/line-catalog/${editingId}`, { method: "PATCH", body: JSON.stringify(body) });
      else await customFetch("/api/line-catalog", { method: "POST", body: JSON.stringify(body) });
      toast.success(editingId ? "Pass-through item updated" : "Pass-through item saved");
      setForm(emptyForm);
      setEditingId(null);
      setPriceTouched(false);
      await qc.invalidateQueries({ queryKey: ["line-catalog"] });
    } catch (error) {
      const message = (error as { data?: { error?: string } })?.data?.error ?? "Could not save pass-through item";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: number) {
    try {
      await customFetch(`/api/line-catalog/${id}`, { method: "DELETE" });
      if (editingId === id) {
        setEditingId(null);
        setForm(emptyForm);
      }
      toast.success("Pass-through item removed");
      await qc.invalidateQueries({ queryKey: ["line-catalog"] });
    } catch {
      toast.error("Could not remove that item");
    }
  }

  return (
    <div className="space-y-4" data-testid="passthrough-tab">
      <Card>
        <CardHeader>
          <CardTitle>Custom / Pass-through</CardTitle>
          <CardDescription data-testid="passthrough-explainer">
            Pass-through is for charges that are not a catalog service or a stocked part, such as a dump truck load or an equipment rental.
            Markup is a percent added to the internal cost. A $100 internal cost with 25% markup is a $125 customer price.
            Save a default here, then pick it on an estimate or invoice so you do not retype it. A one-off custom line still works on the estimate or invoice itself.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <label className="text-sm font-medium" htmlFor="passthrough-description">Description</label>
              <Input id="passthrough-description" data-testid="passthrough-description" value={form.description} onChange={event => setForm(current => ({ ...current, description: event.target.value }))} placeholder="Dump truck load" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="passthrough-unit">Unit</label>
              <Input id="passthrough-unit" data-testid="passthrough-unit" value={form.unit} onChange={event => setForm(current => ({ ...current, unit: event.target.value }))} placeholder="Load, Day, Each" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="passthrough-cost">Internal cost</label>
              <Input id="passthrough-cost" data-testid="passthrough-cost" type="number" min={0} step={0.01} value={form.internalCost} onChange={event => setCost(event.target.value)} placeholder="What it costs you" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="passthrough-markup">Markup %</label>
              <Input id="passthrough-markup" data-testid="passthrough-markup" type="number" min={0} step={1} value={form.markup} onChange={event => setMarkup(event.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="passthrough-price">Customer unit price</label>
              <Input id="passthrough-price" data-testid="passthrough-price" type="number" min={0} step={0.01} value={form.unitPrice} onChange={event => { setPriceTouched(true); setForm(current => ({ ...current, unitPrice: event.target.value })); }} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button data-testid="passthrough-save" onClick={save} disabled={saving}>{saving ? "Saving…" : editingId ? "Update default" : "Save default"}</Button>
            {editingId && <Button variant="ghost" onClick={() => { setEditingId(null); setForm(emptyForm); setPriceTouched(false); }}>Cancel</Button>}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Saved defaults</CardTitle>
          <CardDescription>Choosing one of these on an estimate or invoice fills the line.</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.isLoading && <p className="text-sm text-muted-foreground">Loading saved pass-through items…</p>}
          {rows.isError && <p className="text-sm text-destructive">Could not load saved pass-through items.</p>}
          {(rows.data ?? []).length === 0 && !rows.isLoading && <p className="text-sm text-muted-foreground">No saved pass-through items yet.</p>}
          <ul className="divide-y">
            {(rows.data ?? []).map(row => (
              <li key={row.id} className="flex items-center gap-3 py-2 text-sm" data-testid={`passthrough-row-${row.id}`}>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{row.description}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.unit ? `${row.unit} · ` : ""}
                    {row.internalCost != null ? `internal $${Number(row.internalCost).toFixed(2)} · ` : ""}
                    {Number(row.markup)}% markup · customer ${Number(row.unitPrice).toFixed(2)}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => {
                  setEditingId(row.id);
                  setPriceTouched(true);
                  setForm({
                    description: row.description,
                    unit: row.unit ?? "",
                    internalCost: row.internalCost == null ? "" : String(row.internalCost),
                    markup: String(row.markup ?? 0),
                    unitPrice: String(row.unitPrice ?? 0),
                  });
                }}>Edit</Button>
                <Button variant="ghost" size="sm" onClick={() => remove(row.id)}>Remove</Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function KitsTab() {
  const inventory = useListInventoryItems(undefined, { query: { queryKey: getListInventoryItemsQueryKey() } });
  const items = (inventory.data ?? []) as InventoryItem[];
  const kits = items.filter(item => item.linkedParts && item.linkedParts.components.length > 0);
  return (
    <Card data-testid="kits-tab">
      <CardHeader>
        <CardTitle>Kits</CardTitle>
        <CardDescription>
          These are inventory kits. This list does not create a second kit. Putting a kit on an estimate or invoice shows one kit line.
          Stock moves when that kit is used on a job or recorded in inventory, not when the estimate or invoice is saved.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {inventory.isLoading && <p className="text-sm text-muted-foreground">Loading inventory kits…</p>}
        {inventory.isError && <p className="text-sm text-destructive">Could not load inventory.</p>}
        {!inventory.isLoading && items.length === 0 && (
          <p data-testid="kits-empty" className="text-sm">Add parts in Inventory before building a kit.</p>
        )}
        {!inventory.isLoading && items.length > 0 && kits.length === 0 && (
          <p data-testid="kits-empty" className="text-sm">
            No kits yet. Add parts in Inventory, then link the parts that belong in a kit. This tab only reads those kits.
          </p>
        )}
        {kits.length > 0 && (
          <ul className="divide-y" data-testid="kits-list">
            {kits.map(kit => (
              <li key={kit.id} className="py-3 text-sm" data-testid={`kit-row-${kit.id}`}>
                <p className="font-medium">{kit.name} <span className="text-xs font-normal text-muted-foreground">Kit</span></p>
                <p className="text-xs text-muted-foreground mt-1">
                  {kit.linkedParts!.quantity} {kit.unit || "units"} uses {kit.linkedParts!.components.map(component => `${component.quantity} ${component.unit || "units"} ${component.name}`).join(", ")}.
                  {" "}Customer price ${Number(kit.unitPrice ?? 0).toFixed(2)}.
                </p>
              </li>
            ))}
          </ul>
        )}
        <Button variant="outline" size="sm" asChild>
          <Link href="/inventory">Open Inventory</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
