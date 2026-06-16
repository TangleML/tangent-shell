import { makeAuthorComponent } from "../_shared/author-component";
import { defineRemoteElement } from "../_shared/define-remote-element";
import { attributes, events, TAG } from "./badge.contract";

const BadgeElement = defineRemoteElement(TAG, attributes, events);

export const Badge = makeAuthorComponent(TAG, BadgeElement, events);
