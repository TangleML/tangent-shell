import { attributes } from "@tangent/ui-extensions-sdk/contracts/pill";

import { Pill } from "@/shared/ui/patterns/pill";

import { makeHostComponent } from "../_shared/make-host-component";

export const PillHost = makeHostComponent(Pill, attributes);
