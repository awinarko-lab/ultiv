import { createFileRoute, redirect } from "@tanstack/react-router";

/** Old deep links: /sessions/$id now lives at /c/$id. */
export const Route = createFileRoute("/sessions/$sessionId")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/c/$sessionId", params: { sessionId: params.sessionId }, replace: true });
  },
});
