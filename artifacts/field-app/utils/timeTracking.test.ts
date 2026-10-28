import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  memory: new Map<string, string>(),
  getItem: vi.fn(), setItem: vi.fn(),
  getPermission: vi.fn(), requestPermission: vi.fn(), getPosition: vi.fn(),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: mocks.getItem, setItem: mocks.setItem },
}));
vi.mock('expo-location', () => ({
  getForegroundPermissionsAsync: mocks.getPermission,
  requestForegroundPermissionsAsync: mocks.requestPermission,
  getCurrentPositionAsync: mocks.getPosition,
  Accuracy: { High: 4 },
}));
import { getClockLocation } from './timeTracking';
const granted = { granted: true, status: 'granted', canAskAgain: true };
const unknown = { granted: false, status: 'undetermined', canAskAgain: true };
const denied = { granted: false, status: 'denied', canAskAgain: true };
describe('Clock location permission cadence', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.memory.clear();
    mocks.getItem.mockImplementation(async (key: string) => mocks.memory.get(key) ?? null);
    mocks.setItem.mockImplementation(async (key: string, value: string) => { mocks.memory.set(key, value); });
    mocks.getPermission.mockResolvedValue(granted);
    mocks.requestPermission.mockResolvedValue(granted);
    mocks.getPosition.mockResolvedValue({ coords: { latitude: 39.7, longitude: -105 } });
  });
  afterEach(() => vi.useRealTimers());
  it('uses existing permission at every clock action without asking again', async () => {
    expect(await getClockLocation()).toEqual({ lat: 39.7, lng: -105 });
    await getClockLocation();
    expect(mocks.requestPermission).not.toHaveBeenCalled();
    expect(mocks.getPosition).toHaveBeenCalledTimes(2);
  });
  it('asks once on a fresh device and remembers the request even if an Allow Once grant expires', async () => {
    mocks.getPermission.mockResolvedValue(unknown);
    expect(await getClockLocation()).not.toBeNull();
    expect(await getClockLocation()).toBeNull();
    expect(mocks.requestPermission).toHaveBeenCalledTimes(1);
  });
  it('respects a previous OS denial, including decisions made before this app update', async () => {
    mocks.getPermission.mockResolvedValue(denied);
    expect(await getClockLocation()).toBeNull();
    expect(mocks.requestPermission).not.toHaveBeenCalled();
  });
  it('remembers a first denial instead of asking at the next stop', async () => {
    mocks.getPermission.mockResolvedValue(unknown);
    mocks.requestPermission.mockResolvedValue(denied);
    expect(await getClockLocation()).toBeNull();
    expect(await getClockLocation()).toBeNull();
    expect(mocks.requestPermission).toHaveBeenCalledTimes(1);
  });
  it('coalesces simultaneous first clock requests into one permission dialog', async () => {
    mocks.getPermission.mockResolvedValue(unknown);
    const results = await Promise.all([getClockLocation(), getClockLocation()]);
    expect(results.every(Boolean)).toBe(true);
    expect(mocks.requestPermission).toHaveBeenCalledTimes(1);
  });
  it('recognizes permission enabled in phone settings without another app dialog', async () => {
    mocks.getPermission.mockResolvedValue(unknown);
    mocks.requestPermission.mockResolvedValue(denied);
    await getClockLocation();
    mocks.getPermission.mockResolvedValue(granted);
    expect(await getClockLocation()).not.toBeNull();
    expect(mocks.requestPermission).toHaveBeenCalledTimes(1);
  });
  it('does not time out while the person is still answering the first permission prompt', async () => {
    vi.useFakeTimers();
    mocks.getPermission.mockResolvedValue(unknown);
    let answer!: (value: typeof granted) => void;
    mocks.requestPermission.mockImplementation(() => new Promise(resolve => { answer = resolve; }));
    const result = getClockLocation();
    await vi.advanceTimersByTimeAsync(5000);
    expect(mocks.getPosition).not.toHaveBeenCalled();
    answer(granted);
    expect(await result).not.toBeNull();
  });
  it('returns no invented coordinates when GPS fails', async () => {
    mocks.getPosition.mockRejectedValue(new Error('GPS unavailable'));
    expect(await getClockLocation()).toBeNull();
  });
  it('does not show a dialog if it cannot persist the one-time decision marker', async () => {
    mocks.getPermission.mockResolvedValue(unknown);
    mocks.setItem.mockRejectedValue(new Error('Device storage unavailable'));
    expect(await getClockLocation()).toBeNull();
    expect(mocks.requestPermission).not.toHaveBeenCalled();
  });
});
