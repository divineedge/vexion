import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Check, ChevronDown, GitMerge, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { filterCreatableOptions, optionMatchesFilter } from "@/lib/creatableOptionFilter";
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

type MenuChoice = { value: string; id: string };

function choiceDomId(testId: string, id: string): string {
  return `${testId}-choice-${encodeURIComponent(id)}`;
}

function scrollActiveIntoList(list: HTMLElement) {
  const active = list.querySelector<HTMLElement>("[data-active='true']");
  if (!active) return;
  const listRect = list.getBoundingClientRect();
  const itemRect = active.getBoundingClientRect();
  if (itemRect.top < listRect.top) list.scrollTop -= listRect.top - itemRect.top;
  else if (itemRect.bottom > listRect.bottom) list.scrollTop += itemRect.bottom - listRect.bottom;
}

/**
 * Sheet-safe dropdown. The menu is a popover marked data-picker-portal so the
 * parent sheet can keep it open, and a new value can be added from the same menu.
 * Typing in the filter narrows the open list. Arrow keys move the highlight and
 * Enter chooses it. Edit, merge, delete, volume, and area stay on each option.
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
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
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
  const filterRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selected = options.find(option => option.value === value);
  const label = selected?.label ?? (value ? value : noneLabel && !value ? noneLabel : placeholder);
  const visibleOptions = useMemo(() => filterCreatableOptions(options, query), [options, query]);
  const showNone = Boolean(noneLabel) && optionMatchesFilter({ label: noneLabel ?? "" }, query);
  const choices = useMemo<MenuChoice[]>(() => {
    const rows: MenuChoice[] = [];
    if (showNone) rows.push({ value: "", id: "__none" });
    for (const option of visibleOptions) rows.push({ value: option.value, id: option.value });
    return rows;
  }, [showNone, visibleOptions]);
  const choicesRef = useRef(choices);
  choicesRef.current = choices;
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;
  const safeIndex = activeIndex >= choices.length ? choices.length - 1 : activeIndex;
  const activeChoice = safeIndex >= 0 ? choices[safeIndex] : undefined;
  const filterNoun = manage?.noun ?? "options";

  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
  };
  const chooseRef = useRef(choose);
  chooseRef.current = choose;

  const moveActive = (delta: number) => {
    setActiveIndex(current => {
      const count = choicesRef.current.length;
      if (count === 0) return -1;
      const start = current < 0 ? (delta > 0 ? -1 : count) : current;
      const next = start + delta;
      if (next < 0) return 0;
      if (next >= count) return count - 1;
      return next;
    });
  };
  const moveActiveRef = useRef(moveActive);
  moveActiveRef.current = moveActive;

  const selectActive = () => {
    const choice = choicesRef.current[activeIndexRef.current];
    if (!choice) return;
    chooseRef.current(choice.value);
  };
  const selectActiveRef = useRef(selectActive);
  selectActiveRef.current = selectActive;

  useEffect(() => {
    setActiveIndex(query.trim() && choicesRef.current.length > 0 ? 0 : -1);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => filterRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open || safeIndex < 0) return;
    const list = listRef.current;
    if (!list) return;
    scrollActiveIntoList(list);
  }, [open, safeIndex, query]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!target) return;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const isCombobox = target.getAttribute("role") === "combobox";
      const isOtherControl = !isCombobox && (
        tag === "BUTTON"
        || tag === "A"
        || target.getAttribute("role") === "option"
        || Boolean(target.closest("button, a, [role='option']"))
      );
      if (isOtherControl) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        moveActiveRef.current(event.key === "ArrowDown" ? 1 : -1);
        return;
      }
      if (event.key === "Enter") {
        if (activeIndexRef.current < 0) return;
        event.preventDefault();
        event.stopPropagation();
        selectActiveRef.current();
        return;
      }
      if (event.key === "Backspace") {
        event.preventDefault();
        event.stopPropagation();
        setQuery(current => current.slice(0, -1));
        return;
      }
      if (event.key.length === 1) {
        event.preventDefault();
        event.stopPropagation();
        setQuery(current => current + event.key);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open]);

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

  const onFilterKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      selectActive();
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={next => {
        if (disabled) return;
        setOpen(next);
        if (next) {
          setQuery("");
          setActiveIndex(-1);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${testId}-listbox`}
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
        <div className="flex items-center gap-2 border-b px-2">
          <Search className="h-3.5 w-3.5 shrink-0 opacity-50" />
          <input
            ref={filterRef}
            value={query}
            placeholder="Type to filter"
            aria-label={`Filter ${filterNoun}`}
            aria-autocomplete="list"
            aria-controls={`${testId}-listbox`}
            aria-activedescendant={activeChoice ? choiceDomId(testId, activeChoice.id) : undefined}
            data-testid={`${testId}-filter`}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            onChange={event => setQuery(event.target.value)}
            onKeyDown={onFilterKeyDown}
          />
        </div>
        <div
          ref={listRef}
          className="max-h-72 overflow-y-auto p-1"
          role="listbox"
          id={`${testId}-listbox`}
          aria-label={title ?? placeholder}
        >
          {showNone && noneLabel && (
            <OptionRow
              id={choiceDomId(testId, "__none")}
              testId={`${testId}-option-none`}
              label={noneLabel}
              selected={!value}
              active={activeChoice?.id === "__none"}
              onChoose={() => choose("")}
            />
          )}
          {options.length === 0 && !query.trim() && emptyText && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">{emptyText}</p>
          )}
          {query.trim() && visibleOptions.length === 0 && !showNone && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground" data-testid={`${testId}-no-matches`}>No matches.</p>
          )}
          {visibleOptions.map(option => (
            <div key={option.value} className="rounded-sm">
              <div className="flex items-center">
                <OptionRow
                  id={choiceDomId(testId, option.value)}
                  testId={`${testId}-option-${option.value}`}
                  label={option.label}
                  detail={option.detail}
                  selected={option.value === value}
                  active={activeChoice?.id === option.value}
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
  id,
  label,
  detail,
  selected,
  active,
  onChoose,
  testId,
}: {
  id: string;
  label: string;
  detail?: string | null;
  selected: boolean;
  active?: boolean;
  onChoose: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      id={id}
      role="option"
      aria-selected={selected}
      data-testid={testId}
      data-option-label={label}
      data-active={active ? "true" : undefined}
      className={cn(
        "flex min-w-0 flex-1 items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground",
        active && "bg-accent text-accent-foreground",
      )}
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
