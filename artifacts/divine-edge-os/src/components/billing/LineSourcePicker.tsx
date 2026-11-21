import { lineSource, type LineSource } from "@/lib/customLinePrice";

const OPTIONS: { id: LineSource; label: string; test: string }[] = [
  { id: "service", label: "Services", test: "service" },
  { id: "part", label: "Parts", test: "part" },
  { id: "custom", label: "Custom / Pass-Through", test: "custom" },
];

export function LineSourcePicker({
  value,
  onChange,
  testId,
}: {
  value: LineSource;
  onChange: (source: LineSource) => void;
  testId: string;
}) {
  return (
    <div className="inline-flex rounded-md border bg-background p-0.5" role="tablist" aria-label="Line source">
      {OPTIONS.map(option => (
        <button
          key={option.id}
          type="button"
          role="tab"
          aria-selected={value === option.id}
          data-testid={`${testId}-${option.test}`}
          className={`px-2.5 py-1 text-xs rounded-sm ${value === option.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export { lineSource };
