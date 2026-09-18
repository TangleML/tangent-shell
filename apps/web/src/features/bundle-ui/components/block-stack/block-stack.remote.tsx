import {
  attributes,
  events,
  TAG,
} from "@tangent/ui-extensions-sdk/contracts/block-stack";

import { makeAuthorComponent } from "../_shared/author-component";
import { defineRemoteElement } from "../_shared/define-remote-element";

const BlockStackElement = defineRemoteElement(TAG, attributes, events);

export const BlockStack = makeAuthorComponent(TAG, BlockStackElement, events);
