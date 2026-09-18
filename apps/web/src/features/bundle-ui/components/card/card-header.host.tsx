import { attributes } from "@tangent/ui-extensions-sdk/contracts/card-header";

import { CardHeader } from "@/shared/ui/card";

import { makeHostComponent } from "../_shared/make-host-component";

export const CardHeaderHost = makeHostComponent(CardHeader, attributes);
