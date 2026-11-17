import { Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/**
 * Explains the Budget Calculator numbers the owner uses to price work.
 * The wording follows the calculator's formulas; do not restate them differently.
 */
export function BudgetNumbersInfo() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-7 w-7 rounded-full shrink-0 budget-print-controls"
          aria-label="How budget numbers are calculated"
          title="How budget numbers are calculated"
          data-testid="button-budget-numbers-info"
        >
          <Info className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(28rem,calc(100vw-1.5rem))] max-h-[min(32rem,70vh)] overflow-y-auto p-4 text-sm leading-relaxed"
        data-testid="popover-budget-numbers-info"
      >
        <div className="space-y-3">
          <p className="font-semibold text-foreground">How these numbers are calculated</p>
          <p className="text-muted-foreground">
            The floor is the cost you must cover per man-hour. The recommended minimum is what to charge for one stop. The markup is what to put on materials so that stop recovers its share of overhead and the margin.
          </p>

          <section className="space-y-1">
            <h2 className="font-medium text-foreground">Job floor price</h2>
            <p>
              Job floor price is a cost per man-hour. On a division, the floor spreads that division&apos;s labor, overhead, and materials over its crew hours.
            </p>
            <p>
              The company floor adds every division&apos;s labor, overhead, and materials, divides by total man-hours, then multiplies by the average of each division&apos;s Minimum Visit Hours.
            </p>
            <p>
              A floor price override replaces only that displayed price. It replaces the calculated floor for the current scope only. Division overrides are not rolled into the company floor.
            </p>
          </section>

          <section className="space-y-1">
            <h2 className="font-medium text-foreground">Recommended minimum per stop</h2>
            <p>
              Recommended minimum per stop is a visit price, not the division version of the floor. It covers on-site time plus drive time at break-even, then adds that scope&apos;s margin. Both the division and the company have one. It is not floor price times on-site time.
            </p>
            <p>
              On-site time can be cleared and retyped.
            </p>
          </section>

          <section className="space-y-1">
            <h2 className="font-medium text-foreground">Material markup</h2>
            <p>
              Material markup uses only that division, not company totals. Overhead is split by each cost&apos;s share of total expenses (labor + overhead + materials), and only the material share is used. Markup percent is (price needed − material cost) / material cost, after the division margin is applied to material cost plus that overhead share.
            </p>
            <p>
              Example: materials $20,000, overhead $80,000, labor $100,000, margin 30%. Materials are 10% of $200,000, the overhead share is $8,000, the price needed is $40,000, and the card shows 100% markup. The 30% is the margin typed on the division. The 100% is the markup on material cost.
            </p>
          </section>
        </div>
      </PopoverContent>
    </Popover>
  );
}
