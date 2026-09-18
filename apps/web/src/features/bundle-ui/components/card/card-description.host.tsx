import { attributes } from "@tangent/ui-extensions-sdk/contracts/card-description";

import { CardDescription } from "@/shared/ui/card";

import { makeHostComponent } from "../_shared/make-host-component";

export const CardDescriptionHost = makeHostComponent(
  CardDescription,
  attributes,
);
