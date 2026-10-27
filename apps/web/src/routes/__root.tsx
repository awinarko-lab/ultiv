import { Outlet, createRootRoute } from "@tanstack/react-router";
import { Toaster } from "sonner";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <div className="root min-h-dvh bg-background text-foreground antialiased">
      <Outlet />
      <Toaster position="top-center" theme="system" richColors closeButton />
    </div>
  );
}
