import { attributes } from "@tangent/ui-extensions-sdk/contracts/card-title";

import { CardTitle } from "@/shared/ui/card";

import { makeHostComponent } from "../_shared/make-host-component";

export const CardTitleHost = makeHostComponent(CardTitle, attributes);
