import { CardTitle } from "@/shared/ui/card";

import { makeHostComponent } from "../_shared/make-host-component";
import { attributes } from "./card-title.contract";

export const CardTitleHost = makeHostComponent(CardTitle, attributes);
