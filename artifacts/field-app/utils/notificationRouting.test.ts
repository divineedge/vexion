import { describe, expect, it } from 'vitest';
import { notificationRoute } from './notificationRouting';

describe('notificationRoute', () => {
  it('routes supported notification payloads', () => {
    expect(notificationRoute({ type: 'staff_message' })).toEqual({ pathname: '/(app)/messages' });
    expect(notificationRoute({ type: 'job_message', jobId: '12', title: 'Sprinkler repair' }))
      .toEqual({ pathname: '/(app)/messages', params: { jobId: '12', title: 'Sprinkler repair' } });
    expect(notificationRoute({ type: 'job_assignment', jobId: 4 }))
      .toEqual({ pathname: '/(app)/job/[id]', params: { id: '4' } });
    expect(notificationRoute({ type: 'visit_assignment', visitId: '5' }))
      .toEqual({ pathname: '/(app)/visit/[id]', params: { id: '5' } });
    expect(notificationRoute({ type: 'task_assignment', taskId: '6' }))
      .toEqual({ pathname: '/(app)/task/[id]', params: { id: '6' } });
  });

  it('rejects untrusted types and IDs', () => {
    expect(notificationRoute({ type: 'job_message', jobId: '0' })).toBeNull();
    expect(notificationRoute({ type: 'visit_assignment', visitId: '../1' })).toBeNull();
    expect(notificationRoute({ type: 'task_assignment', taskId: 1.5 })).toBeNull();
    expect(notificationRoute({ type: 'other', jobId: 1 })).toBeNull();
    expect(notificationRoute(null)).toBeNull();
  });
});