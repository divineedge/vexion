import type { ReactNode } from 'react';
import { Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/**
 * One “i” for a single Budget Calculator figure.
 * Floor, stop-minimum, and markup wording is the calculator's existing formula.
 */
export function BudgetInfoButton({
  id, label, title, tone = 'default', children,
}: {
  id: string;
  label: string;
  title: string;
  tone?: 'default' | 'inverse' | 'emerald';
  children: ReactNode;
}) {
  const toneClass = tone === 'inverse'
    ? 'text-primary-foreground/80 hover:bg-primary-foreground/15 hover:text-primary-foreground'
    : tone === 'emerald'
      ? 'text-emerald-100 hover:bg-white/10 hover:text-white'
      : 'text-muted-foreground hover:text-foreground';
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={`h-6 w-6 shrink-0 budget-print-controls ${toneClass}`}
          aria-label={`How ${label} is calculated`}
          title={`How ${label} is calculated`}
          data-testid={`button-budget-info-${id}`}
          onClick={event => event.stopPropagation()}
        >
          <Info className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={16}
        className="w-[min(24rem,calc(100vw-1.5rem))] max-h-[min(24rem,70vh)] overflow-y-auto p-4 text-sm leading-relaxed"
        data-testid={`popover-budget-info-${id}`}
      >
        <div className="space-y-2">
          <p className="font-semibold text-foreground">{title}</p>
          {children}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function P({ children }: { children: ReactNode }) {
  return <p>{children}</p>;
}

export function DivisionJobFloorInfo() {
  return (
    <>
      <P>Job floor price is a cost per man-hour. The floor is the cost you must cover per man-hour.</P>
      <P>On a division, the floor spreads that division&apos;s labor, overhead, and materials over its crew hours.</P>
      <P>A floor price override replaces only that displayed price. It replaces the calculated floor for the current scope only. Division overrides are not rolled into the company floor.</P>
    </>
  );
}

export function CompanyJobFloorInfo() {
  return (
    <>
      <P>Job floor price is a cost per man-hour. The floor is the cost you must cover per man-hour.</P>
      <P>The company floor adds every division&apos;s labor, overhead, and materials, divides by total man-hours, then multiplies by the average of each division&apos;s Minimum Visit Hours.</P>
      <P>A floor price override replaces only that displayed price. It replaces the calculated floor for the current scope only. Division overrides are not rolled into the company floor.</P>
    </>
  );
}

export function RecommendedMinimumInfo() {
  return (
    <>
      <P>The recommended minimum is what to charge for one stop. Recommended minimum per stop is a visit price, not the division version of the floor.</P>
      <P>It covers on-site time plus drive time at break-even, then adds that scope&apos;s margin. Both the division and the company have one. It is not floor price times on-site time.</P>
      <P>On-site time can be cleared and retyped.</P>
    </>
  );
}

export function MaterialMarkupInfo() {
  return (
    <>
      <P>The markup is what to put on materials so that stop recovers its share of overhead and the margin.</P>
      <P>Material markup uses only that division, not company totals. Overhead is split by each cost&apos;s share of total expenses (labor + overhead + materials), and only the material share is used. Markup percent is (price needed − material cost) / material cost, after the division margin is applied to material cost plus that overhead share.</P>
      <P>Example: materials $20,000, overhead $80,000, labor $100,000, margin 30%. Materials are 10% of $200,000, the overhead share is $8,000, the price needed is $40,000, and the card shows 100% markup. The 30% is the margin typed on the division. The 100% is the markup on material cost.</P>
    </>
  );
}

export function DivisionTargetRateInfo() {
  return (
    <>
      <P>This is the price per man-hour this division must charge to hit the margin you typed.</P>
      <P>Labor and overhead are added. That cost is divided by (1 − the target net margin) to get required revenue. Required revenue is then divided by this division&apos;s productive man-hours.</P>
      <P>Price a job so its dollars per man-hour are at least this rate. A floor price override does not change it.</P>
    </>
  );
}

export function DivisionBreakEvenInfo() {
  return (
    <>
      <P>This is the cost you must cover per man-hour before any profit.</P>
      <P>This division&apos;s labor plus overhead is divided by its productive man-hours. The margin is not added, and materials are not in this rate.</P>
      <P>A job priced under this rate does not cover its costs.</P>
    </>
  );
}

export function FixedCostPerHourInfo() {
  return (
    <>
      <P>This is owner salary and overhead loaded onto each productive man-hour.</P>
      <P>Owner salary plus this division&apos;s annual overhead, divided by productive man-hours. Employee wages are the other line, not this one.</P>
      <P>Use it to see how much of the rate is fixed cost rather than crew pay.</P>
    </>
  );
}

export function EmployeeCostPerHourInfo() {
  return (
    <>
      <P>This is field pay loaded onto each productive man-hour.</P>
      <P>Employee wages (hourly rate × paid hours per week × working weeks) plus payroll burden, divided by productive man-hours. Owner salary is not in this line.</P>
      <P>If hiring raises the blended rate, compare this with the wage, paid hours, billable hours, and efficiency.</P>
    </>
  );
}

export function DivisionRequiredRevenueInfo() {
  return (
    <>
      <P>This is the annual sales this division needs.</P>
      <P>Labor plus overhead, divided by (1 − the target net margin). Material cost is not included.</P>
      <P>Plan the year&apos;s gross around this number if you want the margin you typed.</P>
    </>
  );
}

export function DivisionNetProfitInfo() {
  return (
    <>
      <P>This is the profit left if you collect the required revenue.</P>
      <P>Required revenue minus labor and overhead. It is the margin percent of that revenue.</P>
      <P>This is the profit the goal is built to produce, not cash already collected.</P>
    </>
  );
}

export function DivisionTotalCostsInfo() {
  return (
    <>
      <P>This is what it costs to run this division for the year, before materials.</P>
      <P>Field wages and burden, owner salary, and annual overhead, added together.</P>
      <P>The man-hour rate and the required revenue are built on this total.</P>
    </>
  );
}

export function ManHoursInfo() {
  return (
    <>
      <P>These are the productive hours this division can sell.</P>
      <P>People who produce field work — crew employees, plus the owner when they work in the field — times working weeks, times weekly billable hours, times production efficiency.</P>
      <P>More real billable hours spread the same costs thinner and lower the rate.</P>
    </>
  );
}

export function FieldLaborInfo() {
  return (
    <>
      <P>This is field employee pay for the year, before the owner&apos;s salary.</P>
      <P>Hourly rate × paid hours per week × working weeks × the number of employees, then payroll burden is added.</P>
      <P>It is part of total labor and of the man-hour rate. It is not the owner salary line.</P>
    </>
  );
}

export function TotalLaborInfo() {
  return (
    <>
      <P>This is field pay plus the owner salary for the year.</P>
      <P>Employee wages and burden, plus the owner / operator salary you typed.</P>
      <P>Overhead is separate. This labor total is what the rate spreads across man-hours along with overhead.</P>
    </>
  );
}

export function OwnerSalaryCostInfo() {
  return (
    <>
      <P>This is the owner / operator salary you typed, shown on its own.</P>
      <P>It is the annual amount from Labor &amp; Payroll. It is not calculated from hours.</P>
      <P>It is included in total labor, in the man-hour rate, and in this division&apos;s floor.</P>
    </>
  );
}

export function DivisionAnnualOverheadInfo() {
  return (
    <>
      <P>This is the division&apos;s overhead for a full year.</P>
      <P>Monthly lines are multiplied by 12. Annual lines are used as entered. Custom categories, off-season wages when technicians are paid year-round, and overhead or salaried labor counted on this division are included.</P>
      <P>The man-hour rate, break-even rate, and job floor use this annual total.</P>
    </>
  );
}

export function DivisionMonthlyOverheadInfo() {
  return (
    <>
      <P>This is a monthly view of this division&apos;s overhead.</P>
      <P>Annualized expense lines, custom categories, and overhead labor are added, then divided by 12. Off-season wages, when you pay technicians year-round, stay in the annual total and are not in this monthly figure.</P>
      <P>Use it for cash planning. The rates still use working weeks, not this monthly number.</P>
    </>
  );
}

export function P4pPayInfo() {
  return (
    <>
      <P>This is what the employee earns per hour under pay for performance.</P>
      <P>It is whichever is greater: the guaranteed base rate, or the P4P percent of the target man-hour rate. The two are not added together.</P>
      <P>When the P4P share is below the base, the employee still gets the base.</P>
    </>
  );
}

export function P4pCompanyCostInfo() {
  return (
    <>
      <P>This is the company&apos;s cost for that employee hour.</P>
      <P>The pay the employee earns, times (1 + payroll burden).</P>
      <P>Burden is taxes and insurance on top of the pay. It is not an extra bonus.</P>
    </>
  );
}

export function CompanyDivisionRateInfo() {
  return (
    <>
      <P>This row is that division&apos;s own target man-hour rate.</P>
      <P>That division&apos;s labor and overhead are divided by (1 − its margin), then divided by its productive man-hours.</P>
      <P>A floor price override on the division does not change this rate, and it is not the company blended rate.</P>
    </>
  );
}

export function CompanyTargetRateInfo() {
  return (
    <>
      <P>This is the company-wide price per man-hour.</P>
      <P>Every division&apos;s labor and overhead are added, including company-wide salaried labor. Each division&apos;s margin is weighted by its share of cost. That company cost is divided by (1 − the blended margin), then divided by total man-hours.</P>
      <P>Use it as the company rate. A division with a different cost still has its own rate on its tab.</P>
    </>
  );
}

export function CompanyBreakEvenInfo() {
  return (
    <>
      <P>This is the company cost per man-hour before profit.</P>
      <P>Every division&apos;s labor and overhead, divided by total man-hours. The margin is not added, and materials are not in this rate.</P>
      <P>Hours priced under this rate do not cover company costs.</P>
    </>
  );
}

export function CompanyRequiredRevenueInfo() {
  return (
    <>
      <P>This is the annual sales the whole company needs.</P>
      <P>Company labor plus overhead, divided by (1 − the cost-weighted blend of each division&apos;s margin).</P>
      <P>It is the gross to plan for if every division hits its own margin goal.</P>
    </>
  );
}

export function CompanyNetProfitInfo() {
  return (
    <>
      <P>This is company profit if you collect the required revenue.</P>
      <P>Combined required revenue minus combined labor and overhead.</P>
      <P>This is the profit the blended margin is built to produce, not cash already collected.</P>
    </>
  );
}

export function CompanyTotalCostsInfo() {
  return (
    <>
      <P>This is company labor plus overhead for the year.</P>
      <P>Every division&apos;s labor and overhead are added, including salaried labor that is kept at the company total.</P>
      <P>Materials are separate. The combined man-hour rate is built on this cost.</P>
    </>
  );
}

export function CompanyWorkersInfo() {
  return (
    <>
      <P>This is how many people produce field work.</P>
      <P>It adds the productive workers from every division. An owner who works in the field is counted on each division where that switch is on.</P>
      <P>Field employees are the crew count underneath. The owner is extra when they also work in the field.</P>
    </>
  );
}

export function CompanyAnnualOverheadInfo() {
  return (
    <>
      <P>This is overhead for the whole company for a year.</P>
      <P>Each line above adds that category across divisions. A monthly line is multiplied by 12. An annual line is used as entered. Custom categories land in Miscellaneous Overhead. Overhead and salaried labor is included.</P>
      <P>The company break-even rate and the company floor recover this total across productive hours.</P>
    </>
  );
}

export function CompanyMonthlyOverheadInfo() {
  return (
    <>
      <P>This is the company overhead total divided into a month.</P>
      <P>Combined annual overhead ÷ 12.</P>
      <P>Use it for cash-flow reference. Rates still use working weeks, not this monthly figure.</P>
    </>
  );
}

export function CompanyOverheadLaborInfo() {
  return (
    <>
      <P>This is non-billable salary added across divisions.</P>
      <P>Each office, shop, sales, or admin role is annualized (salary, or hourly rate × hours per week × working weeks, plus payroll burden) and then added.</P>
      <P>The total sits inside combined overhead and is recovered on productive field hours in the company break-even rate and job floor.</P>
    </>
  );
}

export function StopLaborInfo() {
  return (
    <>
      <P>This is crew pay for one stop.</P>
      <P>Every crew member is paid for on-site time plus drive and setup time, at the wage plus payroll burden.</P>
      <P>It is part of the stop&apos;s break-even price. It is not the annual man-hour rate.</P>
    </>
  );
}

export function StopOverheadInfo() {
  return (
    <>
      <P>This is the stop&apos;s share of overhead.</P>
      <P>Monthly overhead is divided by monthly billable crew hours, then multiplied by on-site time only. Drive time is paid labor and does not take another share of overhead.</P>
      <P>Changing on-site time changes this share. Drive time changes labor, not this line.</P>
    </>
  );
}

export function StopDirectInfo() {
  return (
    <>
      <P>This is other money spent on this stop.</P>
      <P>It is the direct job cost you typed, such as materials, fuel, or dump fees that are not already in overhead.</P>
      <P>Leave it at zero when those costs are already covered elsewhere. It is added into the stop&apos;s break-even price.</P>
    </>
  );
}

export function StopBreakEvenInfo() {
  return (
    <>
      <P>This is the zero-profit price for the stop.</P>
      <P>Crew labor for on-site time plus drive time, plus overhead on the on-site time, plus other direct job costs. The displayed price is rounded up to a cent.</P>
      <P>The margin is not in this number. Charge more than this when the stop should make a profit.</P>
    </>
  );
}

export function StopTrueHourlyInfo() {
  return (
    <>
      <P>This is the stop&apos;s break-even cost expressed per hour on site.</P>
      <P>The break-even stop price is divided by on-site hours. Travel labor and direct costs stay in the cost, then the total is stated per hour the crew is on the property.</P>
      <P>Use it to compare stops of different lengths. It is not the annual man-hour rate.</P>
    </>
  );
}
