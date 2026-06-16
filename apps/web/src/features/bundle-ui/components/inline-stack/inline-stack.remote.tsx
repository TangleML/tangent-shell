import { makeAuthorComponent } from "../_shared/author-component";
import { defineRemoteElement } from "../_shared/define-remote-element";
import { attributes, events, TAG } from "./inline-stack.contract";

const InlineStackElement = defineRemoteElement(TAG, attributes, events);

export const InlineStack = makeAuthorComponent(TAG, InlineStackElement, events);
