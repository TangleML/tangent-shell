import { Heading } from "@/shared/ui/typography";

import { makeHostComponent } from "../_shared/make-host-component";
import { attributes } from "./heading.contract";

export const HeadingHost = makeHostComponent(Heading, attributes);
