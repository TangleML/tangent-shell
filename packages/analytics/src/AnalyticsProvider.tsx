import { createContext, type ReactNode, use } from "react";

export type TrackFn = (
  actionType: string,
  metadata?: Record<string, unknown>,
) => void;

interface AnalyticsContextValue {
  track: TrackFn;
}

const noop: TrackFn = () => {};

const AnalyticsContext = createContext<AnalyticsContextValue>({ track: noop });

/**
 * Provides an analytics `track` function to the component tree.
 *
 * Generic by design: the host app injects its own `track` implementation. When
 * omitted — or when no provider is mounted — `track` is a no-op, so consumers
 * can call `useAnalytics()` unconditionally.
 */
export function AnalyticsProvider({
  track = noop,
  children,
}: {
  track?: TrackFn;
  children: ReactNode;
}) {
  return <AnalyticsContext value={{ track }}>{children}</AnalyticsContext>;
}

/** @public */
export function useAnalytics(): AnalyticsContextValue {
  return use(AnalyticsContext);
}
