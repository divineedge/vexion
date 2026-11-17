import { describe, expect, it } from 'vitest';
import { calculateJobPricingFloor, defaultJobPricingFloor, resolveOnSiteTimeInput } from '../src/lib/jobPricingFloor';
import { presentFloorInputs } from '../src/lib/jobPricingFloorBaseline';

describe('on-site time input', () => {
  it('keeps the field empty while 4 is deleted and commits a number on blur', () => {
    expect(resolveOnSiteTimeInput('45', '4', 'edit')).toEqual({ text: '4' });
    const cleared = resolveOnSiteTimeInput('4', '', 'edit');
    expect(cleared).toEqual({ text: '' });
    expect(cleared.minutes).toBeUndefined();
    expect(resolveOnSiteTimeInput('4', '', 'blur').minutes).toBeUndefined();

    const saved = { ...defaultJobPricingFloor(), onSiteMinutes: 30 };
    expect(presentFloorInputs(defaultJobPricingFloor(), saved, {}).onSiteMinutes).toBe(30);
    const committed = resolveOnSiteTimeInput('30', '60', 'blur');
    expect(committed.minutes).toBe(60);
    const live = presentFloorInputs(defaultJobPricingFloor(), saved, { onSiteMinutes: committed.minutes });
    expect(live.onSiteMinutes).toBe(60);
    expect(calculateJobPricingFloor(live).result!.totalClockMinutes).toBe(75);
    expect(calculateJobPricingFloor(live).result!.recommendedMinimum).not.toBe(
      calculateJobPricingFloor(saved).result!.recommendedMinimum,
    );
  });
});
