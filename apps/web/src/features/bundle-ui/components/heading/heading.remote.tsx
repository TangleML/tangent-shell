import { makeAuthorComponent } from "../_shared/author-component";
import { defineRemoteElement } from "../_shared/define-remote-element";
import { attributes, events, TAG } from "./heading.contract";

const HeadingElement = defineRemoteElement(TAG, attributes, events);

export const Heading = makeAuthorComponent(TAG, HeadingElement, events);
