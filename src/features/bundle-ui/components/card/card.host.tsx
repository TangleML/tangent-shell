import { Card } from "@/shared/ui/card";

import { makeHostComponent } from "../_shared/make-host-component";
import { attributes } from "./card.contract";

export const CardHost = makeHostComponent(Card, attributes);
