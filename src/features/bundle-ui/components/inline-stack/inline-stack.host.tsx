import { InlineStack } from "@/shared/ui/layout";

import { makeHostComponent } from "../_shared/make-host-component";
import { attributes } from "./inline-stack.contract";

export const InlineStackHost = makeHostComponent(InlineStack, attributes);
