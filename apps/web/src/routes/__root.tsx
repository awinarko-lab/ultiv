import { Outlet, createRootRoute } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <div className="root min-h-dvh bg-background text-foreground antialiased">
      <Outlet />
    </div>
  );
}
