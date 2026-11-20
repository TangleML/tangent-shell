import { createContext } from "react";

/** Session roster names for messages whose saved bylines may be abbreviated. */
export const MessageAuthorNamesContext = createContext<
  ReadonlyMap<string, string>
>(new Map());
