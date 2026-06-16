import { makeAuthorComponent } from "../_shared/author-component";
import { defineRemoteElement } from "../_shared/define-remote-element";
import { attributes, events, TAG } from "./block-stack.contract";

const BlockStackElement = defineRemoteElement(TAG, attributes, events);

export const BlockStack = makeAuthorComponent(TAG, BlockStackElement, events);
