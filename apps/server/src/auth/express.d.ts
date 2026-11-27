import type { AgentCaller } from "./agentCaller.ts";

declare global {
  namespace Express {
    interface Request {
      agentCaller?: AgentCaller;
    }
  }
}
