import { BlockStack } from "@/shared/ui/layout";

import { makeHostComponent } from "../_shared/make-host-component";
import { attributes } from "./block-stack.contract";

export const BlockStackHost = makeHostComponent(BlockStack, attributes);
