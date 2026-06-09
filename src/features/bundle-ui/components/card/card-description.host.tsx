import { CardDescription } from "@/shared/ui/card";

import { makeHostComponent } from "../_shared/make-host-component";
import { attributes } from "./card-description.contract";

export const CardDescriptionHost = makeHostComponent(CardDescription, attributes);
