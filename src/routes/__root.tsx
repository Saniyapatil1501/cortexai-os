import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { ClerkProvider } from "@clerk/clerk-react";
import { CortexAuthProvider } from "../hooks/useCortexAuth";
import React, { useState, useEffect } from "react";
import { Sparkles, KeyRound, ArrowRight } from "lucide-react";
import { cortexClient } from "../lib/api";

import appCss from "../styles.css?url";

// Clerk Publishable Key loader
const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || "";

import * as Sentry from "@sentry/react";

if (typeof window !== "undefined") {
  const sentryDsn = import.meta.env.VITE_SENTRY_DSN || "";
  if (sentryDsn) {
    Sentry.init({
      dsn: sentryDsn,
      integrations: [Sentry.browserTracingIntegration()],
      tracesSampleRate: 1.0,
    });
  }
}

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        {error && (
          <div className="mt-4 max-w-sm mx-auto text-left rounded bg-surface-2 p-3 font-mono text-[11px] border border-border text-red-400 overflow-x-auto whitespace-pre-wrap select-all">
            {error.message || String(error)}
          </div>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Lovable App" },
      { name: "description", content: "Lovable Generated Project" },
      { name: "author", content: "Lovable" },
      { property: "og:title", content: "Lovable App" },
      { property: "og:description", content: "Lovable Generated Project" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta
          httpEquiv="Content-Security-Policy"
          content="default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline' https://*.clerk.accounts.dev https://clerk.accounts.dev https://challenges.cloudflare.com; connect-src 'self' http://127.0.0.1:8000 ws://localhost:3000 ws://127.0.0.1:3000 https://*.clerk.accounts.dev https://api.clerk.com https://challenges.cloudflare.com; frame-src 'self' https://challenges.cloudflare.com https://*.clerk.accounts.dev https://clerk.accounts.dev; img-src 'self' data: https://images.clerk-cdn.com https://img.clerk.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com;"
        />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  if (!CLERK_PUBLISHABLE_KEY) {
    console.error(
      "Missing Clerk Publishable Key! Please ensure VITE_CLERK_PUBLISHABLE_KEY is configured in your environment.",
    );
    return (
      <div className="flex min-h-screen items-center justify-center p-6 bg-background text-foreground">
        <div className="max-w-md w-full rounded-lg border border-border bg-surface-1/90 p-8 text-center shadow-2xl">
          <div className="h-12 w-12 rounded-full bg-red-500/10 text-red-500 flex items-center justify-center mx-auto mb-4">
            <KeyRound className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Configuration Required
          </h1>
          <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
            CortexAI requires a Clerk Publishable Key to initialize authentication.
          </p>
          <div className="mt-5 text-left rounded bg-surface-2 p-3 font-mono text-xs border border-border select-all text-muted-foreground">
            VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Please paste your key in the root{" "}
            <code className="bg-surface-2 px-1 py-0.5 rounded text-foreground">.env</code> file and
            restart the application.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY}>
      <CortexAuthProvider>
        <QueryClientProvider client={queryClient}>
          <Outlet />
        </QueryClientProvider>
      </CortexAuthProvider>
    </ClerkProvider>
  );
}
