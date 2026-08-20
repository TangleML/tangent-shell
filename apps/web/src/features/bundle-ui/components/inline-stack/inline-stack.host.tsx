import { attributes } from "@tangent/ui-extensions-sdk/contracts/inline-stack";
import { InlineStack } from "@tangent/ui-primitives/layout";

import { makeHostComponent } from "../_shared/make-host-component";

export const InlineStackHost = makeHostComponent(InlineStack, attributes);
