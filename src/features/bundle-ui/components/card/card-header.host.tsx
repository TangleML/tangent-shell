import { CardHeader } from "@/shared/ui/card";

import { makeHostComponent } from "../_shared/make-host-component";
import { attributes } from "./card-header.contract";

export const CardHeaderHost = makeHostComponent(CardHeader, attributes);
