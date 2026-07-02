/**
 * `@tangent/ui-extensions-sdk` — the SDK a Tangle UI extension imports.
 *
 * Exposes the typed component vocabulary, the allowlisted `host` bridge, and the
 * bridge contract types. Authoring against this module gives full editor typing;
 * at runtime the worker injects the real implementations. See the authoring
 * guide in `docs/bundle-ui/`.
 */

export * from "./components";
export { host } from "./host";
export type {
  BundleUiKind,
  HostBridge,
  HostFetchInput,
  HostRequestInit,
  HostResponse,
  HostTargetRequest,
  UICommand,
} from "./types";
