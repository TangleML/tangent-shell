import type { Request, Response } from "express";

import packageJson from "../../package.json" with { type: "json" };

export function handleGetVersion(_req: Request, res: Response): void {
  res.json({ name: packageJson.name, version: packageJson.version });
}
