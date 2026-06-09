import { Text } from "@/shared/ui/typography";

import { makeHostComponent } from "../_shared/make-host-component";
import { attributes } from "./text.contract";

export const TextHost = makeHostComponent(Text, attributes);
