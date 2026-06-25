import { BlockStack } from "@tangent/ui-primitives/layout";

import { makeHostComponent } from "../_shared/make-host-component";
import { attributes } from "./block-stack.contract";

export const BlockStackHost = makeHostComponent(BlockStack, attributes);
