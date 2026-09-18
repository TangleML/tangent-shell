import {
  attributes,
  events,
  TAG,
} from "@tangent/ui-extensions-sdk/contracts/spinner";

import { makeAuthorComponent } from "../_shared/author-component";
import { defineRemoteElement } from "../_shared/define-remote-element";

const SpinnerElement = defineRemoteElement(TAG, attributes, events);

export const Spinner = makeAuthorComponent(TAG, SpinnerElement, events);
