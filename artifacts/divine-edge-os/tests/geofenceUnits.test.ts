import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { geofenceRadiusForDisplay, geofenceRadiusToMeters } from '../src/lib/geofenceUnits';

describe('geofence unit conversions', () => {
  it('keeps metric values in meters', () => {
    assert.equal(geofenceRadiusForDisplay(125, 'm'), 125);
    assert.equal(geofenceRadiusToMeters(125, 'm'), 125);
  });

  it('displays feet while persisting meters', () => {
    assert.equal(geofenceRadiusForDisplay(100, 'ft'), 328);
    assert.equal(geofenceRadiusToMeters(328, 'ft'), 100);
  });
});