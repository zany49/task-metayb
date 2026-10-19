/**
 * All server data goes through these hooks (TanStack Query).
 * Lists refetch every 10 seconds, so the dashboard stays current without WebSockets.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { syncServerTime } from '../lib/time.js';
import { api, apiRequest } from './client.js';

const LIVE = 10_000;

// ---------------------------------------------------------------------------------------------
// Auth

export const useRequestOtp = () =>
  useMutation({ mutationFn: (mobile) => api('/auth/otp/request', { method: 'POST', body: { mobile } }) });

export const useVerifyOtp = () =>
  useMutation({ mutationFn: ({ mobile, otp }) => api('/auth/otp/verify', { method: 'POST', body: { mobile, otp } }) });

export const useMe = (options = {}) =>
  useQuery({ queryKey: ['me'], queryFn: () => api('/auth/me'), refetchInterval: LIVE, ...options });

// ---------------------------------------------------------------------------------------------
// Reference data and dashboard

export const useMeta = () =>
  useQuery({
    queryKey: ['meta'],
    queryFn: async () => {
      const meta = await api('/meta');
      syncServerTime(meta.serverTime);
      return meta;
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

export const useDashboardSummary = () =>
  useQuery({
    queryKey: ['summary'],
    queryFn: async () => {
      const summary = await api('/dashboard/summary');
      syncServerTime(summary.generatedAt);
      return summary;
    },
    refetchInterval: LIVE,
  });

// ---------------------------------------------------------------------------------------------
// Jobs

export const useJobs = (params) =>
  useQuery({
    queryKey: ['jobs', params],
    queryFn: () => api('/jobs', { query: params }),
    placeholderData: keepPreviousData, // keep the table on screen while a new filter loads
    refetchInterval: LIVE,
  });

export const useJob = (jobRef) =>
  useQuery({ queryKey: ['job', jobRef], queryFn: () => api(`/jobs/${encodeURIComponent(jobRef)}`), refetchInterval: LIVE });

export const useJobEvents = (jobRef) =>
  useQuery({
    queryKey: ['job-events', jobRef],
    queryFn: () => api(`/jobs/${encodeURIComponent(jobRef)}/events`),
    refetchInterval: LIVE,
  });

function useInvalidateJobs() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all(
      ['jobs', 'job', 'job-events', 'summary'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
    );
}

/** Resolves to { job, created } - created is false when the order already existed. */
export function useCreateJob() {
  const invalidate = useInvalidateJobs();
  return useMutation({
    mutationFn: async (body) => {
      const { data, status } = await apiRequest('/jobs', { method: 'POST', body });
      return { job: data, created: status === 201 };
    },
    onSuccess: invalidate,
  });
}

export function useCancelJob(jobRef) {
  const invalidate = useInvalidateJobs();
  return useMutation({
    mutationFn: (reason) => api(`/jobs/${encodeURIComponent(jobRef)}/cancel`, { method: 'POST', body: { reason } }),
    onSuccess: invalidate,
  });
}

// ---------------------------------------------------------------------------------------------
// Riders

export const useRiders = (params) =>
  useQuery({
    queryKey: ['riders', params],
    queryFn: () => api('/riders', { query: params }),
    placeholderData: keepPreviousData,
    refetchInterval: LIVE,
  });

function useInvalidateRiders() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all(['riders', 'me', 'summary'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
}

export function useCreateRider() {
  const invalidate = useInvalidateRiders();
  return useMutation({ mutationFn: (body) => api('/riders', { method: 'POST', body }), onSuccess: invalidate });
}

export function useUpdateRider() {
  const invalidate = useInvalidateRiders();
  return useMutation({
    mutationFn: ({ id, ...body }) => api(`/riders/${id}`, { method: 'PATCH', body }),
    onSuccess: invalidate,
  });
}

export function useSetAvailability() {
  const invalidate = useInvalidateRiders();
  return useMutation({
    mutationFn: ({ id, availability }) => api(`/riders/${id}/availability`, { method: 'PATCH', body: { availability } }),
    onSuccess: invalidate,
  });
}

// ---------------------------------------------------------------------------------------------
// Dispatch: recommendations, assignments, rider answers, pickup / delivery

const ref = (jobRef) => encodeURIComponent(jobRef);

export const useRecommendations = (jobRef, { enabled = true } = {}) =>
  useQuery({
    queryKey: ['recommendations', jobRef],
    queryFn: () => api(`/jobs/${ref(jobRef)}/recommendations`),
    enabled,
    refetchInterval: LIVE,
  });

export const useJobAssignments = (jobRef) =>
  useQuery({ queryKey: ['job-assignments', jobRef], queryFn: () => api(`/jobs/${ref(jobRef)}/assignments`), refetchInterval: LIVE });

export const useMyAssignments = () =>
  useQuery({
    queryKey: ['my-assignments'],
    queryFn: async () => {
      const mine = await api('/assignments/mine');
      syncServerTime(mine.serverTime);
      return mine;
    },
    refetchInterval: LIVE,
  });

/**
 * Any workflow action (assign, accept, decline, pickup, deliver, take back, ...).
 * Call with { path, body }. Afterwards everything is refetched, because one action can change
 * the job, its history, the rider's capacity and the dashboard counts at once.
 */
export function useWorkflowAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ path, body = {} }) => api(path, { method: 'POST', body }),
    onSuccess: () => queryClient.invalidateQueries(),
  });
}

// ---------------------------------------------------------------------------------------------
// Settings and demo controls

export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => api('/settings'), staleTime: 60_000 });

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) => api('/settings', { method: 'PATCH', body }),
    onSuccess: (settings) => queryClient.setQueryData(['settings'], settings),
  });
}

export const useSimulationClock = ({ enabled = true } = {}) =>
  useQuery({
    queryKey: ['sim-clock'],
    queryFn: async () => {
      const clock = await api('/simulation/clock');
      syncServerTime(clock.now);
      return clock;
    },
    enabled,
    refetchInterval: 30_000,
  });

/** { action: 'advance', minutes } | { action: 'reset' } | { action: 'sweep' } */
export function useSimulationAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ action, minutes }) => {
      if (action === 'advance') return api('/simulation/clock/advance', { method: 'POST', body: { minutes } });
      if (action === 'reset') return api('/simulation/clock/reset', { method: 'POST' });
      return api('/simulation/sweep', { method: 'POST' });
    },
    onSuccess: (result) => {
      syncServerTime(result.now);
      return queryClient.invalidateQueries();
    },
  });
}
