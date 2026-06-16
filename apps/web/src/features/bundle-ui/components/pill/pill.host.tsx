import { Pill } from "@/shared/ui/patterns/pill";

import { makeHostComponent } from "../_shared/make-host-component";
import { attributes } from "./pill.contract";

export const PillHost = makeHostComponent(Pill, attributes);
