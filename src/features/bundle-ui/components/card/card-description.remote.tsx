import { makeAuthorComponent } from "../_shared/author-component";
import { defineRemoteElement } from "../_shared/define-remote-element";
import { attributes, events, TAG } from "./card-description.contract";

const CardDescriptionElement = defineRemoteElement(TAG, attributes, events);

export const CardDescription = makeAuthorComponent(
  TAG,
  CardDescriptionElement,
  events,
);
