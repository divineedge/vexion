import { useState } from "react";
import { Check, ChevronDown, Plus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type CreatableOption = { value: string; label: string };

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
}: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
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
        <div className="max-h-64 overflow-y-auto p-1" role="listbox" aria-label={title ?? placeholder}>
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
            <OptionRow
              key={option.value}
              testId={`${testId}-option-${option.value}`}
              label={option.label}
              selected={option.value === value}
              onChoose={() => choose(option.value)}
            />
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

function OptionRow({
  label,
  selected,
  onChoose,
  testId,
}: {
  label: string;
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
      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
      onClick={onChoose}
    >
      <Check className={cn("h-3.5 w-3.5 shrink-0", selected ? "opacity-100" : "opacity-0")} />
      <span className="truncate">{label}</span>
    </button>
  );
}
