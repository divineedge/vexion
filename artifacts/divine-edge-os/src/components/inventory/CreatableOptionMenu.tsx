import { useState, type ReactNode } from "react";
import { Check, ChevronDown, GitMerge, Pencil, Plus, Trash2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type CreatableOption = {
  value: string;
  label: string;
  detail?: string | null;
  volumeAmount?: number | null;
  volumeUnit?: string | null;
  coverageAmount?: number | null;
  coverageUnit?: string | null;
  lengthAmount?: number | null;
  lengthUnit?: string | null;
};

const VOLUME_UNITS = [
  { value: "gal", label: "Gallons" },
  { value: "fl oz", label: "Fluid ounces" },
  { value: "oz", label: "Ounces" },
  { value: "l", label: "Liters" },
  { value: "lb", label: "Pounds" },
];

type CatalogEdit = {
  name: string;
  volumeAmount: number | null;
  volumeUnit: string | null;
  coverageAmount: number | null;
  coverageUnit: string | null;
  lengthAmount: number | null;
  lengthUnit: string | null;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: CreatableOption[];
  placeholder: string;
  noneLabel?: string;
  disabled?: boolean;
  title?: string;
  testId: string;
  emptyText?: string;
  addPlaceholder?: string;
  addLabel?: string;
  onAdd?: (name: string) => Promise<void> | void;
  adding?: boolean;
  manage?: {
    noun: string;
    volume?: boolean;
    onRename: (value: string, next: CatalogEdit) => Promise<void>;
    onMerge: (source: string, keep: string) => Promise<void>;
    onDelete: (value: string) => Promise<void>;
  };
};

/**
 * Sheet-safe dropdown. The menu is a popover marked data-picker-portal so the
 * parent sheet can keep it open, and a new value can be added from the same menu.
 */
export function CreatableOptionMenu({
  value,
  onChange,
  options,
  placeholder,
  noneLabel,
  disabled,
  title,
  testId,
  emptyText,
  addPlaceholder,
  addLabel = "Add",
  onAdd,
  adding,
  manage,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [volumeAmount, setVolumeAmount] = useState("");
  const [volumeUnit, setVolumeUnit] = useState("");
  const [coverageAmount, setCoverageAmount] = useState("");
  const [coverageUnit, setCoverageUnit] = useState("");
  const [lengthAmount, setLengthAmount] = useState("");
  const [lengthUnit, setLengthUnit] = useState("");
  const [merging, setMerging] = useState<string | null>(null);
  const [mergeInto, setMergeInto] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const selected = options.find(option => option.value === value);
  const label = selected?.label ?? (value ? value : noneLabel && !value ? noneLabel : placeholder);

  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  const submit = async () => {
    const name = draft.trim();
    if (!name || !onAdd || busy || adding) return;
    setBusy(true);
    try {
      await onAdd(name);
      setDraft("");
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const beginEdit = (option: CreatableOption) => {
    setEditing(option.value);
    setEditName(option.label);
    setVolumeAmount(option.volumeAmount != null ? String(option.volumeAmount) : "");
    setVolumeUnit(option.volumeUnit ?? "");
    setCoverageAmount(option.coverageAmount != null ? String(option.coverageAmount) : "");
    setCoverageUnit(option.coverageUnit ?? "");
    setLengthAmount(option.lengthAmount != null ? String(option.lengthAmount) : "");
    setLengthUnit(option.lengthUnit ?? "");
    setMerging(null);
    setConfirming(null);
  };

  const saveEdit = async (option: CreatableOption) => {
    if (!manage || busy) return;
    const name = editName.trim();
    if (!name) return;
    let nextVolume: number | null = null;
    let nextUnit: string | null = null;
    let nextCoverage: number | null = null;
    let nextCoverageUnit: string | null = null;
    let nextLength: number | null = null;
    let nextLengthUnit: string | null = null;
    if (manage.volume) {
      const amountText = volumeAmount.trim();
      const unitText = volumeUnit.trim();
      if ((amountText && !unitText) || (!amountText && unitText)) return;
      if (amountText) {
        const amount = Number(amountText);
        if (!Number.isFinite(amount) || amount <= 0) return;
        nextVolume = amount;
        nextUnit = unitText;
      }
      const coverageText = coverageAmount.trim();
      const coverageUnitText = coverageUnit.trim();
      if ((coverageText && !coverageUnitText) || (!coverageText && coverageUnitText)) return;
      if (coverageText) {
        const amount = Number(coverageText);
        if (!Number.isFinite(amount) || amount <= 0) return;
        nextCoverage = amount;
        nextCoverageUnit = coverageUnitText;
      }
      const lengthText = lengthAmount.trim();
      const lengthUnitText = lengthUnit.trim();
      if ((lengthText && !lengthUnitText) || (!lengthText && lengthUnitText)) return;
      if (lengthText) {
        const amount = Number(lengthText);
        if (!Number.isFinite(amount) || amount <= 0) return;
        nextLength = amount;
        nextLengthUnit = lengthUnitText;
      }
    }
    setBusy(true);
    try {
      await manage.onRename(option.value, {
        name,
        volumeAmount: nextVolume,
        volumeUnit: nextUnit,
        coverageAmount: nextCoverage,
        coverageUnit: nextCoverageUnit,
        lengthAmount: nextLength,
        lengthUnit: nextLengthUnit,
      });
      setEditing(null);
    } finally {
      setBusy(false);
    }
  };

  const saveMerge = async (source: string) => {
    if (!manage || busy || !mergeInto || mergeInto === source) return;
    setBusy(true);
    try {
      await manage.onMerge(source, mergeInto);
      setMerging(null);
    } finally {
      setBusy(false);
    }
  };

  const saveDelete = async (source: string) => {
    if (!manage || busy) return;
    setBusy(true);
    try {
      await manage.onDelete(source);
      setConfirming(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={next => { if (!disabled) setOpen(next); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label={title ?? placeholder}
          title={title}
          disabled={disabled}
          data-testid={testId}
          className={cn(
            "flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm",
            "focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          <span className={cn("truncate text-left", !selected && !value && "text-muted-foreground")}>{label}</span>
          <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        data-picker-portal=""
        align="start"
        className="z-[1300] w-[var(--radix-popover-trigger-width)] p-0 pointer-events-auto"
        onOpenAutoFocus={event => event.preventDefault()}
        onCloseAutoFocus={event => event.preventDefault()}
      >
        <div className="max-h-72 overflow-y-auto p-1" role="listbox" aria-label={title ?? placeholder}>
          {noneLabel && (
            <OptionRow
              testId={`${testId}-option-none`}
              label={noneLabel}
              selected={!value}
              onChoose={() => choose("")}
            />
          )}
          {options.length === 0 && emptyText && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">{emptyText}</p>
          )}
          {options.map(option => (
            <div key={option.value} className="rounded-sm">
              <div className="flex items-center">
                <OptionRow
                  testId={`${testId}-option-${option.value}`}
                  label={option.label}
                  detail={option.detail}
                  selected={option.value === value}
                  onChoose={() => choose(option.value)}
                />
                {manage && (
                  <div className="flex shrink-0 pr-1">
                    <IconButton
                      label={`Edit ${option.label}`}
                      testId={`${testId}-rename-${option.value}`}
                      onClick={() => beginEdit(option)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </IconButton>
                    <IconButton
                      label={`Merge ${option.label}`}
                      testId={`${testId}-merge-${option.value}`}
                      onClick={() => { setMerging(option.value); setMergeInto(""); setEditing(null); setConfirming(null); }}
                    >
                      <GitMerge className="h-3.5 w-3.5" />
                    </IconButton>
                    <IconButton
                      label={`Delete ${option.label}`}
                      testId={`${testId}-delete-${option.value}`}
                      onClick={() => { setConfirming(option.value); setEditing(null); setMerging(null); }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  </div>
                )}
              </div>
              {manage && editing === option.value && (
                <div className="space-y-2 px-2 pb-2">
                  <Input
                    value={editName}
                    data-testid={`${testId}-rename-name`}
                    className="h-8 text-sm"
                    aria-label={`New ${manage.noun} name`}
                    onChange={event => setEditName(event.target.value)}
                  />
                  {manage.volume && (
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={volumeAmount}
                        placeholder="Volume"
                        data-testid={`${testId}-volume-amount`}
                        className="h-8 text-sm"
                        aria-label="Volume amount"
                        onChange={event => setVolumeAmount(event.target.value)}
                      />
                      <select
                        value={volumeUnit}
                        data-testid={`${testId}-volume-unit`}
                        aria-label="Volume unit"
                        className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
                        onChange={event => setVolumeUnit(event.target.value)}
                      >
                        <option value="">No unit</option>
                        {VOLUME_UNITS.map(unit => (
                          <option key={unit.value} value={unit.value}>{unit.label}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {manage.volume && (
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={coverageAmount}
                        placeholder="Coverage"
                        data-testid={`${testId}-coverage-amount`}
                        className="h-8 text-sm"
                        aria-label="Coverage amount"
                        onChange={event => setCoverageAmount(event.target.value)}
                      />
                      <select
                        value={coverageUnit}
                        data-testid={`${testId}-coverage-unit`}
                        aria-label="Coverage unit"
                        className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
                        onChange={event => setCoverageUnit(event.target.value)}
                      >
                        <option value="">No area</option>
                        <option value="sqft">Square feet</option>
                      </select>
                    </div>
                  )}
                  {manage.volume && (
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={lengthAmount}
                        placeholder="Length"
                        data-testid={`${testId}-length-amount`}
                        className="h-8 text-sm"
                        aria-label="Length amount"
                        onChange={event => setLengthAmount(event.target.value)}
                      />
                      <select
                        value={lengthUnit}
                        data-testid={`${testId}-length-unit`}
                        aria-label="Length unit"
                        className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
                        onChange={event => setLengthUnit(event.target.value)}
                      >
                        <option value="">No length</option>
                        <option value="ft">Feet</option>
                        <option value="in">Inches</option>
                      </select>
                    </div>
                  )}
                  <Button type="button" size="sm" className="h-7" data-testid={`${testId}-save-edit`} disabled={busy || !editName.trim()} onClick={() => void saveEdit(option)}>
                    Save {manage.noun}
                  </Button>
                </div>
              )}
              {manage && merging === option.value && (
                <div className="space-y-2 px-2 pb-2">
                  <select
                    value={mergeInto}
                    data-testid={`${testId}-merge-into`}
                    aria-label={`Merge ${option.label} into`}
                    className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                    onChange={event => setMergeInto(event.target.value)}
                  >
                    <option value="">Keep this {manage.noun}</option>
                    {options.filter(other => other.value !== option.value).map(other => (
                      <option key={other.value} value={other.value}>{other.label}</option>
                    ))}
                  </select>
                  <Button type="button" size="sm" className="h-7" data-testid={`${testId}-confirm-merge`} disabled={busy || !mergeInto} onClick={() => void saveMerge(option.value)}>
                    Merge into kept {manage.noun}
                  </Button>
                </div>
              )}
              {manage && confirming === option.value && (
                <div className="space-y-2 px-2 pb-2">
                  <p className="text-xs text-muted-foreground">
                    Delete {option.label}. Items that use it will have this {manage.noun} cleared.
                  </p>
                  <Button type="button" size="sm" variant="destructive" className="h-7" data-testid={`${testId}-confirm-delete`} disabled={busy} onClick={() => void saveDelete(option.value)}>
                    Delete {manage.noun}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
        {onAdd && (
          <div className="flex gap-2 border-t p-2">
            <Input
              value={draft}
              title={addPlaceholder}
              placeholder={addPlaceholder}
              data-testid={`${testId}-new`}
              className="h-8 text-sm"
              onChange={event => setDraft(event.target.value)}
              onKeyDown={event => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0"
              data-testid={`${testId}-add`}
              disabled={busy || adding || !draft.trim()}
              onClick={() => void submit()}
            >
              <Plus className="w-3.5 h-3.5 mr-1" /> {addLabel}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function IconButton({
  label,
  testId,
  onClick,
  children,
}: {
  label: string;
  testId: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-testid={testId}
      className="rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      onClick={event => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

function OptionRow({
  label,
  detail,
  selected,
  onChoose,
  testId,
}: {
  label: string;
  detail?: string | null;
  selected: boolean;
  onChoose: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      data-testid={testId}
      data-option-label={label}
      className="flex min-w-0 flex-1 items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
      onClick={onChoose}
    >
      <Check className={cn("h-3.5 w-3.5 shrink-0", selected ? "opacity-100" : "opacity-0")} />
      <span className="min-w-0">
        <span className="block truncate">{label}</span>
        {detail && <span className="block truncate text-xs text-muted-foreground">{detail}</span>}
      </span>
    </button>
  );
}
