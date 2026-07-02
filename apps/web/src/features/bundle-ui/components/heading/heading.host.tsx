import { attributes } from "@tangent/ui-extensions-sdk/contracts/heading";
import { Heading } from "@tangent/ui-primitives/typography";

import { makeHostComponent } from "../_shared/make-host-component";

export const HeadingHost = makeHostComponent(Heading, attributes);
