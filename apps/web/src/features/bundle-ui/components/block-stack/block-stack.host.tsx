import { attributes } from "@tangent/ui-extensions-sdk/contracts/block-stack";
import { BlockStack } from "@tangent/ui-primitives/layout";

import { makeHostComponent } from "../_shared/make-host-component";

export const BlockStackHost = makeHostComponent(BlockStack, attributes);
