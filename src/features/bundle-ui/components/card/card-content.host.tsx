import { CardContent } from "@/shared/ui/card";

import { makeHostComponent } from "../_shared/make-host-component";
import { attributes } from "./card-content.contract";

export const CardContentHost = makeHostComponent(CardContent, attributes);
