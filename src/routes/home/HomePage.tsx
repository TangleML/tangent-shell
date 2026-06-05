import { Button } from "@/shared/ui/button";

export function HomePage() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 p-6">
      <h1 className="text-3xl font-bold tracking-tight">Tangent Instance</h1>
      <p className="text-muted-foreground">
        Vite + React 19 + slim FSD scaffold, compiled with React Compiler.
      </p>
      <Button>Get started</Button>
    </main>
  );
}
