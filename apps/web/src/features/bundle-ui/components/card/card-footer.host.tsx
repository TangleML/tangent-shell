import { CardFooter } from "@/shared/ui/card";

import { makeHostComponent } from "../_shared/make-host-component";
import { attributes } from "./card-footer.contract";

export const CardFooterHost = makeHostComponent(CardFooter, attributes);
