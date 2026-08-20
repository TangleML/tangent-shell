import type { DetailedHTMLProps, HTMLAttributes } from "react";

type TangentElementProps = DetailedHTMLProps<
  HTMLAttributes<HTMLElement> & { instance?: string },
  HTMLElement
>;

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "tangent-provider": TangentElementProps;
      "tangent-chat": TangentElementProps;
      "tangent-session-list": TangentElementProps;
      "tangent-artifact-viewer": TangentElementProps;
      "tangent-bundled-ui": TangentElementProps;
      "tangent-agent-list": TangentElementProps;
      "tangent-asset-list": TangentElementProps;
      "tangent-resource-list": TangentElementProps;
      "tangent-participant-list": TangentElementProps;
    }
  }
}
