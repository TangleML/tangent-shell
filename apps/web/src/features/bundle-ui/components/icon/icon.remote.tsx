import { makeAuthorComponent } from "../_shared/author-component";
import { defineRemoteElement } from "../_shared/define-remote-element";
import { attributes, events, TAG } from "./icon.contract";

const IconElement = defineRemoteElement(TAG, attributes, events);

export const Icon = makeAuthorComponent(TAG, IconElement, events);
