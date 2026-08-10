import { createFileRoute } from "@tanstack/react-router";
import { AuthenticateWithRedirectCallback } from "@clerk/clerk-react";

export const Route = createFileRoute("/sso-callback")({
  component: SSOCallbackPage,
});

function SSOCallbackPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#141416] text-[#f4f4f5]">
      <div className="text-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#27272a] border-t-[#f4f4f5] mx-auto" />
        <p className="mt-4 text-sm text-muted-foreground">Completing authentication...</p>
        <AuthenticateWithRedirectCallback />
      </div>
    </div>
  );
}
