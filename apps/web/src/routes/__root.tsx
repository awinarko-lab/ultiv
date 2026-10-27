import { Outlet, createRootRoute } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { AppProvider } from "@/lib/app-state";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <div className="root min-h-dvh bg-background text-foreground antialiased">
      <AppProvider>
        <Outlet />
      </AppProvider>
      <Toaster position="top-center" theme="system" richColors closeButton />
    </div>
  );
}
